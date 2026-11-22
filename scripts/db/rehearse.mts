// Migration rehearsal (Stage 3A): step 4 and 5 of the migration workflow. Restores a verified backup into a new isolated
// local database, applies the pending migrations to THAT COPY with Wrangler (exactly as production would), and verifies
// the result: schema equals what this Worker expects, triggers present, foreign keys intact, and which tables' data the
// migrations changed (every changed table is listed for the operator's review). Production is never touched.
//   npm run db:rehearse -- <backup.sql[.enc]> [--key private.pem] [--report rehearsal.json]
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isMain, parseArgs } from "./args.mts";
import { applyMigrations, localTarget, migrationFiles, query, ROOT } from "./d1.mts";
import { readAll, tableHash, type Manifest } from "./dump.mts";
import { compareSchema, loadExpected, verifyRestore, type Check } from "./restore.mts";

export type Rehearsal = {
  ok: boolean; at: string; backup: string; backupSha256: string; manifestSha256: string; from: string | null; to: string | null; applied: string[];
  // The exact migration files rehearsed (Stage 3A.1): the gate refuses if any differs at execution time.
  files: { name: string; sha256: string }[];
  checks: Check[]; changedTables: { table: string; rowsBefore: number; rowsAfter: number }[]; newTables: { table: string; rows: number }[];
};

export function rehearse(backupFile: string, opts: { privateKey?: string; reportFile?: string; keep?: boolean } = {}): Rehearsal {
  const file = resolve(backupFile);
  const mf = file.endsWith(".enc") ? `${file.slice(0, -4)}.manifest.json` : `${file}.manifest.json`;
  const m = JSON.parse(readFileSync(mf, "utf8")) as Manifest;
  const hash = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
  // Hashes taken BEFORE the rehearsal: the bytes that are actually rehearsed.
  const backupSha256 = hash(file), manifestSha256 = hash(mf);
  const files = migrationFiles().map((name) => ({ name, sha256: hash(join(ROOT, "migrations", name)) }));
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const r = verifyRestore(file, { privateKey: opts.privateKey, keep: true });
  add("restore verified", r.ok, r.ok ? "backup restored and verified in an isolated database" : r.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; "));
  const done = (extra: Partial<Rehearsal> = {}): Rehearsal => {
    const out: Rehearsal = { ok: checks.every((c) => c.ok), at: new Date().toISOString(), backup: file, backupSha256, manifestSha256, files,
      from: m.migration.latest, to: null, applied: [], changedTables: [], newTables: [], ...extra, checks };
    if (opts.reportFile) writeFileSync(opts.reportFile, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
    if (!opts.keep) rmSync(r.isolatedDir, { recursive: true, force: true }); // the copy holds confidential records
    return out;
  };
  if (r.ok && (r.backupSha256 !== backupSha256 || r.manifestSha256 !== manifestSha256)) add("backup unchanged during rehearsal", false, "the backup or manifest changed while it was being rehearsed");
  if (!r.ok) return done();
  const t = localTarget(join(r.isolatedDir, "db"), { reuse: true });
  const before = (query(t, "SELECT name FROM d1_migrations ORDER BY id")[0] as { name: string }[]).map((x) => x.name);
  try { applyMigrations(t); add("pending migrations applied to the copy", true, "wrangler d1 migrations apply (isolated copy)"); }
  catch (e) { add("pending migrations applied to the copy", false, (e as Error).message); return done(); }
  const after = readAll(t);
  const applied = after.migrations.slice(before.length);
  const expected = loadExpected();
  const d = compareSchema(after.schema, expected.schema);
  add("schema matches this Worker", !d.missing.length && !d.extra.length && !d.changed.length, `expects ${expected.migration}; missing ${d.missing.length}, extra ${d.extra.length}, changed ${d.changed.length}`);
  const trig = expected.schema.filter((e) => e.type === "trigger").map((e) => e.name);
  const have = new Set(after.schema.filter((e) => e.type === "trigger").map((e) => e.name));
  add("triggers present", trig.every((x) => have.has(x)), trig.join(", "));
  const fk = query(t, "PRAGMA foreign_key_check")[0];
  add("foreign keys", fk.length === 0, fk.length ? `${fk.length} violation(s)` : "no violations");
  const changedTables: Rehearsal["changedTables"] = [];
  const newTables: Rehearsal["newTables"] = [];
  for (const [name, d2] of after.data) {
    const was = m.tables[name];
    if (!was) { newTables.push({ table: name, rows: d2.rows.length }); continue; }
    if (was.rows !== d2.rows.length || was.sha256 !== tableHash(d2.rows)) changedTables.push({ table: name, rowsBefore: was.rows, rowsAfter: d2.rows.length });
  }
  const lost = Object.keys(m.tables).filter((n) => !after.data.has(n));
  add("no table lost", lost.length === 0, lost.length ? `missing after migration: ${lost.join(", ")}` : "every table from the backup still exists");
  const shrank = changedTables.filter((c) => c.rowsAfter < c.rowsBefore && c.table !== "d1_migrations");
  add("no records removed", shrank.length === 0, shrank.length ? shrank.map((c) => `${c.table}: ${c.rowsBefore} -> ${c.rowsAfter}`).join("; ") : "no table has fewer rows");
  return done({ from: before.at(-1) ?? null, to: after.migrations.at(-1) ?? null, applied, changedTables: changedTables.filter((c) => c.table !== "d1_migrations"), newTables });
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  const file = a.positional[0];
  if (!file) { console.error("Usage: npm run db:rehearse -- <backup.sql[.enc]> [--key private.pem]"); process.exit(2); }
  try {
    const r = rehearse(file, { privateKey: a.str("key"), reportFile: a.str("report") ?? `${file}.rehearsal.json` });
    for (const c of r.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
    console.log(`Applied to the copy: ${r.applied.join(", ") || "nothing pending"} (${r.from ?? "none"} -> ${r.to ?? "none"})`);
    for (const c of r.changedTables) console.log(`REVIEW  data changed in ${c.table}: ${c.rowsBefore} -> ${c.rowsAfter} rows`);
    if (r.newTables.length) console.log(`New tables: ${r.newTables.map((x) => `${x.table} (${x.rows} rows)`).join(", ")}`);
    console.log(r.ok ? "REHEARSAL PASSED: review the changes above before approving production." : "REHEARSAL FAILED");
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.error(`FAIL: ${(e as Error).message}`); process.exit(1); }
}
