// Restore verification (Stage 3A). Restores a backup into a NEW, EMPTY, ISOLATED local database and proves it is usable:
//
//   1. integrity   the file's SHA-256 matches its manifest (decrypting first when it is an encrypted backup)
//   2. import      the SQL imports without error into an empty database
//   3. schema      every table, index, view and trigger in the manifest exists with identical SQL
//   4. triggers    the owner_record / audit_log protection triggers are present (when the backup's schema has them)
//   5. foreign keys PRAGMA foreign_key_check reports no violations
//   6. records     every table has the manifest's row count AND the same SHA-256 of its rows (data identical)
//   7. critical    owner record, audit log, users by role, enrolments, classes and attendance, assignments, submissions,
//                  orders, instalments, payments, webhook events, MFA records: identical figures
//   8. compatibility the restored schema matches what this Worker version expects (db/schema.expected.json)
//
// Production is never touched: the target is always an isolated local directory. A report is written as JSON.
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { D1Error, execLocal, executeFile, localTarget, query, ROOT, type Target } from "./d1.mts";
import { criticalOf, decryptFile, readAll, sha256File, tableHash, type Manifest, type SchemaEntry } from "./dump.mts";
import { isMain } from "./args.mts";

export const EXPECTED_SCHEMA_FILE = join(ROOT, "db", "schema.expected.json");
export type Expected = { migration: string; migrations: string[]; schema: SchemaEntry[] };
export const loadExpected = (): Expected => JSON.parse(readFileSync(EXPECTED_SCHEMA_FILE, "utf8"));

export type Check = { name: string; ok: boolean; detail: string };
export type Compatibility = { status: "compatible" | "older_schema" | "newer_schema" | "schema_drift" | "unknown"; detail: string; pending: string[] };
// The report is bound to the exact bytes verified (Stage 3A.1): the backup file's SHA-256 (the ciphertext, for an
// encrypted backup) and the manifest's SHA-256. Replacing either afterwards, even with a self-consistent pair, voids it.
export type RestoreReport = { ok: boolean; at: string; backup: string; backupSha256: string | null; manifestSha256: string | null; isolatedDir: string; kept: boolean; checks: Check[]; compatibility: Compatibility };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (e: SchemaEntry) => `${e.type}:${e.name}`;

export function compareSchema(actual: SchemaEntry[], expected: SchemaEntry[]): { missing: string[]; extra: string[]; changed: string[] } {
  const a = new Map(actual.map((e) => [key(e), norm(e.sql)]));
  const x = new Map(expected.map((e) => [key(e), norm(e.sql)]));
  return {
    missing: [...x.keys()].filter((k) => !a.has(k)),
    extra: [...a.keys()].filter((k) => !x.has(k)),
    changed: [...x.keys()].filter((k) => a.has(k) && a.get(k) !== x.get(k)),
  };
}

// How a database at `applied` migrations with `schema` relates to what this Worker build expects.
export function compatibility(applied: string[], schema: SchemaEntry[], expected = loadExpected()): Compatibility {
  const latest = applied.at(-1) ?? null;
  const known = expected.migrations;
  if (!latest) return { status: "unknown", detail: "No migration history in the database (d1_migrations empty or missing).", pending: known };
  const prefixOk = applied.every((m, i) => known[i] === m);
  if (!prefixOk && applied.length > known.length && known.every((m, i) => applied[i] === m)) return { status: "newer_schema", detail: `The database has migrations this Worker does not know: ${applied.slice(known.length).join(", ")}.`, pending: [] };
  if (!prefixOk) return { status: "schema_drift", detail: "The database's migration history does not match this repository's migration files.", pending: [] };
  const pending = known.slice(applied.length);
  if (pending.length) return { status: "older_schema", detail: `${pending.length} migration(s) not applied: ${pending.join(", ")}. This Worker version expects ${expected.migration}.`, pending };
  const d = compareSchema(schema, expected.schema);
  if (d.missing.length || d.extra.length || d.changed.length)
    return { status: "schema_drift", detail: `Migration history is complete but the schema differs: missing ${d.missing.join(", ") || "none"}; extra ${d.extra.join(", ") || "none"}; changed ${d.changed.join(", ") || "none"}.`, pending: [] };
  return { status: "compatible", detail: `Schema matches ${expected.migration}, the version this Worker expects.`, pending: [] };
}

// The isolated copy (and, for encrypted backups, the decrypted SQL) is confidential: the decrypted file is deleted as soon as
// it has been imported, and the whole isolated directory is removed at the end unless `keep` is set (for inspection or a
// rehearsal, which then removes it itself).
export function verifyRestore(backupFile: string, opts: { isolatedDir?: string; privateKey?: string; manifestFile?: string; reportFile?: string; keep?: boolean } = {}): RestoreReport {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); return ok; };
  const at = new Date().toISOString();
  const file = resolve(backupFile);
  const manifestFile = opts.manifestFile ?? (file.endsWith(".enc") ? `${file.slice(0, -4)}.manifest.json` : `${file}.manifest.json`);
  const dir = opts.isolatedDir ?? mkdtempSync(join(tmpdir(), "sma-restore-"));
  const madeDir = !opts.isolatedDir;
  let fileHash: string | null = null, manifestHash: string | null = null;
  const report = (compat: Compatibility = { status: "unknown", detail: "not reached", pending: [] }): RestoreReport => {
    rmSync(join(dir, "decrypted.sql"), { force: true });
    const kept = !!opts.keep;
    if (!kept) rmSync(madeDir ? dir : join(dir, "db"), { recursive: true, force: true });
    const r = { ok: checks.every((c) => c.ok) && checks.length > 0, at, backup: file, backupSha256: fileHash, manifestSha256: manifestHash, isolatedDir: dir, kept, checks, compatibility: compat };
    if (opts.reportFile) writeFileSync(opts.reportFile, `${JSON.stringify(r, null, 2)}\n`, { mode: 0o600 });
    return r;
  };
  if (!add("backup file exists", existsSync(file), file)) return report();
  if (!add("manifest exists", existsSync(manifestFile), manifestFile)) return report();
  fileHash = existsSync(file) ? sha256File(file) : null;
  manifestHash = sha256File(manifestFile);
  const m = JSON.parse(readFileSync(manifestFile, "utf8")) as Manifest;
  // 1. integrity
  let sqlFile = file;
  if (file.endsWith(".enc")) {
    if (!add("encrypted file checksum", !!m.encrypted && sha256File(file) === m.encrypted.sha256, "SHA-256 of the encrypted file")) return report();
    if (!opts.privateKey) { add("decryption key supplied", false, "an encrypted backup needs --key <private-key.pem>"); return report(); }
    sqlFile = join(dir, "decrypted.sql");
    try { decryptFile(file, opts.privateKey, sqlFile); add("decryption", true, "authenticated (AES-256-GCM tag valid)"); }
    catch (e) { add("decryption", false, String((e as Error).message).slice(0, 200)); return report(); }
  }
  if (!add("file checksum", sha256File(sqlFile) === m.file.sha256, "SHA-256 of the SQL matches the manifest")) return report();
  // 2. import into an empty isolated database
  let t: Target;
  try { t = localTarget(join(dir, "db")); } catch (e) { add("isolated database is new", false, (e as Error).message); return report(); }
  try { executeFile(t, sqlFile); add("import", true, "imported without errors into an empty isolated database"); }
  catch (e) { add("import", false, (e as Error).message); return report(); }
  finally { if (sqlFile !== file) rmSync(sqlFile, { force: true }); }
  // 3-7. read everything back with the same code that made the backup
  let got: ReturnType<typeof readAll>;
  try { got = readAll(t); } catch (e) { add("read restored database", false, (e as Error).message); return report(); }
  const d = compareSchema(got.schema, m.schema);
  add("schema identical to backup", !d.missing.length && !d.extra.length && !d.changed.length,
    `${got.schema.filter((e) => e.type === "table").length} tables, ${got.schema.filter((e) => e.type === "index").length} indexes, ${got.schema.filter((e) => e.type === "trigger").length} triggers; missing ${d.missing.length}, extra ${d.extra.length}, changed ${d.changed.length}${d.missing.length ? ` (${d.missing.join(", ")})` : ""}`);
  const restoredTriggers = got.schema.filter((e) => e.type === "trigger").map((e) => e.name).sort();
  add("triggers restored", JSON.stringify(restoredTriggers) === JSON.stringify([...m.triggers].sort()), restoredTriggers.join(", ") || "none in backup");
  const fk = query(t, "PRAGMA foreign_key_check")[0];
  add("foreign keys", fk.length === 0, fk.length ? `${fk.length} violation(s) in: ${[...new Set(fk.map((r) => String(r.table)))].join(", ")}` : "no violations");
  const bad: string[] = [];
  for (const [name, info] of Object.entries(m.tables)) {
    const r = got.data.get(name);
    if (!r) { bad.push(`${name}: missing`); continue; }
    if (r.rows.length !== info.rows) bad.push(`${name}: ${r.rows.length} rows, expected ${info.rows}`);
    else if (tableHash(r.rows) !== info.sha256) bad.push(`${name}: same count, different content`);
  }
  add("record counts and content", bad.length === 0, bad.length ? bad.slice(0, 8).join("; ") : `${Object.keys(m.tables).length} tables, ${m.totals.rows} rows, every table's SHA-256 identical`);
  const crit = criticalOf(got.data);
  const diff = Object.keys(m.critical).filter((k) => crit[k] !== m.critical[k]);
  add("critical records", diff.length === 0, diff.length ? `differs: ${diff.join(", ")}` : "owner record, audit log, users, enrolments, classes/attendance, assignments, submissions, orders, instalments, payments, webhook events, MFA: identical");
  if (m.critical.owner_record_rows) add("owner record usable", crit.owner_record_user_is_admin === 1, crit.owner_record_user_is_admin === 1 ? "owner_record points at an existing administrator account" : "owner_record does not point at an administrator");
  // Full-text search index (FTS5): SQLite's own integrity check on the restored copy (isolated database only).
  for (const v of got.schema.filter((e) => /^CREATE\s+VIRTUAL\s+TABLE/i.test(e.sql) && /USING\s+fts5/i.test(e.sql))) {
    try { execLocal(t, `INSERT INTO "${v.name}"("${v.name}") VALUES('integrity-check')`); add(`search index ${v.name}`, true, "FTS5 integrity check passed"); }
    catch (e) { add(`search index ${v.name}`, false, (e as Error).message); }
  }
  add("migration history restored", JSON.stringify(got.migrations.at(-1) ?? null) === JSON.stringify(m.migration.latest), `latest: ${got.migrations.at(-1) ?? "none"}`);
  // 8. compatibility with this Worker version
  const compat = compatibility(got.migrations, got.schema);
  return report(compat);
}

// ---- CLI ----
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const val = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
  if (!file) { console.error("Usage: npm run db:restore:verify -- <backup.sql|backup.sql.enc> [--key private.pem] [--report report.json] [--keep]"); process.exit(2); }
  try {
    const r = verifyRestore(file, { privateKey: val("--key"), reportFile: val("--report") ?? `${file}.restore-report.json`, keep: args.includes("--keep") });
    for (const c of r.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
    console.log(`Compatibility with this Worker: ${r.compatibility.status} - ${r.compatibility.detail}`);
    console.log(r.kept ? `Restored copy kept for inspection in ${r.isolatedDir} (confidential: delete it when done).` : "Restored copy removed.");
    console.log(r.ok ? "RESTORE VERIFIED" : "RESTORE NOT VERIFIED");
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.error(`FAIL: ${(e as D1Error).message}`); process.exit(1); }
}
