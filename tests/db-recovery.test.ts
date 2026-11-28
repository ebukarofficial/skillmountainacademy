// Stage 3A: backup, isolated restore and migration rehearsal against REAL local D1 databases (Wrangler, the same tool
// production uses). Every database here is an isolated scratch directory; nothing remote is ever contacted.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { applyMigrations, execLocal, executeFile as execLocalFile, localTarget, query, D1Error, type Target } from "../scripts/db/d1.mts";
import { backup, sha256File } from "../scripts/db/dump.mts";
import { EXPECTED_SCHEMA_FILE, verifyRestore } from "../scripts/db/restore.mts";
import { rehearse } from "../scripts/db/rehearse.mts";
import { captureState } from "../scripts/db/state.mts";
import { preflight } from "../scripts/db/preflight.mts";
import { buildExpected } from "../scripts/db/schema.mts";
import { compareManifests } from "../scripts/db/compare.mts";
import { decryptBackup } from "../scripts/db/decrypt.mts";
import { compareManifests as cmp, verifyPostReset } from "../scripts/db/compare.mts";
import { postRestoreSql } from "../scripts/db/post-restore.mts";
import { decideRollback, gatherFacts } from "../scripts/db/rollback.mts";

const ROOT = mkdtempSync(join(tmpdir(), "sma-dr-"));
const dir = (n: string) => join(ROOT, n);
let full: Target, at9: Target;
const NOW = new Date().toISOString();
const TRICKY = "O'Neil; DROP TABLE users; -- not a comment /* nor this */ END; 'quoted' \"double\" Ọlá ₦ — é";

// Realistic records in every critical table, with awkward text.
const SEED = `
INSERT INTO users (id, email, role, full_name, status, created_at, admin_role) VALUES
 ('u-own','bookebukar@gmail.com','admin','Owner','active','${NOW}','super'),
 ('u-fin','fin@example.com','admin','Finance','active','${NOW}','finance'),
 ('u-stu','stu@example.com','student','${TRICKY.replace(/'/g, "''")}','active','${NOW}',NULL),
 ('u-ins','ins@example.com','instructor','Instructor','active','${NOW}',NULL),
 ('u-gone','gone@example.com','instructor','Removed','suspended','${NOW}',NULL);
UPDATE users SET removed_at = '${NOW}', removed_by = 'u-own', removal_reason = 'Contract ended' WHERE id = 'u-gone';
INSERT INTO owner_record (id, user_id, email, bootstrapped_at) VALUES (1,'u-own','bookebukar@gmail.com','${NOW}');
INSERT INTO audit_log (id, at, actor_id, action, target_type, target_id, detail) VALUES
 ('a1','${NOW}','u-own','owner.bootstrap','user','u-own','{"email":"bookebukar@gmail.com"}'),
 ('a2','2020-01-01T00:00:00Z','u-own','owner.remove','user','u-gone','{"reason":"Contract ended; records kept"}');
INSERT INTO mfa_factors (user_id, secret_enc, status, enabled_at, last_step, created_at) VALUES ('u-own','v1.ENCRYPTED-NOT-A-SECRET','active','${NOW}',123,'${NOW}');
INSERT INTO mfa_recovery_codes (id, user_id, code_hash, created_at) VALUES ('rc1','u-own','hash-1','${NOW}'), ('rc2','u-own','hash-2','${NOW}');
INSERT INTO staff_removal_requests (id, user_id, requested_by, reason, status, decided_by, decided_at, created_at) VALUES ('rr1','u-gone','u-fin','Left','approved','u-own','${NOW}','${NOW}');
INSERT INTO enrolments (id, student_id, programme_slug, instructor_id, status, started_at, created_at) VALUES ('e1','u-stu','webdev','u-ins','active','${NOW}','${NOW}');
INSERT INTO timetables (id, enrolment_id, weekday, start_time, duration_min, effective_from, created_by, created_at) VALUES ('tt1','e1',2,'10:00',60,'2026-11-01','u-own','${NOW}');
INSERT INTO class_sessions (id, enrolment_id, student_id, instructor_id, starts_at, ends_at, status, created_at) VALUES
 ('c1','e1','u-stu','u-ins','2026-11-03T09:00:00Z','2026-11-03T10:00:00Z','completed','${NOW}'),
 ('c2','e1','u-stu','u-ins','2026-11-10T09:00:00Z','2026-11-10T10:00:00Z','missed','${NOW}'),
 ('c3','e1','u-stu','u-ins','2026-12-01T09:00:00Z','2026-12-01T10:00:00Z','scheduled','${NOW}');
INSERT INTO assignments (id, student_id, instructor_id, enrolment_id, title, due_at, created_at) VALUES ('as1','u-stu','u-ins','e1','Build a page; then test it','${NOW}','${NOW}');
INSERT INTO submissions (id, assignment_id, student_id, text, submitted_at, score, graded_at) VALUES ('s1','as1','u-stu','line one
line two with ''quotes''','${NOW}',87,'${NOW}');
INSERT INTO registrations (id, created_at, role, programme_slug, first_name, email) VALUES ('r1','${NOW}','learner','webdev','Ada','ada@example.com');
INSERT INTO orders (id, reference, created_at, registration_id, programme_slug, plan, method, total_kobo, regular_kobo, status) VALUES ('o1','SMA-REF-1','${NOW}','r1','webdev','parts','bank',45000000,45000000,'part_paid');
INSERT INTO instalments (id, order_id, seq, amount_kobo, due_date, reference, status) VALUES ('i1','o1',1,22500000,'2026-11-01','SMA-REF-1-1','paid'), ('i2','o1',2,22500000,'2026-12-01','SMA-REF-1-2','due');
INSERT INTO payments (id, order_id, instalment_id, provider, provider_ref, amount_kobo, currency, status, created_at) VALUES ('p1','o1','i1','bank','BANK-1',22500000,'NGN','success','${NOW}');
INSERT INTO webhook_events (id, received_at) VALUES ('evt_1','${NOW}');
INSERT INTO messages (id, from_id, to_id, body, created_at) VALUES ('m1','u-ins','u-stu','${"Long message. ".repeat(400)}','${NOW}');
INSERT INTO notifications (id, user_id, kind, title, created_at) VALUES ('n1','u-stu','class','Class tomorrow','${NOW}');
INSERT INTO resource_chunks (resource_id, programme_slug, title, body) VALUES ('res1','webdev','Intro; HTML','Tags; attributes; "quotes"');
`;

before(() => {
  full = localTarget(dir("full"));
  applyMigrations(full);
  execLocal(full, SEED);
  // A database stopped at migration 0009 (0010 pending), bootstrapped the Stage 2B way (app_settings).
  const m9 = dir("m9");
  mkdirSync(m9);
  for (const f of readdirSync("migrations").filter((x) => x.endsWith(".sql") && x < "0010")) copyFileSync(join("migrations", f), join(m9, f));
  at9 = localTarget(dir("at9"), { migrationsDir: m9 });
  applyMigrations(at9);
  execLocal(at9, `INSERT INTO users (id, email, role, full_name, status, created_at, admin_role) VALUES ('u-own','bookebukar@gmail.com','admin','Owner','active','${NOW}','super');
    INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('owner_bootstrap','{"by":"u-own","email":"bookebukar@gmail.com","at":"${NOW}"}','u-own','${NOW}');
    INSERT INTO audit_log (id, at, actor_id, action) VALUES ('b1','${NOW}','u-own','owner.bootstrap');`);
});
after(() => rmSync(ROOT, { recursive: true, force: true }));

test("backup: complete logical export (schema, every row, indexes, triggers) with a timestamped name and a data-free manifest", () => {
  const r = backup(full, dir("bk"));
  assert.match(basename(r.file), /^skillmountainacademy-db-\d{8}T\d{6}Z-m0017\.sql$/);
  const m = r.manifest;
  assert.deepEqual([m.migration.latest, m.migration.applied], ["0017_execution_fencing.sql", 17]);
  assert.deepEqual([...m.triggers].sort(), ["audit_log_min_retention", "audit_log_no_update", "owner_record_no_delete", "owner_record_no_update"]);
  assert.equal(m.critical.owner_record_rows, 1);
  assert.equal(m.critical.owner_record_user_is_admin, 1);
  assert.deepEqual([m.critical.attendance_completed, m.critical.attendance_missed, m.critical.submissions_graded], [1, 1, 1]);
  assert.deepEqual([m.critical.payments_total_kobo, m.critical.instalments_total_kobo, m.critical.orders_total_kobo], [22500000, 45000000, 45000000]);
  assert.deepEqual([m.critical.mfa_factors, m.critical.mfa_recovery_codes, m.critical.staff_removal_requests, m.critical.webhook_events], [1, 2, 1, 1]);
  assert.equal(m.tables.resource_chunks.virtual, true, "the full-text search table is included");
  assert.equal(m.file.sha256, sha256File(r.file));
  const sql = readFileSync(r.file, "utf8");
  for (const needle of ["CREATE TABLE owner_record", "INSERT INTO \"audit_log\"", "INSERT INTO \"d1_migrations\"", "CREATE TRIGGER audit_log_min_retention", "CREATE VIRTUAL TABLE resource_chunks"]) assert.ok(sql.includes(needle), needle);
  assert.ok(sql.indexOf("CREATE TRIGGER") > sql.lastIndexOf("INSERT INTO"), "triggers come after the data");
  // The manifest can be shared for review: no data values in it.
  const mtext = readFileSync(r.manifestFile, "utf8");
  for (const v of ["ENCRYPTED-NOT-A-SECRET", "hash-1", "O'Neil", "stu@example.com", "Contract ended"]) assert.ok(!mtext.includes(v), `manifest leaks ${v}`);
  assert.ok(!basename(r.file).includes("@"), "no data in the file name");
});

test("restore: a backup imports into a NEW empty isolated D1 and every check passes (schema, triggers, FKs, counts, content, critical records, compatibility)", () => {
  const b = backup(full, dir("bk2"));
  const report = verifyRestore(b.file, { reportFile: `${b.file}.restore-report.json`, keep: true });
  const failed = report.checks.filter((c) => !c.ok);
  assert.deepEqual(failed, [], JSON.stringify(failed));
  assert.equal(report.ok, true);
  for (const name of ["file checksum", "import", "schema identical to backup", "triggers restored", "foreign keys", "record counts and content", "critical records", "owner record usable", "search index resource_chunks", "migration history restored"])
    assert.ok(report.checks.some((c) => c.name === name && c.ok), name);
  assert.equal(report.compatibility.status, "compatible");
  // Query important records directly in the restored copy.
  const t = localTarget(join(report.isolatedDir, "db"), { reuse: true });
  const [own, pay, sub, stu, fts, rem] = query(t, "SELECT u.email FROM owner_record o JOIN users u ON u.id = o.user_id; SELECT amount_kobo, provider_ref FROM payments; SELECT score, text FROM submissions; SELECT full_name FROM users WHERE id = 'u-stu'; SELECT title FROM resource_chunks WHERE resource_chunks MATCH 'attributes'; SELECT removed_at IS NOT NULL AS removed, removal_reason FROM users WHERE id = 'u-gone'");
  assert.deepEqual(own, [{ email: "bookebukar@gmail.com" }]);
  assert.deepEqual(pay, [{ amount_kobo: 22500000, provider_ref: "BANK-1" }]);
  assert.deepEqual(sub, [{ score: 87, text: "line one\nline two with 'quotes'" }]);
  assert.deepEqual(stu, [{ full_name: TRICKY }], "awkward text survives byte for byte");
  assert.deepEqual(fts, [{ title: "Intro; HTML" }], "full-text search works after restore");
  assert.deepEqual(rem, [{ removed: 1, removal_reason: "Contract ended" }]);
  // Verification by manifest comparison (the method used for a restore into a separate REMOTE database): a fresh backup
  // of the restored copy has exactly the same schema and per-table content hashes.
  const again = backup(t, dir("bk2-again"));
  assert.deepEqual(compareManifests(b.manifest, again.manifest), { identical: true, differences: [] });
  execLocal(t, "INSERT INTO notifications (id, user_id, kind, title, created_at) VALUES ('n-extra','u-stu','x','extra','" + NOW + "')");
  const changed = compareManifests(b.manifest, backup(t, dir("bk2-changed")).manifest);
  assert.deepEqual(changed.differences, ["table notifications: 1 rows vs 2"]);
  // The restored protections are live: the audit log is still append-only and the owner record still fixed.
  assert.throws(() => execLocal(t, "UPDATE audit_log SET action = 'x' WHERE id = 'a1'"), /append-only/);
  assert.throws(() => execLocal(t, "DELETE FROM owner_record"), /fixed after bootstrap/);
  rmSync(report.isolatedDir, { recursive: true, force: true });
});

test("encrypted backup: plaintext removed; restores only with the matching private key", () => {
  const kp = generateKeyPairSync("rsa", { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const other = generateKeyPairSync("rsa", { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const kd = dir("keys"); mkdirSync(kd);
  writeFileSync(join(kd, "pub.pem"), kp.publicKey); writeFileSync(join(kd, "priv.pem"), kp.privateKey); writeFileSync(join(kd, "other.pem"), other.privateKey);
  const b = backup(full, dir("bk-enc"), { encryptFor: join(kd, "pub.pem") });
  assert.match(b.file, /\.sql\.enc$/);
  assert.equal(existsSync(b.file.replace(/\.enc$/, "")), false, "plaintext removed");
  assert.ok(!readFileSync(b.file).includes(Buffer.from("bookebukar@gmail.com")), "ciphertext only");
  assert.equal(verifyRestore(b.file).checks.find((c) => c.name === "decryption key supplied")?.ok, false);
  const wrong = verifyRestore(b.file, { privateKey: join(kd, "other.pem") });
  assert.equal(wrong.ok, false, "wrong key refused");
  assert.equal(existsSync(wrong.isolatedDir), false, "a FAILED restore leaves no decrypted data or database behind");
  const ok = verifyRestore(b.file, { privateKey: join(kd, "priv.pem"), keep: true });
  assert.equal(ok.ok, true, JSON.stringify(ok.checks.filter((c) => !c.ok)));
  assert.equal(existsSync(join(ok.isolatedDir, "decrypted.sql")), false, "the decrypted SQL is deleted right after import, even when the copy is kept");
  rmSync(ok.isolatedDir, { recursive: true, force: true });
  // Deliberate decryption for a remote restore: verified against the manifest, refuses to overwrite, wrong key refused.
  const out = join(kd, "plain.sql");
  decryptBackup(b.file, join(kd, "priv.pem"), out);
  assert.equal(sha256File(out), b.manifest.file.sha256);
  assert.throws(() => decryptBackup(b.file, join(kd, "priv.pem"), out), /already exists/);
  assert.throws(() => decryptBackup(b.file, join(kd, "other.pem"), join(kd, "x.sql")));
});

test("backup with no records: allowed but flagged (and refused by the preflight); a database with no tables is refused outright", () => {
  const empty = localTarget(dir("empty"));
  applyMigrations(empty);
  const b = backup(empty, dir("bk-empty"));
  assert.ok(b.manifest.totals.rows > 0, "migrations create reference rows (programmes, sequences, history)");
  assert.equal(b.manifest.totals.institutionalRows, 0, "but no institutional records");
  assert.ok(b.manifest.warnings.some((w) => /no institutional records/.test(w)));
  assert.equal(b.manifest.classes.reference.rows > 0, true);
  // The preflight refuses such a backup unless the operator states the database really is empty.
  const st = captureState(empty);
  const r = verifyRestore(b.file, { reportFile: `${b.file}.restore-report.json` });
  const pf = preflight({ state: { ...st, migrations: st.migrations!.slice(0, 9) }, backupFile: b.file, expectedSchemaFor: () => st.schema });
  assert.ok(pf.failures.some((f) => /no institutional records/.test(f)), pf.failures.join(" | "));
  assert.equal(r.ok, true, "a backup without institutional records still restores");
  const blank = localTarget(dir("blank"));
  execLocal(blank, "SELECT 1");
  assert.throws(() => backup(blank, dir("bk-blank")), (e: unknown) => e instanceof D1Error && /no tables/.test((e as Error).message));
});

test("failed or incomplete restores are detected: truncated file, consistent-looking but incomplete file, corrupt SQL, non-empty target", () => {
  const b = backup(full, dir("bk-bad"));
  const sql = readFileSync(b.file, "utf8");
  const lines = sql.split("\n");
  // 1. Truncated download (manifest untouched): checksum fails before anything is imported.
  writeFileSync(b.file, lines.slice(0, Math.floor(lines.length * 0.6)).join("\n"));
  const r1 = verifyRestore(b.file);
  assert.deepEqual([r1.ok, r1.checks.at(-1)!.name, r1.checks.at(-1)!.ok], [false, "file checksum", false]);
  // 2. Incomplete export whose manifest was (wrongly) regenerated to match: import works, the content checks catch it.
  const manifest = JSON.parse(readFileSync(b.manifestFile, "utf8"));
  const cut = lines.filter((l) => !l.startsWith('INSERT INTO "payments"')).join("\n").replace(/CREATE TRIGGER audit_log[\s\S]*?\bEND;\n/g, "");
  assert.ok(!cut.includes("CREATE TRIGGER audit_log") && cut.includes("CREATE TRIGGER owner_record_no_update"));
  writeFileSync(b.file, cut);
  manifest.file.sha256 = sha256File(b.file);
  writeFileSync(b.manifestFile, JSON.stringify(manifest));
  const r2 = verifyRestore(b.file);
  assert.equal(r2.ok, false);
  const failed = r2.checks.filter((c) => !c.ok).map((c) => c.name);
  for (const n of ["schema identical to backup", "triggers restored", "record counts and content", "critical records"]) assert.ok(failed.includes(n), `${n} should fail; failed: ${failed}`);
  assert.match(r2.checks.find((c) => c.name === "record counts and content")!.detail, /payments: 0 rows, expected 1/);
  // 3. Corrupt SQL: the import itself fails and nothing is reported as verified.
  writeFileSync(b.file, `${sql}\nINSERT INTO "payments" VALUES (this is not sql;\n`);
  manifest.file.sha256 = sha256File(b.file);
  writeFileSync(b.manifestFile, JSON.stringify(manifest));
  const r3 = verifyRestore(b.file);
  assert.deepEqual([r3.ok, r3.checks.find((c) => c.name === "import")?.ok], [false, false]);
  // 4. Restoring over an existing database is refused.
  writeFileSync(b.file, sql);
  manifest.file.sha256 = sha256File(b.file);
  writeFileSync(b.manifestFile, JSON.stringify(manifest));
  const r4 = verifyRestore(b.file, { isolatedDir: dir("reuse"), keep: true });
  assert.equal(r4.ok, true, "a new isolated directory works");
  const r5 = verifyRestore(b.file, { isolatedDir: r4.isolatedDir });
  assert.deepEqual([r5.ok, r5.checks.find((c) => c.name === "isolated database is new")?.ok], [false, false], "never restored into a database that already has data");
  // Without keep, the isolated copy is removed afterwards (it holds confidential records).
  const r6 = verifyRestore(b.file);
  assert.deepEqual([r6.ok, r6.kept, existsSync(r6.isolatedDir)], [true, false, false]);
});

test("schema mismatch: an older database is reported as older_schema; hand-made drift fails the preflight", () => {
  const b = backup(at9, dir("bk9"));
  const r = verifyRestore(b.file, { reportFile: `${b.file}.restore-report.json` });
  assert.equal(r.ok, true);
  assert.deepEqual([r.compatibility.status, r.compatibility.pending], ["older_schema", ["0010_owner_integrity.sql", "0011_catalogue.sql", "0012_pricing_snapshot.sql", "0013_order_idempotency.sql", "0014_payment_attempts.sql", "0015_institution.sql", "0016_approval_execution.sql", "0017_execution_fencing.sql"]]);
  // Preflight on the 0009 database with its verified backup: 0010 and 0011 pending. The only failure is the open owner
  // decision on 0011 (Stage B: local and staging only until the owner approves it for production).
  const st = captureState(at9);
  const pf = preflight({ state: st, backupFile: b.file });
  assert.deepEqual([pf.result, pf.pending], ["FAIL", ["0010_owner_integrity.sql", "0011_catalogue.sql", "0012_pricing_snapshot.sql", "0013_order_idempotency.sql", "0014_payment_attempts.sql", "0015_institution.sql", "0016_approval_execution.sql", "0017_execution_fencing.sql"]]);
  assert.equal(pf.failures.length, 1, pf.failures.join(" | "));
  assert.match(pf.failures[0], /0011_catalogue\.sql needs the owner's decision/);
  // Someone created a table by hand: the schema no longer matches what migrations 0001-0009 produce.
  execLocal(at9, "CREATE TABLE hand_made (a TEXT)");
  const drift = preflight({ state: captureState(at9), backupFile: b.file });
  assert.equal(drift.result, "FAIL");
  assert.ok(drift.failures.some((f) => /schema: .*extra table:hand_made/.test(f)), drift.failures.join(" | "));
});

test("rehearsal: pending migrations applied to an isolated copy of the backup; schema, triggers, FKs and records verified", () => {
  const b = readdirSync(dir("bk9")).find((f) => f.endsWith(".sql"))!;
  const r = rehearse(join(dir("bk9"), b));
  assert.deepEqual(r.files.map((f) => f.name), readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort(), "the rehearsed migration files are recorded with their hashes");
  assert.equal(r.backupSha256, sha256File(join(dir("bk9"), b)));
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.deepEqual([r.from, r.to, r.applied], ["0009_owner.sql", "0017_execution_fencing.sql", ["0010_owner_integrity.sql", "0011_catalogue.sql", "0012_pricing_snapshot.sql", "0013_order_idempotency.sql", "0014_payment_attempts.sql", "0015_institution.sql", "0016_approval_execution.sql", "0017_execution_fencing.sql"]]);
  assert.deepEqual(r.newTables.map((t) => t.table).sort(), ["approval_requests", "departments", "execution_fences", "owner_record", "payment_attempts", "programme_drafts", "schools", "staff_assignments", "staff_invitations"]);
  assert.deepEqual(r.newTables.find((t) => t.table === "owner_record"), { table: "owner_record", rows: 1 }, "the Stage 2B bootstrap is carried into owner_record");
  assert.deepEqual([r.newTables.find((t) => t.table === "programme_drafts")!.rows, r.newTables.find((t) => t.table === "schools")!.rows], [21, 6], "2027 drafts and schools");
  // 0011 adds columns to programmes (catalogue fields) and enrolments (duration snapshot); 0012 adds empty pricing-snapshot
  // columns to orders. Their rows gain columns, none is added or removed. Every other table is unchanged.
  assert.ok(r.changedTables.every((c) => ["programmes", "enrolments", "orders"].includes(c.table) && c.rowsBefore === c.rowsAfter), JSON.stringify(r.changedTables));
});

test("db/schema.expected.json is exactly what applying every migration produces (the schema this Worker expects)", () => {
  const fresh = buildExpected();
  const saved = JSON.parse(readFileSync(EXPECTED_SCHEMA_FILE, "utf8"));
  assert.deepEqual(fresh, saved, "run npm run db:schema and commit the result");
});

test("two-phase restore: phase A IDENTICAL to the backup; phase B (security reset) differs ONLY as intended; any other change is caught", () => {
  const b = backup(full, dir("bk-2p"));
  const r = verifyRestore(b.file, { keep: true });
  assert.equal(r.ok, true);
  const t = localTarget(join(r.isolatedDir, "db"), { reuse: true });
  // Phase A: before any intentional change.
  assert.deepEqual(cmp(b.manifest, backup(t, dir("bk-2p-a")).manifest), { identical: true, differences: [] });
  // Phase B: the generated reset, run as a file (as wrangler d1 execute --file does in production).
  execLocal(t, "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES ('h1','u-stu','" + NOW + "','2099-01-01T00:00:00Z','" + NOW + "'); INSERT INTO auth_tokens (token_hash, user_id, expires_at, created_at) VALUES ('t1','u-stu','2099-01-01T00:00:00Z','" + NOW + "')");
  const withAuth = backup(t, dir("bk-2p-auth")).manifest; // the "backup" state, now with a live session and an unused link
  const resetFile = join(dir("bk-2p"), "reset.sql");
  writeFileSync(resetFile, postRestoreSql({ manifest: withAuth, backupName: basename(b.file), database: "skillmountainacademy-db-restore-test", approvedBy: "Platform Owner" }));
  execLocalFile(t, resetFile);
  const afterReset = backup(t, dir("bk-2p-b")).manifest;
  assert.equal(cmp(withAuth, afterReset).identical, false, "the post-reset database is NOT identical to the backup");
  const v = verifyPostReset(withAuth, afterReset);
  assert.deepEqual([v.ok, v.unexpected], [true, []]);
  assert.deepEqual(v.expected.map((x) => x.split(":")[0]), ["auth_sessions", "auth_tokens", "audit_log"]);
  const [[e]] = query(t, "SELECT actor_id, target_type, json_extract(detail, '$.approving_owner_user_id') AS owner FROM audit_log WHERE action = 'system.restore'");
  assert.deepEqual(e, { actor_id: null, target_type: "database", owner: "u-own" });
  // Anything else changing is reported as unexpected.
  execLocal(t, "DELETE FROM notifications WHERE id = 'n1'");
  const tampered = verifyPostReset(withAuth, backup(t, dir("bk-2p-c")).manifest);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.unexpected.some((u) => /notifications: 1 rows vs 0/.test(u)), tampered.unexpected.join(" | "));
  rmSync(r.isolatedDir, { recursive: true, force: true });
});

test("rollback facts are gathered from a real database with read-only counts and drive the decision", () => {
  const applied = query(full, "SELECT name FROM d1_migrations ORDER BY id")[0].map((x) => String(x.name));
  const facts = gatherFacts(full, "0007_refinement.sql", applied);
  assert.deepEqual(Object.keys(facts).sort(), ["approval_executions_open", "approval_executions_running", "bootstrap_only_in_owner_record", "catalogue_published_changes", "institution_rules_active", "mfa_pending_sessions", "orders_with_pricing_snapshot", "payment_attempts_open", "removed_accounts"]);
  assert.equal(facts.removed_accounts, 1, "the seeded removed instructor is counted");
  assert.equal(facts.bootstrap_only_in_owner_record, 1, "the seeded owner set-up exists only in owner_record");
  const d = decideRollback({ candidateExpected: "0007_refinement.sql", dbApplied: applied, facts, ownerSecurityException: "Owner" });
  assert.equal(d.verdict, "UNSAFE", "a pre-2C Worker would re-open owner set-up on this database");
  assert.equal(decideRollback({ candidateExpected: "0010_owner_integrity.sql", dbApplied: applied, facts: gatherFacts(full, "0010_owner_integrity.sql", applied) }).verdict, "SAFE");
});

test("a failed rehearsal leaves no restored copy behind", () => {
  const b = backup(full, dir("bk-rh-bad"));
  writeFileSync(b.file, readFileSync(b.file, "utf8").slice(0, 2000));
  const before = readdirSync(tmpdir()).filter((x) => x.startsWith("sma-restore-")).length;
  const r = rehearse(b.file);
  assert.equal(r.ok, false);
  assert.equal(readdirSync(tmpdir()).filter((x) => x.startsWith("sma-restore-")).length, before);
});
