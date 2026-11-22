// The ONLY route to apply migrations to the production database (Stage 3A, identity-hardened in Stage 3A.1). It replaces
// the previous `npm run db:migrate`, which ran `wrangler d1 migrations apply --remote` with no checks at all.
//
// The dry run and --execute run EXACTLY the same checks (planMigration). It refuses unless every gate passes:
//   identity   the owner-approved Cloudflare account ID and D1 database UUID (--approved-account-id,
//              --approved-database-uuid) are well-formed; the preflight's state, the preflight's backup and (if pinned)
//              wrangler.jsonc carry exactly that identity; and, LIVE at the moment of the run, the signed-in user belongs
//              to that account, the UUID exists there under the name skillmountainacademy-db, and that name resolves to
//              that UUID (scripts/db/d1.mts resolveIdentity). A name match never overrides a UUID mismatch; anything
//              unresolved fails closed.
//   state      the preflight PASSED on state captured from the REMOTE database, is at most 2 hours old, has something
//              pending; and the LIVE migration history equals the preflight's applied list (no stale or forged state).
//   files      the migration files are byte-for-byte those the preflight AND the rehearsal checked; none added.
//   backup     restore-verified, encrypted, of the approved identity, and still the same bytes (re-hashed now).
//   rehearsal  passed, on the same backup and manifest (by hash), reached this Worker's version, applied exactly the
//              pending list, at most 24 hours old.
//   operator   --confirm-database is exactly skillmountainacademy-db and --approved-by names a person.
// Then (only with --execute) it writes an approval record and runs `wrangler d1 migrations apply` against a temporary
// configuration PINNED to the approved account ID and database UUID (Wrangler asks for confirmation again). It never
// takes the backup or runs the preflight itself: those are separate, reviewed steps.
//   npm run db:migrate -- --preflight <record.json> --rehearsal <report.json> --approved-account-id <id> \
//     --approved-database-uuid <uuid> --confirm-database skillmountainacademy-db --approved-by "Name" [--execute]
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMain, parseArgs } from "./args.mts";
import { identityProblems, migrationFiles, PROD_DB, query, remoteTarget, resolveIdentity, ROOT, sameIdentity, type Identity, type ResolvedIdentity } from "./d1.mts";
import type { Result } from "./preflight.mts";
import type { Rehearsal } from "./rehearse.mts";

export type Gate = { ok: boolean; failures: string[]; warnings: string[]; command: string[]; identity: Identity | null; resolved: ResolvedIdentity | null };
export type GateDeps = {
  resolve?: (approved: Identity) => ResolvedIdentity;   // live identity proof (default: Wrangler, read-only)
  liveApplied?: (approved: Identity) => string[];       // live d1_migrations names (default: read-only query, pinned target)
  now?: Date; migrationsDir?: string; wranglerConfig?: string;
};
export type GateInput = { preflightFile?: string; rehearsalFile?: string; confirmDatabase?: string; approvedBy?: string;
  approvedAccountId?: string; approvedDatabaseUuid?: string };
const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");

// Removes // and /* */ comments outside strings (wrangler.jsonc is JSON with comments).
export function stripJsonc(text: string): string {
  let out = "", i = 0, str = false;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (str) { out += c; if (c === "\\") { out += n ?? ""; i += 2; continue; } if (c === '"') str = false; i++; continue; }
    if (c === '"') { str = true; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; continue; }
    out += c; i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}
// What wrangler.jsonc pins for the production binding (null = not pinned).
export function configuredIdentity(file: string): { accountId: string | null; databaseUuid: string | null } {
  const cfg = JSON.parse(stripJsonc(readFileSync(file, "utf8"))) as { account_id?: string; d1_databases?: { binding?: string; database_name?: string; database_id?: string }[] };
  const db = (cfg.d1_databases ?? []).find((d) => d.binding === "DB" || d.database_name === PROD_DB);
  return { accountId: cfg.account_id ?? null, databaseUuid: db?.database_id ?? null };
}

export function planMigration(o: GateInput, deps: GateDeps = {}): Gate {
  const failures: string[] = [], warnings: string[] = [];
  const now = deps.now ?? new Date();
  const dir = deps.migrationsDir ?? join(ROOT, "migrations");
  const approved: Identity = { accountId: (o.approvedAccountId ?? "").trim().toLowerCase(), databaseUuid: (o.approvedDatabaseUuid ?? "").trim().toLowerCase() };
  const idBad = identityProblems(approved, "approved identity");
  failures.push(...idBad.map((p) => `${p} (--approved-account-id / --approved-database-uuid: the owner supplies the real production values).`));
  const command = ["wrangler", "d1", "migrations", "apply", PROD_DB, "--remote", "-c", `<temporary config pinned to account ${approved.accountId || "?"} and database ${approved.databaseUuid || "?"}>`];
  let pf: Result | null = null, rh: Rehearsal | null = null;
  if (!o.preflightFile || !existsSync(o.preflightFile)) failures.push("No preflight record (--preflight). Run npm run db:preflight first.");
  else pf = JSON.parse(readFileSync(o.preflightFile, "utf8")) as Result;
  if (!o.rehearsalFile || !existsSync(o.rehearsalFile)) failures.push("No rehearsal report (--rehearsal). Run npm run db:rehearse on the verified backup first.");
  else rh = JSON.parse(readFileSync(o.rehearsalFile, "utf8")) as Rehearsal;
  const files = existsSync(dir) ? migrationFiles(dir) : [];
  if (pf) {
    if (pf.result !== "PASS") failures.push(`The preflight did not pass (${pf.failures.length} failure(s)).`);
    if (pf.database !== PROD_DB) failures.push(`The preflight is for ${pf.database}, not ${PROD_DB}.`);
    // Isolated local copies carry the production database's NAME, so the name proves nothing: remote state is required.
    if (pf.targetKind !== "remote") failures.push(`The preflight was run on a ${pf.targetKind ?? "unknown"} database, not on the production (remote) database.`);
    if (!idBad.length && !sameIdentity(pf.identity, approved)) failures.push("identity: the preflight's state was not captured from the approved account ID and database UUID.");
    const age = (now.getTime() - Date.parse(pf.at)) / 3_600_000;
    if (!(age >= 0 && age <= 2)) failures.push(`The preflight is ${Number.isFinite(age) ? age.toFixed(1) : "?"} hours old; run it again (limit 2 hours).`);
    if (!pf.pending.length) failures.push("The preflight found nothing pending.");
    for (const f of pf.files) if (!files.includes(f.name) || sha(join(dir, f.name)) !== f.sha256) failures.push(`Migration ${f.name} changed since the preflight.`);
    for (const f of files) if (!pf.files.some((x) => x.name === f)) failures.push(`Migration ${f} was added after the preflight.`);
    const b = pf.backup;
    if (!b?.restoreVerified) failures.push("The preflight's backup was not restore-verified.");
    if (b && !b.encrypted) failures.push("The preflight's backup is not encrypted.");
    if (b && !idBad.length && !sameIdentity(b.identity, approved)) failures.push("identity: the backup was not taken from the approved account ID and database UUID.");
    // The backup must still be the exact bytes that were verified and rehearsed.
    if (b && (!existsSync(b.file) || sha(b.file) !== b.sha256)) failures.push("The backup file is missing or has changed since the preflight.");
    if (b) {
      const mf = b.file.endsWith(".enc") ? `${b.file.slice(0, -4)}.manifest.json` : `${b.file}.manifest.json`;
      if (!existsSync(mf) || sha(mf) !== b.manifestSha256) failures.push("The backup's manifest is missing or has changed since the preflight.");
    }
    if (rh) {
      if (!rh.ok) failures.push("The rehearsal did not pass.");
      if (!b || rh.backupSha256 !== b.sha256 || rh.manifestSha256 !== b.manifestSha256) failures.push("The rehearsal used a different backup (or manifest) from the preflight.");
      if (rh.to !== pf.expectedByWorker) failures.push(`The rehearsal reached ${rh.to ?? "nothing"}, not ${pf.expectedByWorker}.`);
      if (JSON.stringify(rh.applied) !== JSON.stringify(pf.pending)) failures.push("The rehearsal applied a different set of migrations from the preflight's pending list.");
      const rage = (now.getTime() - Date.parse(rh.at)) / 3_600_000;
      if (!(rage >= 0 && rage <= 24)) failures.push(`The rehearsal is ${Number.isFinite(rage) ? rage.toFixed(1) : "?"} hours old; rehearse again (limit 24 hours).`);
      const rfiles = new Map((rh.files ?? []).map((f) => [f.name, f.sha256]));
      if (!rh.files?.length) failures.push("The rehearsal report does not record the migration files it applied (re-run npm run db:rehearse).");
      else for (const f of files) if (rfiles.get(f) !== sha(join(dir, f))) failures.push(`Migration ${f} differs from the file that was rehearsed.`);
    }
  }
  // wrangler.jsonc: if it pins an identity, it must be the approved one. Not pinned = a warning (the live check below
  // proves that the name currently resolves to the approved UUID; Stage 3B pins it).
  const cfgFile = deps.wranglerConfig ?? join(ROOT, "wrangler.jsonc");
  if (existsSync(cfgFile)) {
    try {
      const c = configuredIdentity(cfgFile);
      if (c.databaseUuid && c.databaseUuid.toLowerCase() !== approved.databaseUuid) failures.push("identity: wrangler.jsonc pins a different database_id from the approved UUID.");
      if (c.accountId && c.accountId.toLowerCase() !== approved.accountId) failures.push("identity: wrangler.jsonc pins a different account_id from the approved account.");
      if (!c.databaseUuid) warnings.push("wrangler.jsonc does not pin database_id: the Worker binds by name. The live check confirms the name resolves to the approved UUID today; pin it in Stage 3B.");
    } catch { failures.push("identity: wrangler.jsonc could not be read."); }
  } else failures.push("identity: wrangler.jsonc not found.");
  if (o.confirmDatabase !== PROD_DB) failures.push(`--confirm-database must be exactly ${PROD_DB}.`);
  if (!o.approvedBy || o.approvedBy.trim().length < 3) failures.push("--approved-by must name the person approving this production migration.");
  // LIVE checks (dry run and execution alike). Skipped only when the approved identity itself is malformed.
  let resolved: ResolvedIdentity | null = null;
  if (!idBad.length) {
    try {
      resolved = (deps.resolve ?? ((i) => resolveIdentity(i, { ownerApproved: true })))(approved);
      if (!resolved.ok) failures.push(...resolved.failures.map((f) => `identity (live): ${f}`));
    } catch (e) { failures.push(`identity (live): could not be verified (${(e as Error).message.split("\n")[0].slice(0, 200)}).`); }
    if (resolved?.ok && pf) {
      try {
        const live = (deps.liveApplied ?? liveAppliedDefault)(approved);
        if (JSON.stringify(live) !== JSON.stringify(pf.applied)) failures.push(`state (live): the production migration history (${live.length} applied, latest ${live.at(-1) ?? "none"}) differs from the preflight's (${pf.applied.length}, latest ${pf.applied.at(-1) ?? "none"}); capture state and run the preflight again.`);
      } catch (e) { failures.push(`state (live): the production migration history could not be read (${(e as Error).message.split("\n")[0].slice(0, 200)}).`); }
    }
  }
  return { ok: failures.length === 0, failures, warnings, command, identity: idBad.length ? null : approved, resolved };
}

const liveAppliedDefault = (approved: Identity): string[] => {
  const [rows] = query(remoteTarget(approved, { ownerApproved: true }), "SELECT name FROM d1_migrations ORDER BY id");
  return rows.map((r) => String(r.name));
};

export type ApplyRunner = (config: string) => number;
const realApply: ApplyRunner = (config) => spawnSync(join(ROOT, "node_modules", ".bin", "wrangler"), ["d1", "migrations", "apply", PROD_DB, "--remote", "-c", config], { cwd: tmpdir(), stdio: "inherit" }).status ?? 1;

// Runs the gate and, only when asked AND every gate passed, the pinned production migration. Returns an exit code.
export function runMigrate(o: GateInput & { execute?: boolean }, deps: GateDeps & { apply?: ApplyRunner; approvalsDir?: string; log?: (s: string) => void } = {}): number {
  const log = deps.log ?? console.log;
  const g = planMigration(o, deps);
  for (const w of g.warnings) log(`WARN     ${w}`);
  for (const f of g.failures) log(`REFUSED  ${f}`);
  if (!g.ok || !g.identity) { log("Production migration NOT started."); return 1; }
  if (!o.execute) { log(`All gates passed (identity verified live). Dry run only. To proceed, add --execute. It will run: npx ${g.command.join(" ")}`); return 0; }
  const pinned = remoteTarget(g.identity, { ownerApproved: true }) as { config: string };
  const rec = { at: new Date().toISOString(), approvedBy: o.approvedBy, database: PROD_DB, identity: g.identity,
    resolved: g.resolved ? { at: g.resolved.at, uuid: g.resolved.byId?.uuid, name: g.resolved.byId?.name, nameResolvesTo: g.resolved.byName?.uuid } : null,
    preflight: { file: o.preflightFile, sha256: sha(o.preflightFile!) }, rehearsal: { file: o.rehearsalFile, sha256: sha(o.rehearsalFile!) },
    command: ["wrangler", "d1", "migrations", "apply", PROD_DB, "--remote", "-c", "<pinned config>"].join(" ") };
  const dir = deps.approvalsDir ?? join(ROOT, "backups", "approvals");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `migrate-${rec.at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.json`), `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
  const status = (deps.apply ?? realApply)(pinned.config);
  log(status === 0 ? "Migration command finished. Now run the post-migration checks (docs/SMA_STAGE_3A_PRODUCTION_MIGRATION_CHECKLIST.md, Part C)." : "Migration command FAILED. Do not retry blindly: follow the disaster-recovery runbook (section 7, damaged migration state).");
  return status;
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  process.exit(runMigrate({ preflightFile: a.str("preflight"), rehearsalFile: a.str("rehearsal"), confirmDatabase: a.str("confirm-database"), approvedBy: a.str("approved-by"),
    approvedAccountId: a.str("approved-account-id"), approvedDatabaseUuid: a.str("approved-database-uuid"), execute: a.has("execute") }));
}
