// Identity-bound Cloudflare operations (Stage 3B). Every production or recovery operation in the runbook and checklist
// goes through here instead of a bare `npx wrangler ...` command.
//
// Why: Wrangler picks the account in this order (Wrangler 4 source, getActiveAccountId): a temporary OAuth account, the
// config's `account_id`, the CLOUDFLARE_ACCOUNT_ID variable, then the account CACHED from an earlier session. A D1 command
// uses the config's `database_id` when present and otherwise looks the NAME up in that account. So a bare command run
// "after" an identity check can still reach another account (cache) or another database (name). Here, every operation:
//   1. proves the identity live first (account membership; the D1 UUID exists under the expected name; the name resolves
//      to that UUID; for Workers, the Worker name exists in the approved account);
//   2. runs Wrangler with a temporary config PINNED to account_id (+ database_id, or the Worker name) AND with
//      CLOUDFLARE_ACCOUNT_ID set to the same account;
//   3. changes nothing without --execute and --approved-by (dry run by default), and refuses targets outside its rules.
// Only the operations below exist; there is no general pass-through.
//
//   read-only   d1-query, time-travel-info, worker-deployments, worker-versions
//   changing    time-travel-restore, end-sessions, worker-rollback, d1-create-restore, restore-import, restore-reset
//
//   npm run cf -- <operation> --account-id <id> [--database-uuid <uuid>] [--database <name>] [operation options]
//                 [--approved-by "Name" --execute]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isMain, parseArgs } from "./db/args.mts";
import { identityProblems, parseWhoami, PROD_DB, query, remoteTarget, resolveIdentity, ROOT, UUID_RE, ACCOUNT_RE, type Identity, type ResolvedIdentity } from "./db/d1.mts";
import type { Manifest } from "./db/dump.mts";
import type { RestoreReport } from "./db/restore.mts";
import type { RollbackRecord } from "./db/rollback.mts";
import { splitSql } from "./db/sql.mts";

export const PROD_WORKER = "skillmountainacademy";
export const RESTORE_DB_RE = /^skillmountainacademy-db-restore-\d{8}(-[a-z0-9]{1,12})?$/;
const WRANGLER = join(ROOT, "node_modules", ".bin", "wrangler");

export type Run = { status: number; stdout: string; stderr: string };
export type CfRunner = (args: string[], o: { config: string; env: Record<string, string>; interactive?: boolean }) => Run;
export type CfDeps = { runner?: CfRunner; resolve?: (i: Identity, database: string) => ResolvedIdentity; now?: Date };
export type CfResult = { ok: boolean; operation: string; failures: string[]; executed: boolean; command: string[] | null; output?: string; detail?: Record<string, unknown> };

const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
// Age in hours, accepting up to 5 minutes of clock skew between the machine that wrote a record and this one.
const SKEW_H = 5 / 60;
const ageOk = (age: number, limitH: number) => Number.isFinite(age) && age >= -SKEW_H && age <= limitH;
const tmpDirs: string[] = [];
process.on("exit", () => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

const realRunner: CfRunner = (args, o) => {
  const r = spawnSync(WRANGLER, [...args, "-c", o.config], {
    cwd: tmpdir(), encoding: "utf8", stdio: o.interactive ? "inherit" : "pipe",
    env: { ...process.env, ...o.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

// A temporary config pinning the account and EITHER a D1 database (name + UUID) OR a Worker name.
export function pinnedConfig(accountId: string, pin: { database?: string; databaseUuid?: string; worker?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "sma-cf-"));
  tmpDirs.push(dir);
  const cfg: Record<string, unknown> = { name: pin.worker ?? "sma-cf-tools", compatibility_date: "2026-10-26", account_id: accountId };
  if (pin.database) cfg.d1_databases = [{ binding: "DB", database_name: pin.database, ...(pin.databaseUuid ? { database_id: pin.databaseUuid } : {}), migrations_dir: join(ROOT, "migrations") }];
  writeFileSync(join(dir, "wrangler.jsonc"), JSON.stringify(cfg, null, 2));
  return join(dir, "wrangler.jsonc");
}

type Opts = Record<string, string | boolean | undefined>;
const str = (o: Opts, k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : undefined);
const READ_ONLY = new Set(["d1-query", "time-travel-info", "worker-deployments", "worker-versions"]);
export const OPERATIONS = ["d1-query", "time-travel-info", "worker-deployments", "worker-versions", "time-travel-restore", "end-sessions", "worker-rollback", "d1-create-restore", "restore-import", "restore-reset"] as const;

export function cf(operation: string, o: Opts, deps: CfDeps = {}): CfResult {
  const failures: string[] = [];
  const res = (extra: Partial<CfResult> = {}): CfResult => ({ ok: failures.length === 0, operation, failures, executed: false, command: null, ...extra });
  if (!(OPERATIONS as readonly string[]).includes(operation)) { failures.push(`Unknown operation ${operation}. Allowed: ${OPERATIONS.join(", ")}.`); return res(); }
  if (o["owner-approved"] !== true) failures.push("--owner-approved is required for any Cloudflare operation.");
  const accountId = (str(o, "account-id") ?? "").toLowerCase();
  if (!accountId) failures.push("--account-id is missing (the owner-approved Cloudflare account ID).");
  else if (!ACCOUNT_RE.test(accountId)) failures.push("--account-id is not 32 hexadecimal characters.");
  const changing = !READ_ONLY.has(operation);
  const execute = o.execute === true;
  const approvedBy = str(o, "approved-by");
  if (changing && execute && (!approvedBy || approvedBy.length < 3)) failures.push("--approved-by must name the person approving this change.");
  const runner = deps.runner ?? realRunner;
  const env = { CLOUDFLARE_ACCOUNT_ID: accountId };
  const now = deps.now ?? new Date();

  // ---- target rules per operation ----
  const isWorkerOp = operation.startsWith("worker-");
  const database = str(o, "database") ?? (["restore-import", "restore-reset"].includes(operation) ? "" : PROD_DB);
  const databaseUuid = (str(o, "database-uuid") ?? "").toLowerCase();
  const worker = str(o, "worker") ?? PROD_WORKER;
  if (isWorkerOp && worker !== PROD_WORKER) failures.push(`Unexpected Worker name ${worker}: only ${PROD_WORKER} is allowed.`);
  if (["restore-import", "restore-reset"].includes(operation)) {
    if (!database || !RESTORE_DB_RE.test(database)) failures.push("--database must be a recovery database named skillmountainacademy-db-restore-YYYYMMDD[-suffix]; these operations never write to production.");
  } else if (!isWorkerOp && operation !== "d1-create-restore" && database !== PROD_DB && !RESTORE_DB_RE.test(database)) failures.push(`Unexpected database name ${database}.`);
  if (["time-travel-info", "time-travel-restore", "end-sessions"].includes(operation) && database !== PROD_DB) failures.push(`${operation} applies to ${PROD_DB} only.`);
  const needsUuid = !isWorkerOp && operation !== "d1-create-restore";
  if (needsUuid) failures.push(...identityProblems({ accountId: accountId || "0".repeat(32), databaseUuid }, "database").filter((p) => !/account ID/.test(p)));

  // ---- operation-specific preconditions (before anything live) ----
  if (operation === "d1-query" && !str(o, "sql")) failures.push("--sql is required.");
  if (operation === "time-travel-restore") {
    if (!str(o, "timestamp")) failures.push("--timestamp is required (the agreed time before the mistake).");
    const ev = str(o, "evidence-backup");
    if (!ev) failures.push("--evidence-backup is required: an encrypted backup of the current state taken first (runbook §1.3).");
    else {
      const mf = ev.endsWith(".enc") ? `${resolve(ev).slice(0, -4)}.manifest.json` : `${resolve(ev)}.manifest.json`;
      if (!existsSync(resolve(ev)) || !existsSync(mf)) failures.push("The evidence backup or its manifest does not exist.");
      else {
        const m = JSON.parse(readFileSync(mf, "utf8")) as Manifest;
        if (!m.encrypted || m.encrypted.sha256 !== sha(resolve(ev))) failures.push("The evidence backup must be encrypted and match its manifest.");
        if (m.source?.identity?.accountId !== accountId || m.source?.identity?.databaseUuid !== databaseUuid) failures.push("The evidence backup is not of the approved account and database UUID.");
        const age = (now.getTime() - Date.parse(m.createdAt)) / 3_600_000;
        if (!ageOk(age, 2)) failures.push(`The evidence backup is ${Number.isFinite(age) ? age.toFixed(1) : "?"} hours old (limit 2 hours).`);
      }
    }
  }
  let rollbackRecord: RollbackRecord | null = null;
  if (operation === "worker-rollback") {
    const v = str(o, "version-id");
    if (!v || !UUID_RE.test(v)) failures.push("--version-id must be the candidate Worker version id (a UUID from worker-versions).");
    if (!str(o, "reason")) failures.push("--reason is required.");
    const rf = str(o, "rollback-record");
    if (!rf || !existsSync(resolve(rf))) failures.push("--rollback-record is required: the record written by npm run db:rollback-check -- ... --version-id <id> --record <file>.");
    else {
      rollbackRecord = JSON.parse(readFileSync(resolve(rf), "utf8")) as RollbackRecord;
      const r = rollbackRecord;
      if (r.versionId !== v) failures.push("The rollback record is for a different version id.");
      if (r.identity?.accountId !== accountId) failures.push("The rollback check was not run against the approved account.");
      // Stage 3B.1: the compatibility verdict is only meaningful for the PRODUCTION database the Worker uses.
      const prodUuid = (str(o, "database-uuid") ?? "").toLowerCase();
      if (!UUID_RE.test(prodUuid)) failures.push("--database-uuid (the production D1 UUID the rollback check was run against) is required.");
      else if (r.identity?.databaseUuid?.toLowerCase() !== prodUuid) failures.push("The rollback check was not run against the approved production database UUID.");
      const age = (now.getTime() - Date.parse(r.at)) / 3_600_000;
      if (!ageOk(age, 2)) failures.push(`The rollback check is ${Number.isFinite(age) ? age.toFixed(1) : "?"} hours old (limit 2 hours).`);
      if (r.verdict === "UNSAFE" || r.verdict === "PROHIBITED") failures.push(`The rollback verdict is ${r.verdict}: rollback refused.`);
      if (r.verdict === "CHECK_REQUIRED" && o["actions-confirmed"] !== true) failures.push("Verdict CHECK_REQUIRED: do the listed actions, then pass --actions-confirmed.");
    }
  }
  if (operation === "d1-create-restore") {
    const n = str(o, "name");
    if (!n || !RESTORE_DB_RE.test(n)) failures.push("--name must be skillmountainacademy-db-restore-YYYYMMDD[-suffix].");
  }
  let importSha: string | null = null;
  if (operation === "restore-import") {
    const f = str(o, "file"), mf = str(o, "manifest");
    if (!f || !existsSync(resolve(f))) failures.push("--file (the decrypted, verified backup SQL) does not exist.");
    if (!mf || !existsSync(resolve(mf))) failures.push("--manifest (the backup's manifest) is required.");
    if (f && mf && existsSync(resolve(f)) && existsSync(resolve(mf))) {
      importSha = sha(resolve(f));
      const m = JSON.parse(readFileSync(resolve(mf), "utf8")) as Manifest;
      if (m.file?.sha256 !== importSha) failures.push("The file is not the backup described by the manifest (SHA-256 mismatch).");
      // Stage 3B.1: only a production backup of the approved account, and only after it passed restore verification.
      if (m.source?.kind !== "remote" || m.source?.identity?.accountId !== accountId) failures.push("The backup is not a production backup of the approved account.");
      const rr = str(o, "restore-report");
      if (!rr || !existsSync(resolve(rr))) failures.push("--restore-report is required: the report written by npm run db:restore:verify for this backup (RESTORE VERIFIED).");
      else {
        let rep: RestoreReport | null = null;
        try { rep = JSON.parse(readFileSync(resolve(rr), "utf8")) as RestoreReport; } catch { failures.push("The restore report could not be read."); }
        if (rep) {
          if (rep.ok !== true) failures.push("The restore report does not show a passed restore verification.");
          if (rep.manifestSha256 !== sha(resolve(mf))) failures.push("The restore report was made for a different manifest.");
          const age = (now.getTime() - Date.parse(rep.at)) / 3_600_000;
          if (!ageOk(age, 24)) failures.push(`The restore verification is ${Number.isFinite(age) ? age.toFixed(1) : "?"} hours old (limit 24 hours): verify again.`);
        }
      }
    }
  }
  if (operation === "restore-reset") {
    const f = str(o, "file");
    if (!f || !existsSync(resolve(f))) failures.push("--file (generated by npm run db:post-restore-sql) does not exist.");
    else {
      try {
        const st = splitSql(readFileSync(resolve(f), "utf8"));
        const shape = st.length === 3 && /^DELETE FROM auth_sessions$/.test(st[0].code) && /^UPDATE auth_tokens SET used_at = '[^']+' WHERE used_at IS NULL$/.test(st[1].code)
          && st[2].code.startsWith("INSERT INTO audit_log (id, at, actor_id, action, target_type, target_id, detail, ip_hash) VALUES (") && st[2].code.includes(`'system.restore', 'database', '${databaseUuid}'`);
        if (!shape) failures.push("The file is not an unmodified post-restore reset for this database UUID (generate it with npm run db:post-restore-sql).");
      } catch { failures.push("The reset file could not be parsed safely."); }
    }
  }
  if (failures.length) return res();

  // ---- live identity proof ----
  const resolver = deps.resolve ?? ((i, db) => resolveIdentity(i, { ownerApproved: true, database: db }));
  let config: string;
  if (isWorkerOp) {
    const who = runner(["whoami", "--json"], { config: pinnedConfig(accountId, { worker }), env });
    if (who.status !== 0 || !parseWhoami(who.stdout).accounts.includes(accountId)) { failures.push("account: the signed-in user is not a member of the approved account (or not signed in)."); return res(); }
    config = pinnedConfig(accountId, { worker });
    const dl = runner(["deployments", "list", "--name", worker, "--json"], { config, env });
    if (dl.status !== 0 || !dl.stdout.trim().match(/^[[{]/m)) { failures.push(`worker: ${worker} was not found in the approved account (deployments could not be listed).`); return res(); }
    if (operation === "worker-deployments") return res({ output: dl.stdout, command: ["wrangler", "deployments", "list", "--name", worker, "--json"] });
  } else if (operation === "d1-create-restore") {
    const who = runner(["whoami", "--json"], { config: pinnedConfig(accountId, {}), env });
    if (who.status !== 0 || !parseWhoami(who.stdout).accounts.includes(accountId)) { failures.push("account: the signed-in user is not a member of the approved account (or not signed in)."); return res(); }
    config = pinnedConfig(accountId, {});
  } else {
    const r = resolver({ accountId, databaseUuid }, database);
    if (!r.ok) { failures.push(...r.failures.map((f) => `identity: ${f}`)); return res(); }
    config = pinnedConfig(accountId, { database, databaseUuid });
  }

  // ---- the operation ----
  const plans: Record<string, string[]> = {
    "time-travel-info": ["d1", "time-travel", "info", database, "--json", ...(str(o, "timestamp") ? ["--timestamp", str(o, "timestamp")!] : [])],
    "worker-versions": ["versions", "list", "--name", worker, "--json"],
    "time-travel-restore": ["d1", "time-travel", "restore", database, "--timestamp", str(o, "timestamp") ?? ""],
    "end-sessions": ["d1", "execute", database, "--remote", "--yes", "--command", "DELETE FROM auth_sessions"],
    "worker-rollback": ["rollback", str(o, "version-id") ?? "", "--name", worker, "--message", `${str(o, "reason") ?? ""} (approved by ${approvedBy ?? "?"})`],
    "d1-create-restore": ["d1", "create", str(o, "name") ?? ""],
    "restore-import": ["d1", "execute", database, "--remote", "--yes", "--file", resolve(str(o, "file") ?? "")],
    "restore-reset": ["d1", "execute", database, "--remote", "--yes", "--file", resolve(str(o, "file") ?? "")],
  };
  if (operation === "d1-query") {
    try {
      const rows = query({ ...remoteTarget({ accountId, databaseUuid }, { ownerApproved: true, database }) }, str(o, "sql")!);
      return res({ output: JSON.stringify(rows), command: ["wrangler", "d1", "execute", database, "--remote", "--json", "--command", "<read-only SQL>"] });
    } catch (e) { failures.push((e as Error).message.split("\n")[0]); return res(); }
  }
  const args = plans[operation];
  const command = ["wrangler", ...args, "-c", `<pinned: account ${accountId}${isWorkerOp ? `, worker ${worker}` : database && operation !== "d1-create-restore" ? `, ${database} ${databaseUuid}` : ""}>`];
  if (changing && !execute) return res({ command, detail: { dryRun: true } });
  const out = runner(args, { config, env, interactive: operation === "worker-rollback" || operation === "time-travel-restore" });
  if (out.status !== 0) { failures.push(`Wrangler exited with status ${out.status}. Do not retry blindly: re-check the state first.`); return res({ executed: true, command }); }
  const detail: Record<string, unknown> = { approvedBy, at: now.toISOString(), identity: { accountId, ...(databaseUuid ? { databaseUuid } : {}), ...(isWorkerOp ? { worker } : { database }) } };
  if (importSha) detail.importedSha256 = importSha;
  if (operation === "d1-create-restore") {
    const uuid = out.stdout.match(/"database_id":\s*"([0-9a-f-]{36})"/)?.[1] ?? null;
    detail.createdDatabase = str(o, "name");
    detail.createdUuid = uuid;
    if (!uuid) failures.push("Created, but the new UUID could not be read from Wrangler's output: find it with `npx wrangler d1 list` and prove it with d1-query before use.");
    else {
      const r = resolver({ accountId, databaseUuid: uuid }, str(o, "name")!);
      if (!r.ok) failures.push(...r.failures.map((f) => `new database identity: ${f}`));
    }
  }
  return res({ executed: true, command, output: changing ? undefined : out.stdout, detail });
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  const [operation] = a.positional;
  const keys = ["account-id", "database-uuid", "database", "worker", "sql", "timestamp", "evidence-backup", "version-id", "reason", "rollback-record", "name", "file", "manifest", "restore-report", "approved-by"];
  const o: Opts = Object.fromEntries(keys.map((k) => [k, a.str(k)]));
  for (const f of ["owner-approved", "execute", "actions-confirmed"]) o[f] = a.has(f);
  const r = cf(operation ?? "", o);
  for (const f of r.failures) console.log(`REFUSED  ${f}`);
  if (r.output) console.log(r.output);
  if (r.command) console.log(`${r.executed ? "Ran" : "Dry run (add --execute to run)"}: ${r.command.join(" ")}`);
  if (r.detail && r.executed) console.log(JSON.stringify(r.detail, null, 2));
  process.exit(r.ok ? 0 : 1);
}
