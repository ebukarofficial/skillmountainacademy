// Stage 3B: anonymised staging copy. Rule coverage of the whole schema, and an end-to-end run on an ISOLATED LOCAL D1
// database: a real backup is restored and verified, anonymised, checked, and written as a staging SQL file.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, execLocal, localTarget, query, D1Error } from "../scripts/db/d1.mts";
import { backup } from "../scripts/db/dump.mts";
import { DatabaseSync } from "node:sqlite";
import { anonymiseBackup, anonymiseLocal, anonymiseSql, coverage, POLICY, STAGING_DOMAIN } from "../scripts/db/anonymise.mts";
import { CLASSIFICATION } from "../scripts/db/classification.mts";

const ROOT = mkdtempSync(join(tmpdir(), "sma-anon-"));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const expected = JSON.parse(readFileSync("db/schema.expected.json", "utf8")).schema as { type: string; name: string; tbl_name: string; sql: string }[];
// The real columns, as SQLite itself reads the expected schema (the tool uses PRAGMA table_info the same way).
const mem = new DatabaseSync(":memory:");
for (const s of expected) if (s.type === "table" && !s.name.startsWith("sqlite_")) mem.exec(s.sql);
const colsOf = (t: string) => (mem.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);

test("every table and column of the current schema has an explicit anonymisation rule (a new migration cannot slip through)", () => {
  assert.deepEqual(coverage(expected, colsOf), []);
  assert.deepEqual(Object.keys(POLICY).sort(), Object.keys(CLASSIFICATION).sort(), "same table list as the backup classification");
  const withNewColumn = (t: string) => t === "users" ? [...colsOf(t), "national_id"] : colsOf(t);
  assert.deepEqual(coverage(expected, withNewColumn), ["column users.national_id has no anonymisation rule"]);
  const withNewTable = [...expected, { type: "table", name: "parents", tbl_name: "parents", sql: "CREATE TABLE parents (id TEXT, email TEXT)" }];
  assert.deepEqual(coverage(withNewTable, (t) => t === "parents" ? ["id", "email"] : colsOf(t)), ["table parents has no anonymisation rule"]);
  const sql = anonymiseSql(expected);
  assert.ok(sql[0].startsWith("DROP TRIGGER") && sql.at(-1)!.startsWith("CREATE TRIGGER"), "protective triggers dropped first, re-created last");
  assert.equal(sql.filter((s) => s.startsWith("CREATE TRIGGER")).length, 4);
});

test("anonymisation refuses anything that is not an isolated local copy", () => {
  assert.throws(() => anonymiseLocal({ kind: "remote", database: "skillmountainacademy-db", ownerApproved: true }), D1Error);
});

const NOW = new Date().toISOString();
const ORIGINALS = ["real.student@gmail.com", "Chiamaka Okonkwo-Eze", "+2348031234567", "bookebukar@gmail.com", "Guardian Adaeze Nwosu", "guardian.home@yahoo.com",
  "My cousin's address is 12 Allen Avenue", "Please call me on 08031234567 after work", "PSK-LIVE-REF-998877"];
const SEED = `
INSERT INTO users (id, email, role, full_name, phone, status, created_at, admin_role, bio, guardian_name, guardian_email, guardian_phone) VALUES
 ('u-own','bookebukar@gmail.com','admin','Platform Owner Person','+2348000000001','active','${NOW}','super',NULL,NULL,NULL,NULL),
 ('u-stu','real.student@gmail.com','student','Chiamaka Okonkwo-Eze','+2348031234567','active','${NOW}',NULL,'My cousin''s address is 12 Allen Avenue','Guardian Adaeze Nwosu','guardian.home@yahoo.com','+2348099999999');
INSERT INTO owner_record (id, user_id, email, bootstrapped_at) VALUES (1,'u-own','bookebukar@gmail.com','${NOW}');
INSERT INTO audit_log (id, at, actor_id, action, target_type, target_id, detail, ip_hash) VALUES ('a1','${NOW}','u-own','owner.bootstrap','user','u-own','{"email":"bookebukar@gmail.com"}','iphash-abcdef');
INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('sec:ip-hash-key','"super-secret-hash-key-value"','${NOW}','system'), ('owner_bootstrap','{"by":"u-own","email":"bookebukar@gmail.com"}','${NOW}','u-own'), ('retention','{"days":400}','${NOW}','u-own');
INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES ('sess-hash-1','u-stu','${NOW}','${NOW}','${NOW}','Mozilla/5.0 Personal Phone');
INSERT INTO auth_tokens (token_hash, user_id, expires_at, created_at) VALUES ('tok-hash-1','u-stu','${NOW}','${NOW}');
INSERT INTO mfa_factors (user_id, secret_enc, status, created_at) VALUES ('u-own','v1.ENCRYPTED-SECRET-VALUE','active','${NOW}');
INSERT INTO registrations (id, created_at, role, programme_slug, first_name, surname, email, phone, why) VALUES ('r1','${NOW}','learner','webdev','Chiamaka','Okonkwo-Eze','real.student@gmail.com','+2348031234567','Please call me on 08031234567 after work');
INSERT INTO orders (id, reference, created_at, registration_id, programme_slug, plan, method, total_kobo, regular_kobo, status) VALUES ('o1','PSK-LIVE-REF-998877','${NOW}','r1','webdev','full','paystack',50000000,50000000,'paid');
INSERT INTO messages (id, from_id, to_id, body, created_at) VALUES ('m1','u-own','u-stu','Please call me on 08031234567 after work','${NOW}');
INSERT INTO call_bookings (id, name, email, phone, programme, preferred_date, preferred_time, timezone, reason, status, created_at, updated_at) VALUES ('cb1','Chiamaka Okonkwo-Eze','real.student@gmail.com','+2348031234567','webdev','2026-12-01','10:00','Africa/Lagos','Please call me on 08031234567 after work','new','${NOW}','${NOW}');
INSERT INTO webhook_events (id, received_at) VALUES ('evt_live_1','${NOW}');
`;

test("end to end on an isolated local D1 copy: restore-verified, anonymised, originals gone, protections back, staging SQL written", { timeout: 300_000 }, () => {
  const src = localTarget(join(ROOT, "source"));
  applyMigrations(src);
  execLocal(src, SEED);
  const b = backup(src, join(ROOT, "backup"), { label: "anon-test" });

  const r = anonymiseBackup({ backup: b.file, manifest: b.manifestFile, out: join(ROOT, "out") });
  assert.deepEqual([r.restoreOk, r.gaps, r.problems, r.ok], [true, [], [], true]);
  assert.ok(r.originalValuesChecked >= ORIGINALS.length);
  const sql = readFileSync(r.out!.file, "utf8");
  for (const o of ORIGINALS) assert.ok(!sql.includes(o), `staging SQL must not contain ${o}`);
  assert.ok(!sql.includes("super-secret-hash-key-value") && !sql.includes("ENCRYPTED-SECRET-VALUE") && !sql.includes("sess-hash-1"));
  assert.match(sql, new RegExp(`anon-users-\\d+@${STAGING_DOMAIN.replace(".", "\\.")}`));

  // The anonymised copy keeps the structure staging needs, and its protections work again.
  const t = localTarget(join(ROOT, "out", "isolated", "db"), { reuse: true });
  const [[u], [o], [rows], [settings]] = query(t, "SELECT count(*) AS n FROM users; SELECT total_kobo, status, reference FROM orders; SELECT count(*) AS n FROM owner_record; SELECT group_concat(key) AS k FROM app_settings");
  assert.equal(u.n, 2);
  assert.deepEqual([o.total_kobo, o.status, o.reference], [50000000, "paid", "ANON-ORDERS-1"]);
  assert.equal(rows.n, 0);
  assert.equal(settings.k, "retention");
  assert.throws(() => execLocal(t, "UPDATE audit_log SET action = 'x'"), /append-only/);

  // A non-empty output directory is refused (never overwrite an earlier copy).
  assert.throws(() => anonymiseBackup({ backup: b.file, manifest: b.manifestFile, out: join(ROOT, "out") }), /not empty/);
});
