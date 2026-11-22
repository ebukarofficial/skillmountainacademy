// Migration preflight (Stage 3A). Decides whether pending migrations may be applied, and FAILS CLOSED whenever the
// database's migration state cannot be established. It never applies anything itself.
//
//   npm run db:state -- --local-dir <dir> > state.json             (or, by the owner: --remote --owner-approved)
//   npm run db:preflight -- --state state.json --backup <backup.sql[.enc]> [--max-backup-age-hours 24]
//
// Checks, in order (every failure is listed; the result is PASS only when nothing failed):
//   files      names are NNNN_name.sql; numbers unique and consecutive from 0001; every file parses with the
//              SQLite-aware splitter (scripts/db/sql.mts; triggers with BEGIN ... END are handled, ambiguous SQL refused)
//   state      the database's applied-migration list is known (d1_migrations); a database that has tables but no
//              migration history, or an unreadable state, FAILS (unknown state)
//   history    the applied list is exactly a prefix of the files: no applied migration missing from the repository,
//              none out of order
//   schema     the database's schema equals the schema those applied migrations produce (no drift)
//   review     every pending statement that changes or removes data (UPDATE, DELETE, DROP, RENAME, REPLACE/UPSERT,
//              PRAGMA, trigger bodies that write) has a matching entry in db/migration-reviews.json for the file's exact
//              SHA-256; destructive statements also need destructiveAcknowledged; entries that need the owner's decision
//              need ownerApproved; transaction control, ATTACH and VACUUM are always refused
//   backup     with anything pending: a backup of THIS database at its CURRENT migration version, taken within the
//              allowed age, whose restore was verified (restore report PASS for the same file), holding records
//              (unless --allow-empty-backup for a database that genuinely has none)
// A record of the decision is written (JSON) for the approval gate (scripts/db/migrate-remote.mts).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrationFiles, ROOT, PROD_DB } from "./d1.mts";
import type { Manifest, SchemaEntry } from "./dump.mts";
import { compareSchema, loadExpected, type RestoreReport } from "./restore.mts";
import { buildExpected } from "./schema.mts";
import { classify, splitSql, SqlParseError, type Finding } from "./sql.mts";
import { identityProblems, sameIdentity } from "./d1.mts";
import { isMain } from "./args.mts";

export const REVIEWS_FILE = join(ROOT, "db", "migration-reviews.json");
export type Review = { sha256: string; reviewedBy: string; reviewedAt: string; summary: string; destructiveAcknowledged?: boolean; ownerApprovalRequired?: boolean; ownerApproved?: boolean; ownerDecision?: string };
export type State = { capturedAt: string; target: { kind: string; database: string; identity?: { accountId: string; databaseUuid: string } }; tables: string[]; migrations: string[] | null; schema: SchemaEntry[]; rows: number | null };
export type Result = {
  result: "PASS" | "FAIL"; at: string; database: string; targetKind: string | null; stateCapturedAt: string | null; failures: string[]; warnings: string[];
  applied: string[]; pending: string[]; latestApplied: string | null; expectedByWorker: string;
  files: { name: string; sha256: string; statements: number; findings: Finding[] }[];
  backup: { file: string; sha256: string; manifestSha256: string; createdAt: string; migration: string | null; restoreVerified: boolean; encrypted: boolean; identity?: { accountId: string; databaseUuid: string } } | null;
  // The verified identity of the database whose state was checked (remote state only).
  identity?: { accountId: string; databaseUuid: string } | null;
};

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

export function preflight(opts: {
  migrationsDir?: string; state: State | null; reviews?: Record<string, Review>; backupFile?: string; now?: Date;
  maxBackupAgeHours?: number; maxStateAgeHours?: number; allowEmptyBackup?: boolean; expectedSchemaFor?: (applied: string[]) => SchemaEntry[];
}): Result {
  const now = opts.now ?? new Date();
  const dir = opts.migrationsDir ?? join(ROOT, "migrations");
  const failures: string[] = [], warnings: string[] = [];
  const fail = (m: string) => failures.push(m);
  const files = migrationFiles(dir);
  const reviews = opts.reviews ?? (existsSync(REVIEWS_FILE) ? JSON.parse(readFileSync(REVIEWS_FILE, "utf8")) as Record<string, Review> : {});
  // ---- files ----
  const seen = new Map<string, string>();
  files.forEach((f, i) => {
    const m = f.match(NAME);
    if (!m) { fail(`files: ${f} is not named NNNN_name.sql.`); return; }
    if (seen.has(m[1])) fail(`files: duplicate migration number ${m[1]} (${seen.get(m[1])} and ${f}).`);
    seen.set(m[1], f);
    if (Number(m[1]) !== i + 1 && !failures.some((x) => x.includes(`duplicate migration number ${m[1]}`))) fail(`files: unexpected ordering at ${f}: expected number ${String(i + 1).padStart(4, "0")} (a gap or a renumbered file).`);
  });
  const fileInfo = files.map((f) => {
    const text = readFileSync(join(dir, f), "utf8");
    try {
      const st = splitSql(text);
      if (!st.length) fail(`files: ${f} contains no statements.`);
      return { name: f, sha256: sha(text), statements: st.length, findings: st.flatMap(classify) };
    } catch (e) {
      fail(`files: ${f} could not be parsed safely: ${(e as SqlParseError).message}`);
      return { name: f, sha256: sha(text), statements: 0, findings: [] };
    }
  });
  // ---- state ----
  const st = opts.state;
  let applied: string[] = [];
  if (!st) fail("state: the database's migration state was not provided or could not be read (fail closed).");
  else if (st.migrations === null) {
    if (st.tables.filter((t) => t !== "d1_migrations").length) fail(`state: the database has ${st.tables.length} tables but no migration history (d1_migrations); its state is unknown (fail closed).`);
    else warnings.push("state: empty database with no migration history: every migration is pending.");
  } else applied = st.migrations;
  if (st?.target.kind === "remote") {
    const bad = identityProblems(st.target.identity, "state");
    if (bad.length) fail(`state: remote state must carry the verified account ID and database UUID (${bad.join(" ")}) Capture it with npm run db:state -- --remote --owner-approved --account-id ... --database-uuid ....`);
  }
  if (st) {
    const ageH = (now.getTime() - Date.parse(st.capturedAt)) / 3_600_000;
    if (!(ageH >= 0 && ageH <= (opts.maxStateAgeHours ?? 2))) fail(`state: the captured state is ${Number.isFinite(ageH) ? ageH.toFixed(1) : "?"} hours old; capture it again (limit ${opts.maxStateAgeHours ?? 2} hours).`);
  }
  // ---- history ----
  applied.forEach((m, i) => {
    if (!files.includes(m)) fail(`history: applied migration ${m} has no file in the repository (missing migration file).`);
    else if (files[i] !== m) fail(`history: applied migration ${m} is out of order (position ${i + 1}, repository has ${files[i] ?? "nothing"} there).`);
  });
  const historyOk = !failures.some((f) => f.startsWith("history") || f.startsWith("state"));
  const pending = historyOk && st ? files.slice(applied.length) : [];
  // ---- schema ----
  if (st && historyOk && applied.length) {
    try {
      const expected = (opts.expectedSchemaFor ?? expectedSchemaFor)(applied);
      const d = compareSchema(st.schema, expected);
      if (d.missing.length || d.extra.length || d.changed.length)
        fail(`schema: the database differs from what its applied migrations produce: missing ${d.missing.join(", ") || "none"}; extra ${d.extra.join(", ") || "none"}; changed ${d.changed.join(", ") || "none"}.`);
    } catch (e) { fail(`schema: could not build the expected schema: ${(e as Error).message}`); }
  }
  // ---- review of pending statements ----
  for (const f of fileInfo.filter((x) => pending.includes(x.name))) {
    const risky = f.findings.filter((x) => x.severity !== "safe");
    for (const x of risky.filter((r) => r.severity === "forbidden")) fail(`review: ${f.name} line ${x.line}: ${x.kind} is never allowed in a migration.`);
    if (!risky.length || risky.every((r) => r.severity === "forbidden")) continue;
    const r = reviews[f.name];
    const kinds = [...new Set(risky.map((x) => `${x.kind} (line ${x.line})`))].join("; ");
    if (!r) { fail(`review: ${f.name} needs an explicit review before it can be applied: ${kinds}. Record it in db/migration-reviews.json.`); continue; }
    if (r.sha256 !== f.sha256) { fail(`review: ${f.name} changed after it was reviewed (SHA-256 differs); review it again.`); continue; }
    if (risky.some((x) => x.severity === "destructive") && !r.destructiveAcknowledged) fail(`review: ${f.name} contains destructive statements (${kinds}); the review must set destructiveAcknowledged.`);
    if (r.ownerApprovalRequired && !r.ownerApproved) fail(`review: ${f.name} needs the owner's decision before it can be applied: ${r.ownerDecision ?? r.summary}`);
    else warnings.push(`review: ${f.name} reviewed by ${r.reviewedBy} on ${r.reviewedAt}: ${r.summary}`);
  }
  // ---- backup ----
  let backup: Result["backup"] = null;
  if (pending.length) {
    if (!opts.backupFile) fail("backup: a verified backup of the current database is required before applying migrations (--backup).");
    else {
      const file = resolve(opts.backupFile);
      const mf = file.endsWith(".enc") ? `${file.slice(0, -4)}.manifest.json` : `${file}.manifest.json`;
      const rf = `${file}.restore-report.json`;
      if (!existsSync(file) || !existsSync(mf)) fail(`backup: ${file} or its manifest does not exist (missing required backup).`);
      else {
        const m = JSON.parse(readFileSync(mf, "utf8")) as Manifest;
        const fileSha = sha(readFileSync(file));
        const expectSha = file.endsWith(".enc") ? m.encrypted?.sha256 : m.file.sha256;
        if (fileSha !== expectSha) fail("backup: the backup file does not match its manifest (SHA-256).");
        const ageH = (now.getTime() - Date.parse(m.createdAt)) / 3_600_000;
        if (!(ageH >= 0 && ageH <= (opts.maxBackupAgeHours ?? 24))) fail(`backup: the backup is ${ageH.toFixed(1)} hours old; the limit is ${opts.maxBackupAgeHours ?? 24} hours.`);
        if (st && m.source.database !== st.target.database) fail("backup: the backup is of a different database.");
        if (st?.target.kind === "remote") {
          // Exact identity, not the name: account ID and D1 UUID of the backup must be those of the checked state.
          if (!sameIdentity(m.source.identity, st.target.identity)) fail("backup: the backup is not of the same database (account ID and D1 UUID must match the state's verified identity).");
          if (!m.encrypted) fail("backup: production backups must be encrypted (--encrypt-for <owner public key>).");
        }
        if (st && m.source.kind !== st.target.kind) fail(`backup: the backup was taken from a ${m.source.kind} database, the state is of a ${st.target.kind} database.`);
        if ((m.migration.latest ?? null) !== (applied.at(-1) ?? null)) fail(`backup: the backup is at migration ${m.migration.latest ?? "none"}, the database is at ${applied.at(-1) ?? "none"}; take a new backup.`);
        if ((m.totals.institutionalRows ?? m.totals.rows) === 0 && !opts.allowEmptyBackup) fail("backup: the backup holds no institutional records (wrong database, or a failed export?); for a database that really is empty, pass --allow-empty-backup.");
        let verified = false;
        if (!existsSync(rf)) fail("backup: the backup's restore has not been verified (run npm run db:restore:verify on it).");
        else {
          const rep = JSON.parse(readFileSync(rf, "utf8")) as RestoreReport;
          // Bound to the exact bytes: the report must name this file AND carry this file's and this manifest's SHA-256.
          verified = rep.ok && resolve(rep.backup) === file && rep.backupSha256 === sha(readFileSync(file)) && rep.manifestSha256 === sha(readFileSync(mf));
          if (!verified) fail("backup: the restore verification of this backup did not pass.");
        }
        backup = { file, sha256: fileSha, manifestSha256: sha(readFileSync(mf)), createdAt: m.createdAt, migration: m.migration.latest, restoreVerified: verified, encrypted: !!m.encrypted,
          ...(m.source.identity ? { identity: m.source.identity } : {}) };
      }
    }
  }
  return {
    result: failures.length ? "FAIL" : "PASS", at: now.toISOString(), database: st?.target.database ?? PROD_DB, targetKind: st?.target.kind ?? null, stateCapturedAt: st?.capturedAt ?? null, failures, warnings,
    applied, pending, latestApplied: applied.at(-1) ?? null, expectedByWorker: files.at(-1) ?? "none", files: fileInfo, backup, identity: st?.target.identity ?? null,
  };
}

// Expected schema after a given prefix of migrations: the snapshot when everything is applied, otherwise built by
// applying just that prefix to an isolated database.
export function expectedSchemaFor(applied: string[], migrationsDir = join(ROOT, "migrations")): SchemaEntry[] {
  const all = migrationFiles(migrationsDir);
  if (migrationsDir === join(ROOT, "migrations") && applied.length === all.length) return loadExpected().schema;
  const tmp = mkdtempSync(join(tmpdir(), "sma-prefix-"));
  try {
    for (const f of applied) copyFileSync(join(migrationsDir, f), join(tmp, f));
    return buildExpected(tmp).schema;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

export function writeRecord(r: Result, file?: string): string {
  const out = file ?? join(ROOT, "backups", "preflight", `preflight-${r.at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.json`);
  mkdirSync(resolve(out, ".."), { recursive: true });
  writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`, { mode: 0o600 });
  return out;
}

// ---- files-only mode (Stage 3B, for CI: no database state) ----
// Checks every migration file as if it were pending: names, numbering, safe parsing, and that every risky statement has a
// review matching the file's exact SHA-256 (destructive statements acknowledged; forbidden statements refused). Open owner
// decisions are reported as notes: they only matter if the migration is still pending in production.
export function checkFiles(opts: { migrationsDir?: string; reviews?: Record<string, Review> } = {}): { result: "PASS" | "FAIL"; failures: string[]; notes: string[]; files: number } {
  const dir = opts.migrationsDir ?? join(ROOT, "migrations");
  const r = preflight({ migrationsDir: dir, state: { capturedAt: new Date().toISOString(), target: { kind: "local", database: PROD_DB }, tables: [], migrations: [], schema: [], rows: 0 },
    reviews: opts.reviews, expectedSchemaFor: () => [] });
  const notes = r.failures.filter((f) => /needs the owner's decision/.test(f)).map((f) => f.replace(/^review: /, "owner decision (if pending in production): "));
  const failures = r.failures.filter((f) => !/needs the owner's decision/.test(f) && !/^backup:/.test(f));
  return { result: failures.length ? "FAIL" : "PASS", failures, notes, files: r.files.length };
}

// ---- CLI ----
if (isMain(import.meta.url)) {
  const { parseArgs } = await import("./args.mts");
  const a = parseArgs();
  if (a.has("files-only")) {
    const r = checkFiles();
    for (const n of r.notes) console.log(`NOTE  ${n}`);
    for (const f of r.failures) console.log(`FAIL  ${f}`);
    console.log(`MIGRATION FILES ${r.result} (${r.files} files)`);
    process.exit(r.result === "PASS" ? 0 : 1);
  }
  const stateFile = a.str("state");
  let state: State | null = null;
  try { state = stateFile && existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) as State : null; } catch { state = null; }
  const r = preflight({ state, backupFile: a.str("backup"), maxBackupAgeHours: a.str("max-backup-age-hours") ? Number(a.str("max-backup-age-hours")) : undefined, allowEmptyBackup: a.has("allow-empty-backup") });
  const out = writeRecord(r, a.str("record"));
  console.log(`Database: ${r.database} | applied ${r.applied.length} (latest ${r.latestApplied ?? "none"}) | pending ${r.pending.length}${r.pending.length ? `: ${r.pending.join(", ")}` : ""} | this Worker expects ${r.expectedByWorker}`);
  for (const w of r.warnings) console.log(`NOTE  ${w}`);
  for (const f of r.failures) console.log(`FAIL  ${f}`);
  console.log(`PREFLIGHT ${r.result} (record: ${out})`);
  process.exit(r.result === "PASS" ? 0 : 1);
}
