// Runs Wrangler D1 commands against a TARGET (Stage 3A).
//
//   local  - an isolated scratch database in its own directory (its own wrangler config and .wrangler state). Used for
//            tests, restore verification and migration rehearsal. Never the developer's working local database.
//   remote - the production database. Only READ-ONLY queries (SELECT, PRAGMA reads) are allowed through this module,
//            and only when the caller passes ownerApproved: true. Imports, migrations and any write to a remote
//            database are not possible here; production migrations go through scripts/db/migrate-remote.mts.
//            Stage 3A.1: a remote target is PINNED to an owner-approved Cloudflare account ID and D1 database UUID
//            (a temporary Wrangler config with account_id and database_id), so a database NAME can never redirect a
//            command to another database or account. resolveIdentity() proves the pinned identity before use.
//
// Nothing printed by this module contains data values or credentials; callers receive results in memory.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../..");
export const PROD_DB = "skillmountainacademy-db";
const WRANGLER = join(ROOT, "node_modules", ".bin", "wrangler");

export type Target =
  | { kind: "local"; dir: string; database: string }
  | { kind: "remote"; database: string; ownerApproved: boolean; config?: string; identity?: Identity };

// The exact identity of the production database: the owner supplies and approves both values (never invented here).
export type Identity = { accountId: string; databaseUuid: string };
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ACCOUNT_RE = /^[0-9a-f]{32}$/;
export function identityProblems(i: Partial<Identity> | null | undefined, what = "identity"): string[] {
  const p: string[] = [];
  if (!i?.accountId) p.push(`${what}: the Cloudflare account ID is missing.`);
  else if (!ACCOUNT_RE.test(i.accountId)) p.push(`${what}: the Cloudflare account ID is not 32 hexadecimal characters.`);
  if (!i?.databaseUuid) p.push(`${what}: the D1 database UUID is missing.`);
  else if (!UUID_RE.test(i.databaseUuid)) p.push(`${what}: the D1 database UUID is not a UUID.`);
  if (i?.databaseUuid === "00000000-0000-4000-8000-000000000000") p.push(`${what}: that UUID is the placeholder used for isolated local copies.`);
  return p;
}
export const sameIdentity = (a: Partial<Identity> | null | undefined, b: Partial<Identity> | null | undefined) =>
  !!a?.accountId && !!a?.databaseUuid && a.accountId === b?.accountId && a.databaseUuid === b?.databaseUuid;

// Temporary pinned configurations are removed when the process ends (they hold the account ID and UUID, no secrets).
const pinnedDirs: string[] = [];
process.on("exit", () => { for (const d of pinnedDirs) rmSync(d, { recursive: true, force: true }); });
// A remote target pinned to an exact account and database UUID (temporary config outside the project folder).
export function remoteTarget(identity: Identity, opts: { ownerApproved: boolean; database?: string; byNameOnly?: boolean }): Target {
  const bad = identityProblems(identity, "approved identity");
  if (bad.length) throw new D1Error(bad.join(" "));
  const dir = mkdtempSync(join(tmpdir(), "sma-remote-"));
  pinnedDirs.push(dir);
  const config = join(dir, "wrangler.jsonc");
  const database = opts.database ?? PROD_DB;
  writeFileSync(config, JSON.stringify({
    name: "sma-db-tools", compatibility_date: "2026-10-26", account_id: identity.accountId,
    d1_databases: [{ binding: "DB", database_name: database, ...(opts.byNameOnly ? {} : { database_id: identity.databaseUuid }), migrations_dir: join(ROOT, "migrations") }],
  }, null, 2));
  return { kind: "remote", database, ownerApproved: opts.ownerApproved, config, identity };
}

export class D1Error extends Error {}

// A new, empty, isolated local database. Refuses a directory that already holds database state unless reuse is asked for.
export function localTarget(dir: string, opts: { migrationsDir?: string; reuse?: boolean } = {}): Target {
  const abs = resolve(dir);
  mkdirSync(abs, { recursive: true });
  if (abs === ROOT || abs.startsWith(`${ROOT}/src`) || abs.startsWith(`${ROOT}/migrations`)) throw new D1Error("Refusing to use the project folder as an isolated database directory.");
  const cfg = join(abs, "wrangler.jsonc");
  if (existsSync(cfg) && !readFileSync(cfg, "utf8").includes('"sma-isolated"')) throw new D1Error(`Refusing to use ${abs}: it has a wrangler.jsonc that these tools did not create.`);
  if (!opts.reuse && existsSync(join(abs, ".wrangler"))) throw new D1Error(`Refusing to use ${abs}: it already contains a local database (choose an empty directory).`);
  if (opts.reuse && !existsSync(cfg)) throw new D1Error(`${abs} is not an isolated database directory made by these tools.`);
  writeFileSync(join(abs, "wrangler.jsonc"), JSON.stringify({
    name: "sma-isolated", compatibility_date: "2026-10-26",
    d1_databases: [{ binding: "DB", database_name: PROD_DB, database_id: "00000000-0000-4000-8000-000000000000", migrations_dir: resolve(opts.migrationsDir ?? join(ROOT, "migrations")) }],
  }, null, 2));
  return { kind: "local", dir: abs, database: PROD_DB };
}

function run(target: Target, args: string[]): { stdout: string; stderr: string; status: number } {
  if (target.kind === "remote" && !target.ownerApproved) throw new D1Error("Remote database access needs the owner's explicit approval (pass --owner-approved).");
  // Stage 3A.1: never resolve a remote database through the project's name-based configuration.
  if (target.kind === "remote" && !(target.config && target.identity)) throw new D1Error("Remote access needs an owner-approved account ID and database UUID (--account-id, --database-uuid).");
  const full = target.kind === "local"
    ? [...args, "--local", "-c", join(target.dir, "wrangler.jsonc")]
    : [...args, "--remote", ...(target.config ? ["-c", target.config] : [])];
  const r = spawnSync(WRANGLER, full, {
    cwd: target.kind === "local" ? target.dir : ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    // Stage 3B: the account is pinned twice (config account_id, which Wrangler prefers, and CLOUDFLARE_ACCOUNT_ID), so
    // neither a cached account nor a stray environment value can redirect a remote command.
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1", FORCE_COLOR: "0", CI: "1",
      ...(target.kind === "remote" && target.identity ? { CLOUDFLARE_ACCOUNT_ID: target.identity.accountId } : {}) },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 };
}

// Error text from Wrangler without echoing SQL or data (only the first line of the error message).
const errorOf = (r: { stdout: string; stderr: string }) => {
  const text = (r.stderr + r.stdout).replace(/\x1b\[[0-9;]*m/g, "");
  const j = r.stdout.match(/"text":\s*"((?:[^"\\]|\\.)*)"/);
  if (j) return JSON.parse(`"${j[1]}"`).split("\n")[0].slice(0, 300);
  const m = text.match(/ERROR\]?\s*(.+)/);
  return (m ? m[1] : "wrangler failed").split("\n")[0].slice(0, 300);
};

const READ_ONLY = /^\s*(SELECT|PRAGMA\s+(foreign_key_check|table_info|table_list|index_list)\b|WITH\b[\s\S]*\bSELECT\b)/i;

export type Rows = Record<string, unknown>[];
// Runs one or more read-only statements; returns one result set per statement.
export function query(target: Target, sql: string): Rows[] {
  if (target.kind === "remote") {
    const parts = sql.split(/;\s*(?=\S)/).filter((s) => s.trim());
    if (!parts.every((p) => READ_ONLY.test(p)) || /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH)\b/i.test(sql.replace(/'(?:[^']|'')*'/g, "''")))
      throw new D1Error("Only read-only queries can be sent to the remote database from these tools.");
  }
  const r = run(target, ["d1", "execute", target.database, "--json", "--command", sql]);
  const at = r.stdout.search(/[[{]/);
  if (r.status !== 0 || at < 0) throw new D1Error(`Query failed: ${errorOf(r)}`);
  const parsed = JSON.parse(r.stdout.slice(at)) as { results: Rows; success: boolean; error?: unknown }[] | { error?: { text?: string } };
  if (!Array.isArray(parsed)) throw new D1Error(`Query failed: ${String((parsed as { error?: { text?: string } }).error?.text ?? "unknown error").slice(0, 300)}`);
  return parsed.map((p) => p.results ?? []);
}

// Imports a SQL file into a LOCAL target only.
export function executeFile(target: Target, file: string): void {
  if (target.kind !== "local") throw new D1Error("Imports are only possible into an isolated local database with these tools.");
  const r = run(target, ["d1", "execute", target.database, "--yes", "--file", resolve(file)]);
  if (r.status !== 0) throw new D1Error(`Import failed: ${errorOf(r)}`);
}

// Applies the target's migrations directory (LOCAL target only).
export function applyMigrations(target: Target): void {
  if (target.kind !== "local") throw new D1Error("Migrations can only be applied to an isolated local database with this function.");
  const r = run(target, ["d1", "migrations", "apply", target.database]);
  if (r.status !== 0) throw new D1Error(`Migration failed: ${errorOf(r)}`);
}

// Writes arbitrary SQL into a LOCAL target (tests and seeding only).
export function execLocal(target: Target, sql: string): void {
  if (target.kind !== "local") throw new D1Error("Writes are only possible into an isolated local database.");
  const r = run(target, ["d1", "execute", target.database, "--yes", "--command", sql]);
  if (r.status !== 0) throw new D1Error(`Command failed: ${errorOf(r)}`);
}

export const migrationFiles = (dir = join(ROOT, "migrations")) => readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

// ---- identity resolution (Stage 3A.1) ----
// Parses `wrangler whoami --json` ({ loggedIn, accounts: [{ id, name }] }).
export function parseWhoami(text: string): { loggedIn: boolean; accounts: string[] } {
  const at = text.search(/[{]/);
  if (at < 0) return { loggedIn: false, accounts: [] };
  const j = JSON.parse(text.slice(at)) as { loggedIn?: boolean; accounts?: { id?: string }[] };
  return { loggedIn: j.loggedIn === true, accounts: (j.accounts ?? []).map((a) => String(a.id ?? "")).filter(Boolean) };
}
// Parses `wrangler d1 info <name> --json` (the D1 API database object: { uuid, name, ... }).
export function parseD1Info(text: string): { uuid: string | null; name: string | null } {
  const at = text.search(/[{]/);
  if (at < 0) return { uuid: null, name: null };
  const j = JSON.parse(text.slice(at)) as { uuid?: string; name?: string };
  return { uuid: typeof j.uuid === "string" ? j.uuid : null, name: typeof j.name === "string" ? j.name : null };
}

export type ResolvedIdentity = { ok: boolean; at: string; approved: Identity; byId: { uuid: string | null; name: string | null } | null;
  byName: { uuid: string | null; name: string | null } | null; accountAccessible: boolean; failures: string[] };
export type Runner = (args: string[], config?: string) => { stdout: string; stderr: string; status: number };
const realRunner: Runner = (args, config) => {
  const r = spawnSync(WRANGLER, [...args, ...(config ? ["-c", config] : [])], { cwd: tmpdir(), encoding: "utf8", env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1", CI: "1" } });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 };
};

// Proves, read-only and fail-closed, that the approved identity is real and consistent:
//   1. the signed-in Cloudflare user is a member of the approved account (`wrangler whoami --json`);
//   2. under that account, the approved UUID exists and is named skillmountainacademy-db (`d1 info`, pinned by UUID);
//   3. under that account, the NAME skillmountainacademy-db resolves to the same UUID (`d1 info`, by name), so the
//      name-based Worker binding and the pinned UUID are the same database.
// Any error, missing value or mismatch is a failure. A name match never overrides a UUID mismatch.
export function resolveIdentity(approved: Identity, opts: { ownerApproved: boolean; database?: string; runner?: Runner }): ResolvedIdentity {
  const database = opts.database ?? PROD_DB;
  const out: ResolvedIdentity = { ok: false, at: new Date().toISOString(), approved, byId: null, byName: null, accountAccessible: false, failures: [] };
  const fail = (m: string) => { out.failures.push(m); return out; };
  if (!opts.ownerApproved) return fail("Identity resolution reads Cloudflare account metadata: it needs --owner-approved.");
  const bad = identityProblems(approved, "approved identity");
  if (bad.length) { out.failures.push(...bad); return out; }
  const runner = opts.runner ?? realRunner;
  try {
    const who = runner(["whoami", "--json"]);
    const w = who.status === 0 ? parseWhoami(who.stdout) : { loggedIn: false, accounts: [] };
    if (!w.loggedIn) return fail("account: not signed in to Cloudflare (or the account could not be resolved): identity unverified.");
    if (!w.accounts.includes(approved.accountId)) return fail("account: the signed-in user is not a member of the approved Cloudflare account.");
    out.accountAccessible = true;
    const pinned = remoteTarget(approved, { ownerApproved: true, database });
    const i1 = runner(["d1", "info", database, "--json"], (pinned as { config: string }).config);
    out.byId = i1.status === 0 ? parseD1Info(i1.stdout) : null;
    if (!out.byId?.uuid) return fail(`database: no database with the approved UUID in the approved account (${errorOf(i1)}).`);
    if (out.byId.uuid !== approved.databaseUuid) return fail("database: the database found has a different UUID from the approved one.");
    if (out.byId.name !== database) return fail(`database: the approved UUID belongs to a database named ${out.byId.name ?? "?"}, not ${database}.`);
    const named = remoteTarget(approved, { ownerApproved: true, database, byNameOnly: true });
    const i2 = runner(["d1", "info", database, "--json"], (named as { config: string }).config);
    out.byName = i2.status === 0 ? parseD1Info(i2.stdout) : null;
    if (!out.byName?.uuid) return fail(`database: the name ${database} could not be resolved in the approved account (${errorOf(i2)}).`);
    if (out.byName.uuid !== approved.databaseUuid) return fail(`database: in the approved account the name ${database} resolves to a DIFFERENT UUID from the approved one (name match does not override a UUID mismatch).`);
  } catch (e) { return fail(`identity resolution failed: ${(e as Error).message.split("\n")[0].slice(0, 200)}`); }
  out.ok = true;
  return out;
}

// For command-line tools: an owner-approved, identity-verified remote target, or a refusal (fail closed).
export function verifiedRemote(o: { ownerApproved: boolean; accountId?: string; databaseUuid?: string; database?: string; runner?: Runner }): { target: Target; resolved: ResolvedIdentity } {
  if (!o.ownerApproved) throw new D1Error("Remote access needs the owner's explicit approval (--owner-approved).");
  const approved = { accountId: (o.accountId ?? "").trim().toLowerCase(), databaseUuid: (o.databaseUuid ?? "").trim().toLowerCase() };
  const resolved = resolveIdentity(approved, { ownerApproved: true, database: o.database, runner: o.runner });
  if (!resolved.ok) throw new D1Error(`Production identity NOT verified: ${resolved.failures.join(" ")}`);
  return { target: remoteTarget(approved, { ownerApproved: true, database: o.database }), resolved };
}
