// Stage 3C: migration 0010 rehearsal, backup and restore verification on an ISOLATED staging-equivalent database, and the
// application's behaviour before and after the upgrade. No Cloudflare account is used: the "staging D1" here is a local
// D1 database (Wrangler, the same tool and SQLite engine as Cloudflare), and the application runs in Miniflare (workerd).
// Only synthetic data. Production is never contacted.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { applyMigrations, execLocal, executeFile, localTarget, query, type Target } from "../scripts/db/d1.mts";
import { backup, readSchema, sha256File, type Manifest } from "../scripts/db/dump.mts";
import { verifyRestore } from "../scripts/db/restore.mts";
import { rehearse } from "../scripts/db/rehearse.mts";
import { compareManifests, verifyPostReset } from "../scripts/db/compare.mts";
import { postRestoreSql } from "../scripts/db/post-restore.mts";
import { inspectBackup } from "../scripts/backup/ship.mts";
import { startWorker, SECRETS } from "./worker-harness.ts";
import { signIn as helperSignIn, type Session } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";
import { EXPECTED_MIGRATION } from "../src/server/schema-version.ts";

const ROOT = mkdtempSync(join(tmpdir(), "sma-3c-"));
const dir = (n: string) => join(ROOT, n);
after(() => rmSync(ROOT, { recursive: true, force: true }));
const NOW = new Date().toISOString();
const PENDING = "0010_owner_integrity.sql";
// Expansion Stage B added 0011_catalogue.sql (local/staging only). Production and this staging rehearsal start at 0009,
// so both are pending; the 0010 evidence below is unchanged and 0011 is checked alongside it.
const PENDING_ALL = ["0010_owner_integrity.sql", "0011_catalogue.sql", "0012_pricing_snapshot.sql", "0013_order_idempotency.sql"]; // 0012: Stage D, local/staging only
// 0011 adds columns (catalogue fields, duration snapshot) and 0012 empty pricing-snapshot columns on orders; no rows added or removed
const CATALOGUE_TABLES = ["programmes", "enrolments", "orders"];
const evidence: Record<string, unknown> = {};

// ================================================================== A. data level (Stage 3A tools, local staging D1) ====
// Synthetic staging data at migration 0009, set up the Stage 2B way (owner set-up in app_settings), with live sessions
// and an unused sign-in link, so the restore reset has something to invalidate.
const SEED9 = `
INSERT INTO users (id, email, role, full_name, status, created_at, admin_role) VALUES
 ('u-own','owner@staging.invalid','admin','Staging Owner','active','${NOW}','super'),
 ('u-fin','finance@staging.invalid','admin','Staging Finance','active','${NOW}','finance'),
 ('u-leg','legacy@staging.invalid','admin','Staging Legacy','active','${NOW}',NULL),
 ('u-stu','student@staging.invalid','student','Test Student','active','${NOW}',NULL),
 ('u-ins','instructor@staging.invalid','instructor','Test Instructor','active','${NOW}',NULL);
INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('owner_bootstrap','{"by":"u-own","email":"owner@staging.invalid","at":"${NOW}"}','u-own','${NOW}');
INSERT INTO audit_log (id, at, actor_id, action, target_type, target_id, detail) VALUES
 ('a1','${NOW}','u-own','owner.bootstrap','user','u-own','{"email":"owner@staging.invalid"}'),
 ('a2','2020-01-01T00:00:00Z','u-own','admin.user_update','user','u-fin','{"adminRole":"finance"}');
INSERT INTO mfa_factors (user_id, secret_enc, status, enabled_at, last_step, created_at) VALUES ('u-own','v1.SYNTHETIC-NOT-A-SECRET','active','${NOW}',1,'${NOW}');
INSERT INTO enrolments (id, student_id, programme_slug, instructor_id, status, started_at, created_at) VALUES ('e1','u-stu','webdev','u-ins','active','${NOW}','${NOW}');
INSERT INTO class_sessions (id, enrolment_id, student_id, instructor_id, starts_at, ends_at, status, created_at) VALUES ('c1','e1','u-stu','u-ins','2026-11-03T09:00:00Z','2026-11-03T10:00:00Z','completed','${NOW}');
INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES ('h-stu','u-stu','${NOW}','2099-01-01T00:00:00Z','${NOW}'), ('h-own','u-own','${NOW}','2099-01-01T00:00:00Z','${NOW}');
INSERT INTO auth_tokens (token_hash, user_id, expires_at, created_at) VALUES ('t-ins','u-ins','2099-01-01T00:00:00Z','${NOW}');
`;
let stg: Target, m9: string, b9: { file: string; manifestFile: string; manifest: Manifest };
const one = (t: Target, sql: string) => query(t, sql)[0][0] as Record<string, unknown>;
const names = (t: Target, type: string) => query(t, `SELECT name FROM sqlite_master WHERE type = '${type}' ORDER BY name`)[0].map((r) => String(r.name));

before(() => {
  m9 = dir("migrations-0009");
  mkdirSync(m9);
  for (const f of readdirSync("migrations").filter((x) => x.endsWith(".sql") && x < "0010")) copyFileSync(join("migrations", f), join(m9, f));
  stg = localTarget(dir("staging-d1"), { migrationsDir: m9 });
  applyMigrations(stg);
  execLocal(stg, SEED9);
});

test("3C-C1 migration history: the staging database is at 0009 with 0010 pending, exactly like production", () => {
  const applied = query(stg, "SELECT name FROM d1_migrations ORDER BY id")[0].map((r) => String(r.name));
  assert.equal(applied.length, 9);
  assert.equal(applied.at(-1), "0009_owner.sql");
  assert.ok(!names(stg, "table").includes("owner_record"));
  assert.deepEqual(names(stg, "trigger"), []);
  const pending = readdirSync("migrations").filter((f) => f.endsWith(".sql") && !applied.includes(f));
  assert.deepEqual(pending, PENDING_ALL);
  evidence.historyBefore = { applied: applied.length, latest: applied.at(-1), pending };
});

test("3C-C2/D backup: created, manifest hashes verified, and restored into a SEPARATE database with every check passing", () => {
  b9 = backup(stg, dir("backups"), { label: "staging-pre-0010" });
  assert.equal(b9.manifest.migration.latest, "0009_owner.sql");
  assert.equal(b9.manifest.file.sha256, sha256File(b9.file), "file SHA-256 equals the manifest");
  assert.equal(b9.manifest.source.kind, "local");
  const r = verifyRestore(b9.file, { isolatedDir: dir("restore-check"), manifestFile: b9.manifestFile, reportFile: dir("restore-check.json") });
  assert.equal(r.ok, true, r.checks.filter((c) => !c.ok).map((c) => c.name).join(", "));
  assert.equal(r.manifestSha256, sha256File(b9.manifestFile), "the report is bound to this manifest");
  // Backup-age and shipping rules: the off-site shipping gate refuses anything that is not a fresh production backup.
  const ship = inspectBackup({ dir: dir("backups"), approved: { accountId: "0".repeat(32), databaseUuid: "00000000-0000-4000-8000-000000000000" } });
  assert.equal(ship.ok, false);
  assert.ok(ship.failures.some((f) => /plaintext backup present/.test(f)), "an unencrypted staging backup is never shipped");
  evidence.backup = { file: basename(b9.file), sha256: b9.manifest.file.sha256, restoreChecks: r.checks.length, restoreOk: r.ok };
});

test("3C-C3 rehearsal with the approved tool: restore the backup, apply 0010 to the COPY, schema and triggers verified", () => {
  const r = rehearse(b9.file, { reportFile: dir("rehearsal.json") });
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 600));
  assert.deepEqual([r.from, r.to, r.applied], ["0009_owner.sql", EXPECTED_MIGRATION, PENDING_ALL]);
  assert.equal(r.files.find((f) => f.name === PENDING)?.sha256, sha256File(join("migrations", PENDING)));
  evidence.rehearsal = { ok: r.ok, from: r.from, to: r.to };
});

test("3C-C3..C9 apply 0010 to the staging database (wrangler d1 migrations apply): schema, owner integrity, append-only audit, data compatible", () => {
  stg = localTarget(dir("staging-d1"), { reuse: true }); // the same database, now with the full migrations folder
  applyMigrations(stg);
  const applied = query(stg, "SELECT name FROM d1_migrations ORDER BY id")[0].map((r) => String(r.name));
  assert.equal(applied.at(-1), EXPECTED_MIGRATION);
  // C4 schema: identical to the schema this Worker expects (db/schema.expected.json).
  const norm = (e: { type: string; name: string; sql: string | null }) => `${e.type}:${e.name}:${(e.sql ?? "").replace(/\s+/g, " ").trim()}`;
  const skip = (n: string) => n.startsWith("sqlite_") || n.startsWith("_cf_") || n === "d1_migrations";
  const expected = (JSON.parse(readFileSync("db/schema.expected.json", "utf8")).schema as { type: string; name: string; sql: string }[]).filter((e) => !skip(e.name)).map(norm).sort();
  const actual = readSchema(stg).filter((e) => !skip(e.name)).map(norm).sort();
  assert.deepEqual(actual, expected, "upgraded schema equals the expected schema");
  assert.deepEqual(names(stg, "trigger"), ["audit_log_min_retention", "audit_log_no_update", "owner_record_no_delete", "owner_record_no_update"]);
  // C5 owner integrity: the Stage 2B set-up was carried into owner_record, which can be neither changed nor deleted.
  assert.deepEqual({ ...one(stg, "SELECT user_id, email FROM owner_record WHERE id = 1") }, { user_id: "u-own", email: "owner@staging.invalid" });
  assert.throws(() => execLocal(stg, "UPDATE owner_record SET user_id = 'u-leg'"), /fixed after bootstrap/);
  assert.throws(() => execLocal(stg, "DELETE FROM owner_record"), /fixed after bootstrap/);
  // C6 audit log: append-only; entries younger than 365 days cannot be deleted.
  assert.throws(() => execLocal(stg, "UPDATE audit_log SET action = 'x' WHERE id = 'a1'"), /append-only/);
  assert.throws(() => execLocal(stg, "DELETE FROM audit_log WHERE id = 'a1'"), /365 days/);
  // C9 compatibility: every existing table keeps every row and its content; only owner_record is new.
  const after = backup(stg, dir("backups-after")).manifest;
  const diff = compareManifests(b9.manifest, after, { ignoreTables: ["owner_record", "d1_migrations", "schools", "programme_drafts", ...CATALOGUE_TABLES] });
  const unexplained = diff.differences.filter((d) => !/migration|schema|trigger|owner_record|schools|programme_drafts|critical|tables? (added|count)/i.test(d));
  assert.deepEqual(unexplained, [], diff.differences.join(" | "));
  for (const [name, info] of Object.entries(b9.manifest.tables)) {
    if (name === "d1_migrations") continue;
    if (CATALOGUE_TABLES.includes(name)) assert.equal(after.tables[name]?.rows, info.rows, `${name}: same rows (0011 only adds columns)`);
    else assert.equal(after.tables[name]?.sha256, info.sha256, `${name}: content unchanged`);
  }
  // 0011: the existing enrolment keeps the durations it started with; the 21 catalogue drafts are unpublished.
  assert.deepEqual({ ...one(stg, "SELECT training_months, internship_months FROM enrolments WHERE id = 'e1'") }, { training_months: 4, internship_months: 2 });
  assert.deepEqual({ ...one(stg, "SELECT COUNT(*) AS n, SUM(price_kobo IS NULL) AS no_ngn FROM programme_drafts") }, { n: 21, no_ngn: 21 });
  evidence.applied = { latest: applied.at(-1), triggers: 4, tablesUnchanged: Object.keys(b9.manifest.tables).length };
});

test("3C-C10/D rollback by restoration: the pre-0010 backup restored into a separate database, then the post-restore reset (sessions ended, links invalidated, audited)", () => {
  const r = verifyRestore(b9.file, { isolatedDir: dir("restored"), manifestFile: b9.manifestFile, keep: true });
  assert.equal(r.ok, true);
  const t = localTarget(join(dir("restored"), "db"), { reuse: true });
  assert.equal(one(t, "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1").name, "0009_owner.sql", "the restored database is back at 0009");
  assert.equal(Number(one(t, "SELECT COUNT(*) AS n FROM auth_sessions").n), 2, "sessions came back with the backup");
  const reset = dir("reset.sql");
  writeFileSync(reset, postRestoreSql({ manifest: b9.manifest, backupName: basename(b9.file), database: "skillmountainacademy-staging-db-restore-20261122", approvedBy: "Staging Owner" }));
  executeFile(t, reset); // failed before Stage 3C on any pre-0010 backup (no owner_record table)
  assert.equal(Number(one(t, "SELECT COUNT(*) AS n FROM auth_sessions").n), 0, "every session ended");
  assert.equal(Number(one(t, "SELECT COUNT(*) AS n FROM auth_tokens WHERE used_at IS NULL").n), 0, "unused sign-in links invalidated");
  const e = one(t, "SELECT actor_id, target_type, json_extract(detail, '$.approving_owner_user_id') AS owner, json_extract(detail, '$.backup_sha256') AS sha FROM audit_log WHERE action = 'system.restore'");
  assert.deepEqual({ ...e }, { actor_id: null, target_type: "database", owner: "u-own", sha: b9.manifest.file.sha256 }, "audited with the Stage 2B owner and the backup hash");
  const v = verifyPostReset(b9.manifest, backup(t, dir("backups-reset")).manifest);
  assert.deepEqual([v.ok, v.unexpected], [true, []], "only sessions, links and the audit log changed");
  evidence.restore = { restoredTo: "0009_owner.sql", sessionsAfter: 0, audit: "system.restore" };
});

// ================================================================== B. application level (real Worker, Miniflare) ====
type W = Awaited<ReturnType<typeof startWorker>>;
const OWNER = "owner@staging.invalid";
const MFA_KEY = Buffer.alloc(32, 9).toString("base64");
let w: W;
const ids: Record<string, string> = {};
const reset = async () => { await (await w.db()).prepare("DELETE FROM rate_limits").run(); };
const signIn = async (email: string) => { await reset(); return helperSignIn(w, email); };
async function strong(email: string): Promise<Session> {
  const s = await signIn(email);
  const secret = (await s.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  await s.json("POST", "/api/auth/mfa/enable", { code: await totpAt(secret, stepOf(Date.now())) });
  return s;
}
const idOf = async (s: Session) => (await s.json<{ user: { id: string } }>("GET", "/api/me")).user.id;
const status = async () => (await (await w.fetchApi("/api/status")).json()) as { ok: boolean; ready: Record<string, boolean>; schema: { expected: string; applied: string | null; status: string } };
let owner: Session, legacy: Session, student: Session, instructor: Session;
const rowsBefore: Record<string, number> = {};

test("3C-B1 the CURRENT code on a 0009 database (production's state): runs, reports database_older, owner powers fail closed, audit log unprotected", async () => {
  w = await startWorker({ migrationsUpTo: "0009_owner.sql", env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: MFA_KEY, ADMIN_EMAILS: "owner@example.com" } });
  const db = await w.db();
  // Wrangler's migration history table, as production has it.
  await db.prepare("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)").run();
  for (const f of readdirSync("migrations").filter((x) => x.endsWith(".sql") && x < "0010").sort()) await db.prepare("INSERT INTO d1_migrations (name) VALUES (?1)").bind(f).run();
  const st = await status();
  assert.deepEqual([st.ok, st.ready.database, st.schema.applied, st.schema.status], [true, true, "0009_owner.sql", "database_older"]);
  legacy = await signIn("owner@example.com"); // an ADMIN_EMAILS administrator (no group): day-to-day administration
  owner = await strong(OWNER);
  ids.owner = await idOf(owner);
  // The owner exists as an administrator (created by the legacy administrator, as before Stage 2C).
  assert.equal((await legacy.get("/api/app/admin/overview")).status, 200, "day-to-day administration works on 0009");
  const ownerSt = await owner.json<{ state: string; bootstrapped: boolean }>("GET", "/api/app/owner/status");
  assert.deepEqual([ownerSt.state, ownerSt.bootstrapped], ["migration_required", false]);
  const boot = await owner.send("POST", "/api/app/owner/bootstrap");
  assert.ok([403, 409].includes(boot.status), `owner set-up refused until 0010 (got ${boot.status})`);
  evidence.bootstrapOn0009 = { status: boot.status, error: ((await boot.json()) as { error: string }).error };
  ids.stu = (await legacy.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "student@staging.invalid", role: "student", fullName: "Test Student", sendInvite: false })).user.id;
  ids.ins = (await legacy.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "instructor@staging.invalid", role: "instructor", fullName: "Test Instructor", sendInvite: false })).user.id;
  student = await signIn("student@staging.invalid");
  // Without 0010 the audit log has no database protection (the gap production has today).
  await db.prepare("INSERT INTO audit_log (id, at, action) VALUES ('gap-demo', ?1, 'test.gap')").bind(NOW).run();
  await db.prepare("UPDATE audit_log SET action = 'test.gap.changed' WHERE id = 'gap-demo'").run();
  assert.equal((await db.prepare("SELECT action FROM audit_log WHERE id = 'gap-demo'").first<{ action: string }>())!.action, "test.gap.changed");
  // Simulate the Stage 2B owner set-up record that 0010 carries over (as the Stage 2B bootstrap stored it).
  await db.prepare("UPDATE users SET admin_role = 'super' WHERE id = ?1").bind(ids.owner).run();
  await db.prepare("INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('owner_bootstrap', json_object('by', ?1, 'email', ?2, 'at', ?3), ?1, ?3)").bind(ids.owner, OWNER, NOW).run();
  for (const t of ["users", "audit_log", "app_settings", "auth_sessions", "mfa_factors"]) rowsBefore[t] = (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n;
});

test("3C-B2 apply 0010 in place: the running Worker becomes compatible; owner recognised from the carried-over record; protections active", async () => {
  assert.deepEqual(await w.applyPending(), PENDING_ALL);
  const db = await w.db();
  for (const m of PENDING_ALL) await db.prepare("INSERT INTO d1_migrations (name) VALUES (?1)").bind(m).run();
  const st = await status();
  assert.deepEqual([st.schema.applied, st.schema.status], [EXPECTED_MIGRATION, "compatible"]);
  const ownerSt = await owner.json<{ state: string; bootstrapped: boolean }>("GET", "/api/app/owner/status");
  assert.deepEqual([ownerSt.state, ownerSt.bootstrapped], ["bootstrapped", true], "no second set-up needed");
  assert.equal((await owner.send("POST", "/api/app/owner/bootstrap")).status, 409, "set-up cannot be repeated");
  await assert.rejects(db.prepare("UPDATE owner_record SET email = 'x@y.z'").run(), /fixed after bootstrap/);
  await assert.rejects(db.prepare("UPDATE audit_log SET action = 'x' WHERE id = 'gap-demo'").run(), /append-only/);
  await assert.rejects(db.prepare("DELETE FROM audit_log WHERE id = 'gap-demo'").run(), /365 days/);
  // Existing records untouched; existing sessions keep working.
  for (const [t, n] of Object.entries(rowsBefore)) assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n, n, `${t} rows unchanged`);
  assert.equal((await student.get("/api/me")).status, 200, "a student signed in before the migration stays signed in");
  assert.equal((await legacy.get("/api/app/admin/overview")).status, 200);
});

test("3C-B3 after 0010: administrator groups and permissions enforced (owner-only powers, code required, legacy administrators limited)", async () => {
  assert.equal((await owner.get("/api/app/owner/staff")).status, 200, "owner console open to the owner with the code");
  assert.equal((await legacy.get("/api/app/owner/staff")).status, 403, "not to another administrator");
  ids.fin = (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "finance@staging.invalid", role: "admin", fullName: "Staging Finance", sendInvite: false, adminRole: "finance" })).user.id;
  assert.equal((await legacy.send("PATCH", `/api/app/admin/users/${ids.fin}`, { adminRole: "super" })).status, 403, "a legacy administrator cannot change groups");
  const fin = await strong("finance@staging.invalid");
  assert.equal((await fin.send("PATCH", `/api/app/admin/users/${ids.fin}`, { adminRole: "super" })).status, 403, "no self-promotion");
  assert.equal((await owner.send("PATCH", `/api/app/admin/users/${ids.fin}`, { adminRole: "academic" })).status, 200, "the owner, with the code, may");
  assert.equal((await fin.get("/api/me")).status, 401, "changing an administrator's group ends that administrator's sessions");
  assert.equal((await owner.send("PATCH", `/api/app/admin/users/${ids.owner}`, { status: "suspended" })).status, 400, "the owner cannot suspend themselves");
});

test("3C-B4 after 0010: session revocation (MFA reset ends sessions) and student/instructor/administrator boundaries", async () => {
  ids.ops = (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "ops@staging.invalid", role: "admin", fullName: "Staging Ops", sendInvite: false, adminRole: "academic" })).user.id;
  const ops = await strong("ops@staging.invalid");
  assert.equal((await ops.get("/api/me")).status, 200);
  assert.equal((await owner.send("POST", `/api/app/admin/users/${ids.ops}/mfa-reset`)).status, 200);
  assert.equal((await ops.get("/api/me")).status, 401, "the reset administrator's sessions were revoked");
  instructor = await signIn("instructor@staging.invalid");
  for (const p of ["/api/app/admin/overview", "/api/app/admin/users", "/api/app/owner/status", "/api/app/owner/audit"]) {
    assert.ok([401, 403].includes((await student.get(p)).status), `student refused ${p}`);
    assert.ok([401, 403].includes((await instructor.get(p)).status), `instructor refused ${p}`);
  }
  assert.ok([401, 403].includes((await student.get("/api/app/instructor/students")).status), "student refused instructor area");
  assert.equal((await w.fetchApi("/api/app/admin/overview")).status, 401, "signed out: refused");
  assert.equal((await student.get("/api/me")).status, 200);
  await w.dispose();
  evidence.application = "B1-B4 passed";
  writeFileSync(dir("evidence.json"), JSON.stringify(evidence, null, 2));
});
