// Stage 3A: SQLite-aware parsing, destructive-statement detection, migration preflight and the production approval gate.
// Fast unit tests (no Wrangler): states, manifests and restore reports are built in temporary directories.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitSql, classify, classifySql, SqlParseError } from "../scripts/db/sql.mts";
import { preflight, REVIEWS_FILE, type State, type Review } from "../scripts/db/preflight.mts";
import { compatibility, compareSchema, loadExpected } from "../scripts/db/restore.mts";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const made: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); made.push(d); return d; };
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const ADD = "CREATE TABLE IF NOT EXISTS t (id TEXT PRIMARY KEY);\nALTER TABLE t ADD COLUMN note TEXT;\nCREATE INDEX IF NOT EXISTS t_note ON t(note);\n";
function migDir(files: Record<string, string>) {
  const d = tmp("sma-mig-");
  for (const [n, sql] of Object.entries(files)) writeFileSync(join(d, n), sql);
  return d;
}
const state = (migrations: string[] | null, over: Partial<State> = {}): State => ({
  capturedAt: new Date().toISOString(), target: { kind: "local", database: "skillmountainacademy-db" },
  tables: migrations === null ? [] : ["d1_migrations", "t"], migrations, schema: [], rows: 10, ...over,
});
const noSchema = () => [];
// A backup + manifest + passing restore report, without touching any database.
function fakeBackup(o: { migration: string | null; createdAt?: Date; rows?: number; kind?: string; restoreOk?: boolean; reportFor?: string; tamper?: boolean } ) {
  const d = tmp("sma-bk-");
  const file = join(d, "skillmountainacademy-db-test.sql");
  writeFileSync(file, "-- backup\nCREATE TABLE x (a);\n");
  const m = { format: "sma-d1-logical-backup/1", createdAt: (o.createdAt ?? new Date()).toISOString(), source: { kind: o.kind ?? "local", database: "skillmountainacademy-db" },
    migration: { latest: o.migration, applied: 1 }, schema: [], tables: {}, totals: { tables: 1, rows: 40, institutionalRows: o.rows ?? 25 }, classes: {}, critical: {}, triggers: [], indexes: 0,
    file: { name: "x", bytes: 10, sha256: o.tamper ? "0".repeat(64) : sha(readFileSync(file)) }, warnings: [] };
  writeFileSync(`${file}.manifest.json`, JSON.stringify(m));
  // Restore reports are bound to the exact bytes of the backup and manifest (Stage 3A.1).
  if (o.restoreOk !== undefined) writeFileSync(`${file}.restore-report.json`, JSON.stringify({ ok: o.restoreOk, backup: o.reportFor ?? file, checks: [],
    backupSha256: sha(readFileSync(file)), manifestSha256: sha(readFileSync(`${file}.manifest.json`)) }));
  return file;
}

// ------------------------------------------------------------------ SQL parsing ----
test("splitter: triggers with BEGIN ... END bodies (several statements, CASE ... END) stay whole", () => {
  const sql = `CREATE TABLE a (x);
CREATE TRIGGER t1 BEFORE UPDATE ON a BEGIN SELECT RAISE(ABORT, 'no; never'); END;
CREATE TRIGGER t2 AFTER INSERT ON a WHEN NEW.x > 0 BEGIN
  UPDATE a SET x = CASE WHEN NEW.x > 10 THEN 10 ELSE NEW.x END WHERE rowid = NEW.rowid;
  INSERT INTO a (x) SELECT CASE x WHEN 1 THEN 2 END FROM a LIMIT 0;
END;
CREATE TEMP TRIGGER t3 BEFORE DELETE ON a BEGIN SELECT 1; END;
SELECT 'trigger; begin; end';`;
  const st = splitSql(sql);
  assert.deepEqual(st.map((s) => s.isTrigger), [false, true, true, true, false]);
  assert.equal(st[2].body!.length, 2, "two statements inside t2");
  assert.equal(st[4].code, "SELECT 'trigger; begin; end'");
});

test("splitter: semicolons in strings, quoted identifiers and comments are not statement ends; line numbers kept", () => {
  const sql = "-- a comment; with a semicolon\nINSERT INTO \"we;ird\" (\"a;b\", [c;d], `e;f`) VALUES ('it''s; fine', 'x');\n/* block; comment */ SELECT 1;\nSELECT 2";
  const st = splitSql(sql);
  assert.equal(st.length, 3);
  assert.equal(st[0].line, 2);
  assert.match(st[0].code, /'it''s; fine'/);
  assert.equal(st[1].line, 3);
});

test("splitter: ambiguous SQL is refused, never guessed", () => {
  for (const bad of ["INSERT INTO a VALUES ('unterminated);", "SELECT 1; /* never closed", "CREATE TRIGGER t BEFORE INSERT ON a BEGIN SELECT 1;", "SELECT \"open identifier;", "CREATE TRIGGER t BEFORE INSERT ON a SELECT 1; END;"])
    assert.throws(() => splitSql(bad), SqlParseError, bad);
});

test("every migration in the repository parses; 0010's four triggers are recognised whole", () => {
  for (const f of readdirSync("migrations").filter((x) => x.endsWith(".sql"))) assert.doesNotThrow(() => splitSql(readFileSync(join("migrations", f), "utf8")), f);
  const st = splitSql(readFileSync("migrations/0010_owner_integrity.sql", "utf8"));
  assert.equal(st.length, 6);
  assert.deepEqual(st.filter((s) => s.isTrigger).map((s) => s.code.match(/TRIGGER IF NOT EXISTS (\w+)/)![1]), ["owner_record_no_update", "owner_record_no_delete", "audit_log_no_update", "audit_log_min_retention"]);
  assert.deepEqual(classifySql(readFileSync("migrations/0010_owner_integrity.sql", "utf8")).findings, [], "0010 is additive (RAISE-only trigger bodies)");
});

// ------------------------------------------------------------------ destructive detection ----
test("classifier: additive is safe; DROP, DROP COLUMN, RENAME, DELETE, TRUNCATE and UPDATE without WHERE are destructive", () => {
  const kind = (sql: string) => splitSql(sql).flatMap(classify).map((f) => `${f.severity}:${f.kind}`);
  assert.deepEqual(kind(ADD), []);
  assert.deepEqual(kind("DROP TABLE users;"), ["destructive:DROP TABLE"]);
  assert.deepEqual(kind("DROP INDEX IF EXISTS x;"), ["destructive:DROP INDEX"]);
  assert.deepEqual(kind("ALTER TABLE users DROP COLUMN email;"), ["destructive:ALTER TABLE ... DROP COLUMN"]);
  assert.deepEqual(kind("ALTER TABLE users RENAME TO people;"), ["destructive:ALTER TABLE ... RENAME"]);
  assert.deepEqual(kind("ALTER TABLE users RENAME COLUMN a TO b;"), ["destructive:ALTER TABLE ... RENAME"]);
  assert.deepEqual(kind("DELETE FROM payments;"), ["destructive:DELETE (every row)"]);
  assert.deepEqual(kind("TRUNCATE payments;"), ["destructive:TRUNCATE"]);
  assert.deepEqual(kind("UPDATE orders SET status = 'paid';"), ["destructive:UPDATE (every row)"]);
  assert.deepEqual(kind("UPDATE users SET x = 1 WHERE role = 'admin';"), ["review:UPDATE (data backfill with WHERE)"]);
  assert.deepEqual(kind("INSERT OR REPLACE INTO a VALUES (1);"), ["review:REPLACE (overwrites existing rows)"]);
  assert.deepEqual(kind("BEGIN TRANSACTION;"), ["forbidden:transaction control (not allowed in D1 migrations)"]);
  assert.deepEqual(kind("CREATE TRIGGER t AFTER INSERT ON a BEGIN DELETE FROM b; END;"), ["review:trigger body writes data"]);
});

// ------------------------------------------------------------------ preflight ----
test("preflight: a valid additive migration passes once a verified backup at the current version is supplied", () => {
  const dir = migDir({ "0001_init.sql": ADD, "0002_more.sql": "CREATE TABLE u (id TEXT);\n" });
  const st = state(["0001_init.sql"]);
  const without = preflight({ migrationsDir: dir, state: st, reviews: {}, expectedSchemaFor: noSchema });
  assert.equal(without.result, "FAIL");
  assert.deepEqual(without.pending, ["0002_more.sql"]);
  assert.ok(without.failures.some((f) => /backup: a verified backup .* is required/.test(f)), "missing required backup");
  const ok = preflight({ migrationsDir: dir, state: st, reviews: {}, expectedSchemaFor: noSchema, backupFile: fakeBackup({ migration: "0001_init.sql", restoreOk: true }) });
  assert.deepEqual([ok.result, ok.failures], ["PASS", []]);
  assert.equal(ok.targetKind, "local");
  // Nothing pending: no backup needed.
  assert.equal(preflight({ migrationsDir: dir, state: state(["0001_init.sql", "0002_more.sql"]), reviews: {}, expectedSchemaFor: noSchema }).result, "PASS");
});

test("preflight: a destructive migration is blocked until reviewed for its exact contents and acknowledged", () => {
  const drop = "ALTER TABLE t DROP COLUMN note;\n";
  const dir = migDir({ "0001_init.sql": ADD, "0002_drop.sql": drop });
  const st = state(["0001_init.sql"]);
  const backupFile = fakeBackup({ migration: "0001_init.sql", restoreOk: true });
  const run = (reviews: Record<string, Review>) => preflight({ migrationsDir: dir, state: st, reviews, expectedSchemaFor: noSchema, backupFile });
  assert.ok(run({}).failures.some((f) => /0002_drop\.sql needs an explicit review/.test(f)));
  const base: Review = { sha256: sha(drop), reviewedBy: "Reviewer", reviewedAt: "2026-11-22", summary: "drops note" };
  assert.ok(run({ "0002_drop.sql": { ...base, sha256: sha("something else") } }).failures.some((f) => /changed after it was reviewed/.test(f)));
  assert.ok(run({ "0002_drop.sql": base }).failures.some((f) => /destructiveAcknowledged/.test(f)));
  assert.ok(run({ "0002_drop.sql": { ...base, destructiveAcknowledged: true, ownerApprovalRequired: true } }).failures.some((f) => /owner's decision/.test(f)));
  assert.equal(run({ "0002_drop.sql": { ...base, destructiveAcknowledged: true, ownerApprovalRequired: true, ownerApproved: true } }).result, "PASS");
  // Transaction control is never allowed, review or not.
  const dir2 = migDir({ "0001_init.sql": ADD, "0002_tx.sql": "BEGIN;\nCREATE TABLE z (a);\nCOMMIT;\n" });
  assert.ok(preflight({ migrationsDir: dir2, state: st, reviews: {}, expectedSchemaFor: noSchema, backupFile }).failures.some((f) => /never allowed/.test(f)));
});

test("preflight: a migration containing SQLite triggers passes (no naive semicolon splitting)", () => {
  const dir = migDir({ "0001_init.sql": ADD, "0002_trig.sql": readFileSync("migrations/0010_owner_integrity.sql", "utf8").replace(/owner_record|audit_log/g, "t") });
  const r = preflight({ migrationsDir: dir, state: state(["0001_init.sql"]), reviews: {}, expectedSchemaFor: noSchema, backupFile: fakeBackup({ migration: "0001_init.sql", restoreOk: true }) });
  assert.deepEqual(r.failures, []);
  assert.equal(r.files[1].statements, 6);
});

test("preflight: missing migration file, duplicate number, gap and out-of-order history all fail", () => {
  const dir = migDir({ "0001_init.sql": ADD, "0002_b.sql": "CREATE TABLE b (a);\n" });
  const missing = preflight({ migrationsDir: dir, state: state(["0001_init.sql", "0002_b.sql", "0003_gone.sql"]), reviews: {}, expectedSchemaFor: noSchema });
  assert.ok(missing.failures.some((f) => /0003_gone\.sql has no file in the repository/.test(f)), "missing migration file");
  const dup = preflight({ migrationsDir: migDir({ "0001_init.sql": ADD, "0002_a.sql": "CREATE TABLE a (a);\n", "0002_b.sql": "CREATE TABLE b (a);\n" }), state: state([]), reviews: {}, expectedSchemaFor: noSchema });
  assert.ok(dup.failures.some((f) => /duplicate migration number 0002/.test(f)));
  const gap = preflight({ migrationsDir: migDir({ "0001_init.sql": ADD, "0003_c.sql": "CREATE TABLE c (a);\n" }), state: state([]), reviews: {}, expectedSchemaFor: noSchema });
  assert.ok(gap.failures.some((f) => /unexpected ordering at 0003_c\.sql/.test(f)));
  const order = preflight({ migrationsDir: dir, state: state(["0002_b.sql"]), reviews: {}, expectedSchemaFor: noSchema });
  assert.ok(order.failures.some((f) => /out of order/.test(f)));
  const badName = preflight({ migrationsDir: migDir({ "0001_init.sql": ADD, "2_bad.sql": "SELECT 1;\n" }), state: state([]), reviews: {}, expectedSchemaFor: noSchema });
  assert.ok(badName.failures.some((f) => /not named NNNN_name\.sql/.test(f)));
});

test("preflight fails closed when the migration state cannot be established", () => {
  const dir = migDir({ "0001_init.sql": ADD });
  assert.ok(preflight({ migrationsDir: dir, state: null, reviews: {}, expectedSchemaFor: noSchema }).failures.some((f) => /fail closed/.test(f)), "no state");
  const noHistory = preflight({ migrationsDir: dir, state: state(null, { tables: ["users", "orders"] }), reviews: {}, expectedSchemaFor: noSchema });
  assert.ok(noHistory.failures.some((f) => /no migration history .* unknown \(fail closed\)/.test(f)), "tables but no d1_migrations");
  assert.deepEqual(noHistory.pending, [], "nothing is treated as pending when the state is unknown");
  const stale = preflight({ migrationsDir: dir, state: state(["0001_init.sql"], { capturedAt: new Date(Date.now() - 5 * 3600_000).toISOString() }), reviews: {}, expectedSchemaFor: noSchema });
  assert.ok(stale.failures.some((f) => /captured state is 5\.0 hours old/.test(f)));
});

test("preflight: schema drift (database differs from what its applied migrations produce) fails", () => {
  const dir = migDir({ "0001_init.sql": ADD });
  const expected = [{ type: "table", name: "t", tbl_name: "t", sql: "CREATE TABLE t (id TEXT PRIMARY KEY, note TEXT)" }];
  const drift = preflight({ migrationsDir: dir, state: state(["0001_init.sql"], { schema: [...expected, { type: "table", name: "hand_made", tbl_name: "hand_made", sql: "CREATE TABLE hand_made (a)" }] }), reviews: {}, expectedSchemaFor: () => expected });
  assert.ok(drift.failures.some((f) => /schema: .* extra table:hand_made/.test(f)));
  assert.equal(preflight({ migrationsDir: dir, state: state(["0001_init.sql"], { schema: expected }), reviews: {}, expectedSchemaFor: () => expected }).result, "PASS");
});

test("preflight: backup must exist, match its manifest, be recent, be at the current version, hold records and be restore-verified", () => {
  const dir = migDir({ "0001_init.sql": ADD, "0002_more.sql": "CREATE TABLE u (id TEXT);\n" });
  const st = state(["0001_init.sql"]);
  const f = (o: Parameters<typeof fakeBackup>[0], extra: Partial<Parameters<typeof preflight>[0]> = {}) =>
    preflight({ migrationsDir: dir, state: st, reviews: {}, expectedSchemaFor: noSchema, backupFile: fakeBackup(o), ...extra }).failures.join(" | ");
  assert.match(preflight({ migrationsDir: dir, state: st, reviews: {}, expectedSchemaFor: noSchema, backupFile: "/nonexistent/backup.sql" }).failures.join(), /missing required backup/);
  assert.match(f({ migration: "0001_init.sql", restoreOk: true, tamper: true }), /does not match its manifest/);
  assert.match(f({ migration: "0001_init.sql", restoreOk: true, createdAt: new Date(Date.now() - 30 * 3600_000) }), /hours old/);
  assert.match(f({ migration: null, restoreOk: true }), /backup is at migration none, the database is at 0001_init\.sql/);
  assert.match(f({ migration: "0001_init.sql", restoreOk: true, rows: 0 }), /holds no institutional records/, "a backup with no records");
  assert.doesNotMatch(f({ migration: "0001_init.sql", restoreOk: true, rows: 0 }, { allowEmptyBackup: true }), /holds no institutional records/);
  assert.match(f({ migration: "0001_init.sql" }), /restore has not been verified/);
  assert.match(f({ migration: "0001_init.sql", restoreOk: false }), /restore verification of this backup did not pass/);
  assert.match(f({ migration: "0001_init.sql", restoreOk: true, reportFor: "/other/backup.sql" }), /restore verification of this backup did not pass/);
  assert.match(f({ migration: "0001_init.sql", restoreOk: true, kind: "remote" }), /taken from a remote database, the state is of a local database/);
});

test("compatibility: compatible, older, newer and drifted schemas are told apart", () => {
  const e = loadExpected();
  assert.equal(compatibility(e.migrations, e.schema, e).status, "compatible");
  assert.equal(compatibility(e.migrations.slice(0, 9), e.schema, e).status, "older_schema");
  assert.deepEqual(compatibility(e.migrations.slice(0, 9), e.schema, e).pending, ["0010_owner_integrity.sql", "0011_catalogue.sql", "0012_pricing_snapshot.sql"]);
  assert.equal(compatibility([...e.migrations, "0013_future.sql"], e.schema, e).status, "newer_schema");
  assert.equal(compatibility(["0001_init.sql", "0003_lms.sql"], e.schema, e).status, "schema_drift");
  assert.equal(compatibility([], e.schema, e).status, "unknown");
  const noTrig = e.schema.filter((x) => x.type !== "trigger");
  assert.equal(compatibility(e.migrations, noTrig, e).status, "schema_drift", "a schema missing the 0010 triggers is not compatible");
  assert.deepEqual(compareSchema(noTrig, e.schema).missing.sort(), ["trigger:audit_log_min_retention", "trigger:audit_log_no_update", "trigger:owner_record_no_delete", "trigger:owner_record_no_update"]);
});

test("the recorded reviews match the reviewed migration files exactly; owner decisions are still open", () => {
  const reviews = JSON.parse(readFileSync(REVIEWS_FILE, "utf8")) as Record<string, Review>;
  for (const [f, r] of Object.entries(reviews)) assert.equal(r.sha256, sha(readFileSync(join("migrations", f))), `${f} changed after its review`);
  // Every repository migration with statements that change existing rows has a review.
  for (const f of readdirSync("migrations").filter((x) => x.endsWith(".sql"))) {
    const risky = classifySql(readFileSync(join("migrations", f), "utf8")).findings.filter((x) => x.severity !== "safe");
    if (risky.length) assert.ok(reviews[f], `${f} has risky statements but no review`);
  }
  for (const f of ["0002_seed_programmes.sql", "0004_admissions.sql", "0007_refinement.sql"]) assert.deepEqual([reviews[f].ownerApprovalRequired, reviews[f].ownerApproved], [true, false], f);
});

test("every table in the expected schema has a backup classification; financial, academic, identity and security are never disposable", async () => {
  const { CLASSIFICATION, isInstitutional } = await import("../scripts/db/classification.mts");
  const tables = loadExpected().schema.filter((e) => e.type === "table").map((e) => e.name);
  assert.deepEqual(tables.filter((t) => !CLASSIFICATION[t]), [], "unclassified tables");
  const disposable = Object.entries(CLASSIFICATION).filter(([, c]) => c.class === "disposable").map(([t]) => t).sort();
  assert.deepEqual(disposable, ["auth_sessions", "auth_tokens", "error_log", "rate_limits"]);
  for (const t of ["owner_record", "audit_log", "mfa_factors", "mfa_recovery_codes", "staff_removal_requests", "payments", "instalments", "webhook_events", "orders", "submissions", "class_sessions", "enrolments", "users"]) assert.equal(isInstitutional(t), true, t);
});

test("the Worker's expected schema version equals the last migration and the schema snapshot", async () => {
  const { EXPECTED_MIGRATION, schemaStatus } = await import("../src/server/schema-version.ts");
  const files = readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort();
  assert.equal(EXPECTED_MIGRATION, files.at(-1));
  assert.equal(EXPECTED_MIGRATION, loadExpected().migration);
  assert.equal(schemaStatus(EXPECTED_MIGRATION).status, "compatible");
  assert.equal(schemaStatus("0009_owner.sql").status, "database_older");
  assert.equal(schemaStatus("0013_next.sql").status, "database_newer");
  assert.equal(schemaStatus(null).status, "unknown");
});

test("preflight: a backup substituted after its restore verification is refused, even with a self-consistent manifest", () => {
  const dir = migDir({ "0001_init.sql": ADD, "0002_more.sql": "CREATE TABLE u (id TEXT);\n" });
  const file = fakeBackup({ migration: "0001_init.sql", restoreOk: true });
  writeFileSync(file, "-- a DIFFERENT backup\nCREATE TABLE y (b);\n");
  const m = JSON.parse(readFileSync(`${file}.manifest.json`, "utf8"));
  m.file.sha256 = sha(readFileSync(file));
  writeFileSync(`${file}.manifest.json`, JSON.stringify(m));
  const r = preflight({ migrationsDir: dir, state: state(["0001_init.sql"]), reviews: {}, expectedSchemaFor: noSchema, backupFile: file });
  assert.ok(r.failures.some((f) => /restore verification of this backup did not pass/.test(f)), r.failures.join(" | "));
});

test("preflight on REMOTE state: verified identity required; backup must be the same account+UUID and encrypted", () => {
  const dir = migDir({ "0001_init.sql": ADD, "0002_more.sql": "CREATE TABLE u (id TEXT);\n" });
  const id = { accountId: "a".repeat(32), databaseUuid: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" };
  const remote = (identity?: typeof id) => state(["0001_init.sql"], { target: { kind: "remote", database: "skillmountainacademy-db", ...(identity ? { identity } : {}) } });
  const bk = (identity?: typeof id, encrypted = true) => {
    const f = fakeBackup({ migration: "0001_init.sql", restoreOk: true, kind: "remote" });
    const m = JSON.parse(readFileSync(`${f}.manifest.json`, "utf8"));
    if (identity) m.source.identity = identity;
    if (encrypted) m.encrypted = { sha256: "x" };
    writeFileSync(`${f}.manifest.json`, JSON.stringify(m));
    writeFileSync(`${f}.restore-report.json`, JSON.stringify({ ok: true, backup: f, checks: [], backupSha256: sha(readFileSync(f)), manifestSha256: sha(readFileSync(`${f}.manifest.json`)) }));
    return f;
  };
  const run = (st: State, f: string) => preflight({ migrationsDir: dir, state: st, reviews: {}, expectedSchemaFor: noSchema, backupFile: f }).failures.join(" | ");
  assert.match(run(remote(), bk(id)), /remote state must carry the verified account ID and database UUID/);
  assert.match(run(remote(id), bk({ ...id, databaseUuid: "3f2504e0-4f89-41d3-9a0c-0305e82c3302" })), /not of the same database/, "same name, different UUID");
  assert.match(run(remote(id), bk({ ...id, accountId: "b".repeat(32) })), /not of the same database/, "same UUID, different account");
  assert.match(run(remote(id), bk(undefined)), /not of the same database/, "backup without identity");
  assert.match(run(remote(id), bk(id, false)), /must be encrypted/);
  const ok = preflight({ migrationsDir: dir, state: remote(id), reviews: {}, expectedSchemaFor: noSchema, backupFile: bk(id) });
  assert.deepEqual([ok.result, ok.identity], ["PASS", id]);
});
