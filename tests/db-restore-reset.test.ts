// Stage 3A.1: the post-restore security reset, exercised against the REAL Worker (Miniflare). The generated SQL is run
// exactly as an operator would run it on a restored database; then sessions and sign-in links from "the backup" must be
// dead, while the owner can still get in through the intended route (email link + authenticator code, or a recovery
// code) with owner record, MFA and audit protections intact.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker, SECRETS } from "./worker-harness.ts";
import { signIn as helperSignIn, session, type Session } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";
import { postRestoreSql, RESTORE_ACTION } from "../scripts/db/post-restore.mts";
import { splitSql, classify } from "../scripts/db/sql.mts";
import type { Manifest } from "../scripts/db/dump.mts";

type W = Awaited<ReturnType<typeof startWorker>>;
const OWNER = "boss@example.com";
const RESTORED_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
let w: W, owner: Session, student: Session, secret = "", recovery: string[] = [], ownerId = "";
let pendingLinkToken = "";

const resetLimits = async () => { await (await w.db()).prepare("DELETE FROM rate_limits").run(); };
const signIn = async (email: string) => { await resetLimits(); return helperSignIn(w, email); };
async function linkFor(email: string, ip: string) {
  await resetLimits();
  const before = w.calls.length;
  await w.post("/api/auth/request", { email, turnstileToken: "good-token" }, { "cf-connecting-ip": ip });
  const isLink = (m: { url: string; body: string }) => m.url.includes("api.resend.com") && m.body.includes(email) && m.body.includes("/app/confirm/?t=");
  assert.ok(await w.waitFor((c) => c.slice(before).some(isLink)));
  return JSON.parse(w.calls.slice(before).filter(isLink).at(-1)!.body).html.match(/\/app\/confirm\/\?t=([\w-]+)/)[1] as string;
}
const verify = async (token: string, ip: string) => {
  const r = await w.post("/api/auth/verify", { token }, { "cf-connecting-ip": ip });
  return { r, s: session(w, r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), ip) };
};
const manifest = { file: { sha256: "a".repeat(64) }, createdAt: "2026-11-22T10:00:00.000Z", migration: { latest: "0010_owner_integrity.sql" } } as unknown as Manifest;

before(async () => {
  w = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64") } });
  owner = await signIn(OWNER);
  ownerId = (await owner.json<{ user: { id: string } }>("GET", "/api/me")).user.id;
  secret = (await owner.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  recovery = (await owner.json<{ recoveryCodes: string[] }>("POST", "/api/auth/mfa/enable", { code: await totpAt(secret, stepOf(Date.now())) })).recoveryCodes;
  await owner.json("POST", "/api/app/owner/bootstrap");
  await owner.json("POST", "/api/app/admin/users", { email: "learner@example.com", role: "student", fullName: "Learner", sendInvite: false });
  student = await signIn("learner@example.com");
  pendingLinkToken = await linkFor("learner@example.com", "10.88.1.1"); // an outstanding, unused magic link
});
after(async () => { await w.dispose(); });

test("generated reset SQL: three statements on real columns, escaped values, no placeholders, owner id from owner_record", () => {
  const sql = postRestoreSql({ manifest, backupName: "skillmountainacademy-db-20261122T100000Z-m0010.sql.enc", database: "skillmountainacademy-db-restore-20261122", databaseUuid: RESTORED_UUID, approvedBy: "Ada O'Brien" });
  const st = splitSql(sql);
  assert.equal(st.length, 3);
  assert.match(st[0].code, /^DELETE FROM auth_sessions$/);
  assert.match(st[1].code, /^UPDATE auth_tokens SET used_at = '[^']+' WHERE used_at IS NULL$/);
  assert.match(st[2].code, /^INSERT INTO audit_log \(id, at, actor_id, action, target_type, target_id, detail, ip_hash\) VALUES \('[0-9a-f-]{36}', '[^']+', NULL, 'system\.restore', 'database', '3f2504e0/);
  assert.match(st[2].code, /'approved_by', 'Ada O''Brien'/, "quotes escaped");
  assert.match(st[2].code, /\(SELECT user_id FROM owner_record WHERE id = 1\)/, "approving owner taken from the restored owner record, not invented");
  assert.doesNotMatch(sql, /<[a-z ]+>/i, "no placeholders to edit by hand");
  assert.deepEqual(st.flatMap(classify).map((f) => f.kind), ["DELETE (every row)", "UPDATE (data backfill with WHERE)"], "the destructive parts are exactly the intended ones");
  assert.throws(() => postRestoreSql({ manifest, backupName: "x", database: "db", approvedBy: "x" }), /approving person's name/);
  assert.throws(() => postRestoreSql({ manifest, backupName: "x", database: "db; DROP TABLE users", approvedBy: "Ada Owner" }), /database name/);
  assert.throws(() => postRestoreSql({ manifest, backupName: "x", database: "db", databaseUuid: "not-a-uuid", approvedBy: "Ada Owner" }), /not a UUID/);
});

test("after the reset: old sessions and outstanding sign-in links are dead; owner, MFA and audit protections intact; owner gets back in", async () => {
  const db = await w.db();
  const before = await db.prepare("SELECT (SELECT COUNT(*) FROM auth_sessions) s, (SELECT COUNT(*) FROM auth_tokens WHERE used_at IS NULL) t, (SELECT COUNT(*) FROM mfa_factors) f, (SELECT COUNT(*) FROM mfa_recovery_codes WHERE used_at IS NULL) c, (SELECT user_id FROM owner_record) o, (SELECT COUNT(*) FROM audit_log) a").first<{ s: number; t: number; f: number; c: number; o: string; a: number }>();
  assert.ok(before!.s >= 2 && before!.t >= 1, "the 'backup' has sessions and an unused link");
  assert.equal(before!.o, ownerId);
  // Run the generated SQL statement by statement, as `wrangler d1 execute --file` would.
  const sql = postRestoreSql({ manifest, backupName: "b.sql.enc", database: "skillmountainacademy-db-restore-20261122", databaseUuid: RESTORED_UUID, approvedBy: "Platform Owner" });
  for (const st of splitSql(sql)) await db.prepare(st.code).run();
  const after = await db.prepare("SELECT (SELECT COUNT(*) FROM auth_sessions) s, (SELECT COUNT(*) FROM auth_tokens WHERE used_at IS NULL) t, (SELECT COUNT(*) FROM mfa_factors) f, (SELECT COUNT(*) FROM mfa_recovery_codes WHERE used_at IS NULL) c, (SELECT user_id FROM owner_record) o, (SELECT COUNT(*) FROM audit_log) a").first<{ s: number; t: number; f: number; c: number; o: string; a: number }>();
  assert.deepEqual({ s: after!.s, t: after!.t }, { s: 0, t: 0 });
  assert.deepEqual({ f: after!.f, c: after!.c, o: after!.o, a: after!.a }, { f: before!.f, c: before!.c, o: before!.o, a: before!.a + 1 }, "MFA, recovery codes and owner record untouched; one audit entry added");
  // The restore audit entry: real columns, no invented actor, the approving owner identified from owner_record.
  const e = await db.prepare("SELECT actor_id, target_type, target_id, detail FROM audit_log WHERE action = ?1").bind(RESTORE_ACTION).first<{ actor_id: string | null; target_type: string; target_id: string; detail: string }>();
  const d = JSON.parse(e!.detail);
  assert.deepEqual([e!.actor_id, e!.target_type, e!.target_id], [null, "database", RESTORED_UUID]);
  assert.deepEqual([d.approving_owner_user_id, d.approved_by, d.restored_database_uuid, d.backup_sha256], [ownerId, "Platform Owner", RESTORED_UUID, "a".repeat(64)]);
  await assert.rejects(db.prepare("UPDATE audit_log SET action = 'x' WHERE action = ?1").bind(RESTORE_ACTION).run(), /append-only/, "audit protection still active");
  // Sessions from the backup cannot be reused.
  assert.equal((await owner.get("/api/me")).status, 401);
  assert.equal((await student.get("/api/me")).status, 401);
  // The outstanding magic link from the backup cannot be used.
  assert.notEqual((await verify(pendingLinkToken, "10.88.1.1")).r.status, 200);
  // The owner signs in through the intended route: email link, then the authenticator code (same secret, same key).
  const p = await verify(await linkFor(OWNER, "10.88.2.2"), "10.88.2.2");
  assert.equal(((await p.r.json()) as { mfaRequired: boolean }).mfaRequired, true);
  await (await w.db()).prepare("UPDATE mfa_factors SET last_step = 0").run(); // allow the current step again in this fast test
  const v = await p.s.send("POST", "/api/auth/mfa/verify", { code: await totpAt(secret, stepOf(Date.now())) });
  assert.equal(v.status, 200);
  const o = session(w, v.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") || p.s.cookie, "10.88.2.2");
  const st = await o.json<{ isOwner: boolean; state: string; strongSession: boolean }>("GET", "/api/app/owner/status");
  assert.deepEqual([st.isOwner, st.state, st.strongSession], [true, "bootstrapped", true], "owner record and owner console intact");
  assert.equal((await o.get("/api/app/owner/staff")).status, 200);
  // The recovery-code route also still works (a lost phone after a restore is not a lock-out).
  const p2 = await verify(await linkFor(OWNER, "10.88.3.3"), "10.88.3.3");
  assert.equal((await p2.s.send("POST", "/api/auth/mfa/verify", { recoveryCode: recovery[0] })).status, 200);
});
