// Stage 2B regression tests: owner bootstrap and group-assignment security, owner removals, MFA recovery (re-enrolment and
// owner break-glass), live-class idle behaviour, IP key consistency and strict mode, retention backlog, staff session
// settings. Real requests to the real Worker (Miniflare); the test owner is boss@example.com, and owner@example.com (in
// ADMIN_EMAILS) plays an existing, unassigned, NON-owner administrator.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { build } from "esbuild";
import { startWorker, SECRETS } from "./worker-harness.ts";
import { signIn as helperSignIn, session, type Session, eligible } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";

type W = Awaited<ReturnType<typeof startWorker>>;
const OWNER = "boss@example.com";
const MFA_KEY = Buffer.alloc(32, 9).toString("base64");
const BREAK_GLASS = "break-glass-token-for-tests-0123456789abcdef";
let w: W, wk: W, ws: W;
const ids: Record<string, string> = {};
let legacy: Session, owner: Session;

const resetLimits = async (x: W) => { await (await x.db()).prepare("DELETE FROM rate_limits").run(); };
const signIn = async (x: W, email: string) => { await resetLimits(x); return helperSignIn(x, email); };
const hashOf = (cookie: string) => createHash("sha256").update(`s|${cookie.split("=")[1]}`).digest("hex");
const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();
const setSession = async (x: W, s: Session, col: string, v: string) =>
  (await x.db()).prepare(`UPDATE auth_sessions SET ${col} = ?2 WHERE token_hash = ?1`).bind(hashOf(s.cookie), v).run();
const groupOf = async (x: W, id: string) => (await (await x.db()).prepare("SELECT admin_role FROM users WHERE id = ?1").bind(id).first<{ admin_role: string | null }>())!.admin_role;
const audited = async (x: W, action: string, target?: string) =>
  !!(await (await x.db()).prepare("SELECT 1 FROM audit_log WHERE action = ?1 AND (?2 IS NULL OR target_id = ?2)").bind(action, target ?? null).first());
async function verifyRaw(x: W, email: string) {
  await resetLimits(x);
  const before = x.calls.length;
  await x.post("/api/auth/request", { email, turnstileToken: "good-token" }, { "cf-connecting-ip": "10.66.1.1" });
  const isLink = (m: { url: string; body: string }) => m.url.includes("api.resend.com") && m.body.includes(email) && m.body.includes("/app/confirm/?t=");
  assert.ok(await x.waitFor((c) => c.slice(before).some(isLink)), `link to ${email}`);
  const token = JSON.parse(x.calls.slice(before).filter(isLink).at(-1)!.body).html.match(/\/app\/confirm\/\?t=([\w-]+)/)[1];
  const r = await x.post("/api/auth/verify", { token }, { "cf-connecting-ip": "10.66.1.1" });
  return { r, s: session(x, r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "10.66.1.1") };
}

// A session that passed the authenticator code (required since Stage 2C for owner and administrator-management actions):
// signs in by email, enrols an authenticator on first use, and reuses the session afterwards.
const strongCache = new Map<string, Session>();
async function strong(x: W, email: string): Promise<Session> {
  const k = `${x === w ? "w" : x === wk ? "wk" : "o"}:${email}`;
  const hit = strongCache.get(k);
  if (hit && (await hit.get("/api/me")).status === 200) return hit;
  const s = await signIn(x, email);
  const secret = (await s.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  await s.json("POST", "/api/auth/mfa/enable", { code: await totpAt(secret, stepOf(Date.now())) });
  strongCache.set(k, s);
  return s;
}

before(async () => {
  w = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: MFA_KEY } });
  wk = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: MFA_KEY, OWNER_RECOVERY_TOKEN: BREAK_GLASS } });
  ws = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: "owner@example.com", INSTRUCTOR_IDLE_MINUTES: "60", INSTRUCTOR_SESSION_HOURS: "24", ADMIN_IDLE_MINUTES: "15", ADMIN_SESSION_HOURS: "12" } });
  legacy = await signIn(w, "owner@example.com");            // existing unassigned administrator, NOT the owner
  ids.legacy = (await legacy.json<{ user: { id: string } }>("GET", "/api/me")).user.id;
  owner = await strong(w, OWNER);                            // the configured owner, signed in with the authenticator code (Stage 2C)
  ids.owner = (await owner.json<{ user: { id: string } }>("GET", "/api/me")).user.id;
});
after(async () => { await w.dispose(); await wk.dispose(); await ws.dispose(); });

// ------------------------------------------------------------------ 1. bootstrap and group assignment ----
test("unassigned NON-owner administrator cannot promote themselves (the Stage 2 hole is closed)", async () => {
  const me = await legacy.json<{ admin: { owner: boolean; role: string | null } }>("GET", "/api/me");
  assert.deepEqual([me.admin.owner, me.admin.role], [false, null]);
  for (const g of ["super", "finance", "reporting"]) {
    const r = await legacy.send("PATCH", `/api/app/admin/users/${ids.legacy}`, { adminRole: g });
    assert.equal(r.status, 403, g);
  }
  assert.equal(await groupOf(w, ids.legacy), null);
  assert.ok(await audited(w, "admin.group_refused", ids.legacy), "refusal recorded");
  // ...nor create a Super Administrator, nor create any administrator.
  assert.equal((await legacy.send("POST", "/api/app/admin/users", { email: "sneaky@example.com", role: "admin", fullName: "Sneaky", sendInvite: false, adminRole: "super" })).status, 403);
  assert.equal((await legacy.send("POST", "/api/app/admin/users", { email: "sneaky2@example.com", role: "admin", fullName: "Sneaky", sendInvite: false })).status, 403);
  // Day-to-day access is preserved for existing administrators.
  assert.equal((await legacy.get("/api/app/admin/overview")).status, 200);
  assert.equal((await legacy.get("/api/app/admin/payments")).status, 200);
});

test("before set-up nobody can assign groups; the owner's one-time bootstrap enables it and cannot be repeated", async () => {
  ids.a2 = (await owner.json<{ user: { id: string; adminRole: string } }>("POST", "/api/app/admin/users", { email: "a2@example.com", role: "admin", fullName: "Admin Two", sendInvite: false })).user.id;
  assert.equal(await groupOf(w, ids.a2), "reporting", "new administrators start read-only");
  assert.equal((await owner.send("PATCH", `/api/app/admin/users/${ids.a2}`, { adminRole: "finance" })).status, 403, "owner must complete set-up first");
  assert.equal((await legacy.send("POST", "/api/app/owner/bootstrap")).status, 403, "non-owner cannot bootstrap");
  const st = await owner.json<{ isOwner: boolean; bootstrapped: boolean }>("GET", "/api/app/owner/status");
  assert.deepEqual([st.isOwner, st.bootstrapped], [true, false]);
  assert.equal((await owner.send("POST", "/api/app/owner/bootstrap")).status, 200);
  assert.equal(await groupOf(w, ids.owner), "super");
  assert.ok(await audited(w, "owner.bootstrap", ids.owner));
  assert.equal((await owner.send("POST", "/api/app/owner/bootstrap")).status, 409, "bootstrap privilege disabled after use");
  assert.equal((await legacy.send("PATCH", `/api/app/admin/users/${ids.legacy}`, { adminRole: "super" })).status, 403, "still refused after set-up");
});

test("Super Administrators: only the owner appoints them; they assign other groups but never their own, the owner's or a Super's", async () => {
  assert.equal((await owner.send("PATCH", `/api/app/admin/users/${ids.a2}`, { adminRole: "super" })).status, 200);
  assert.ok(await audited(w, "admin.group_assigned", ids.a2));
  const a2 = await strong(w, "a2@example.com");
  ids.a3 = (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "a3@example.com", role: "admin", fullName: "Admin Three", sendInvite: false })).user.id;
  assert.equal((await a2.send("PATCH", `/api/app/admin/users/${ids.a3}`, { adminRole: "finance" })).status, 200, "a Super assigns an authorised group");
  assert.equal(await groupOf(w, ids.a3), "finance");
  assert.equal((await a2.send("PATCH", `/api/app/admin/users/${ids.a3}`, { adminRole: "super" })).status, 403, "only the owner appoints Supers");
  assert.equal((await a2.send("PATCH", `/api/app/admin/users/${ids.a2}`, { adminRole: "academic" })).status, 403, "nobody changes their own group");
  assert.equal((await a2.send("PATCH", `/api/app/admin/users/${ids.owner}`, { adminRole: "reporting" })).status, 403, "the owner's group is fixed");
  assert.equal((await a2.send("PATCH", `/api/app/admin/users/${ids.owner}`, { status: "suspended" })).status, 403, "nobody suspends the owner");
  assert.equal((await a2.send("POST", "/api/app/admin/users", { email: "s3@example.com", role: "admin", fullName: "S3", adminRole: "super", sendInvite: false })).status, 403);
  assert.equal((await legacy.send("PATCH", `/api/app/admin/users/${ids.a2}`, { status: "suspended" })).status, 403, "an unassigned admin cannot suspend a Super");
  // A normal (finance) administrator cannot change their own group or anyone else's.
  const a3 = await signIn(w, "a3@example.com");
  assert.equal((await a3.send("PATCH", `/api/app/admin/users/${ids.a3}`, { adminRole: "super" })).status, 403);
  assert.equal((await a3.send("PATCH", `/api/app/admin/users/${ids.a2}`, { adminRole: "reporting" })).status, 403);
  assert.equal(await groupOf(w, ids.a3), "finance");
});

test("profile updates cannot set groups, roles, owner status or email", async () => {
  const a3 = await signIn(w, "a3@example.com");
  await a3.send("PATCH", "/api/me", { adminRole: "super", admin_role: "super", role: "admin", email: OWNER, removed_at: null, mfa_required: 0, owner: true });
  const me = await a3.json<{ user: { email: string }; admin: { role: string; owner: boolean } }>("GET", "/api/me");
  assert.deepEqual([me.user.email, me.admin.role, me.admin.owner], ["a3@example.com", "finance", false]);
  // Owner-only routes refuse everyone else, whatever their group.
  const a2 = await strong(w, "a2@example.com");
  for (const p of ["/api/app/owner/staff", "/api/app/owner/audit", "/api/app/owner/removal-requests"]) {
    assert.equal((await a2.get(p)).status, 403, p);
    assert.equal((await legacy.get(p)).status, 403, p);
  }
});

test("owner removals: Supers request, the owner approves; removed accounts cannot sign in; records are kept", async () => {
  const a2 = await strong(w, "a2@example.com");
  const a3 = await signIn(w, "a3@example.com");
  assert.equal((await a2.send("POST", `/api/app/admin/users/${ids.owner}/removal-requests`, { reason: "x" })).status, 403, "the owner cannot be targeted");
  assert.equal((await a3.send("POST", `/api/app/admin/users/${ids.a2}/removal-requests`, { reason: "x" })).status, 403, "only Supers can request");
  const req = await a2.json<{ id: string }>("POST", `/api/app/admin/users/${ids.a3}/removal-requests`, { reason: "Left the Academy" });
  assert.equal((await a2.send("POST", `/api/app/owner/removal-requests/${req.id}`, { decision: "approve" })).status, 403, "only the owner decides");
  assert.equal((await a3.get("/api/me")).status, 200, "nothing happens before approval");
  const list = await owner.json<{ requests: { id: string }[] }>("GET", "/api/app/owner/removal-requests?status=pending");
  assert.ok(list.requests.some((r) => r.id === req.id));
  await owner.json("POST", `/api/app/owner/removal-requests/${req.id}`, { decision: "approve", note: "Confirmed" });
  assert.equal((await owner.send("POST", `/api/app/owner/removal-requests/${req.id}`, { decision: "reject" })).status, 409, "decided once");
  assert.equal((await a3.get("/api/me")).status, 401, "sessions ended");
  const before = w.calls.length;
  await w.post("/api/auth/request", { email: "a3@example.com", turnstileToken: "good-token" }, { "cf-connecting-ip": "10.66.9.9" });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!w.calls.slice(before).some((c) => c.url.includes("api.resend.com") && c.body.includes("a3@example.com")), "no sign-in link for a removed account");
  assert.equal((await owner.send("PATCH", `/api/app/admin/users/${ids.a3}`, { status: "active" })).status, 403, "removal is permanent");
  const row = await (await w.db()).prepare("SELECT removed_at, removed_by FROM users WHERE id = ?1").bind(ids.a3).first<{ removed_at: string; removed_by: string }>();
  assert.ok(row?.removed_at && row.removed_by === ids.owner, "row kept, marked removed");
  // Direct removal of a student by the owner; the owner cannot remove themselves.
  const st = (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "gone@example.com", role: "student", fullName: "Gone Student", sendInvite: false })).user.id;
  assert.equal((await owner.send("POST", `/api/app/owner/users/${st}/remove`, {})).status, 400, "a reason is required");
  await owner.json("POST", `/api/app/owner/users/${st}/remove`, { reason: "Duplicate account" });
  assert.equal((await owner.send("POST", `/api/app/owner/users/${ids.owner}/remove`, { reason: "x" })).status, 403);
  assert.equal((await a2.send("POST", `/api/app/owner/users/${st}/remove`, { reason: "x" })).status, 403, "Supers cannot remove directly");
  // The owner can audit everything, searchable.
  const log = await owner.json<{ entries: { action: string; target_id: string }[] }>("GET", `/api/app/owner/audit?action=owner.&target=${ids.a3}`);
  assert.ok(log.entries.some((e) => e.action === "owner.removal_approved"));
  assert.ok(log.entries.every((e) => e.action.startsWith("owner.") && e.target_id === ids.a3));
});

test("the owner's address is reserved and the owner is recognised only by OWNER_EMAIL plus an active admin account", async () => {
  const a2 = await signIn(wk, "owner@example.com"); // a non-owner administrator on the MFA worker, before the owner exists
  const pre = await a2.send("POST", "/api/app/admin/users", { email: OWNER, role: "student", fullName: "Fake", sendInvite: false });
  assert.equal(pre.status, 400, "cannot pre-create the owner's account");
  assert.equal(((await pre.json()) as { error: string }).error, "reserved");
  const noOwner = await startWorker();
  try {
    const x = await signIn(noOwner, "owner@example.com");
    const st = await x.json<{ ownerConfigured: boolean; isOwner: boolean }>("GET", "/api/app/owner/status");
    assert.deepEqual([st.ownerConfigured, st.isOwner], [false, false], "no OWNER_EMAIL: nobody is the owner");
    assert.equal((await x.send("POST", "/api/app/owner/bootstrap")).status, 403);
  } finally { await noOwner.dispose(); }
});

// ------------------------------------------------------------------ 4. MFA recovery ----
const code = async (secret: string, off = 0) => totpAt(secret, stepOf(Date.now()) + off);

test("owner console needs two-step sign-in when it is configured; owner break-glass is audited, single-use and forces re-enrolment", async () => {
  const o = await signIn(wk, OWNER);
  assert.equal((await o.get("/api/app/owner/status")).status, 200);
  const r = await o.get("/api/app/owner/staff");
  assert.equal(r.status, 403);
  assert.equal(((await r.json()) as { error: string }).error, "owner_mfa_required");
  const secret = (await o.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  await o.json("POST", "/api/auth/mfa/enable", { code: await code(secret) });
  assert.equal((await o.get("/api/app/owner/staff")).status, 200, "MFA-verified owner session opens the console");
  // Lost phone and codes: sign in by email (pending MFA), then the break-glass token.
  const p = await verifyRaw(wk, OWNER);
  assert.equal(((await p.r.json()) as { mfaRequired: boolean }).mfaRequired, true);
  assert.equal((await p.s.send("POST", "/api/auth/owner-recovery", { token: "wrong-token-wrong-token-wrong-token-1" })).status, 400);
  const ok = await p.s.send("POST", "/api/auth/owner-recovery", { token: BREAK_GLASS });
  assert.equal(ok.status, 200);
  assert.ok(await audited(wk, "mfa.owner_break_glass") && await audited(wk, "mfa.owner_break_glass_failed"));
  assert.equal((await p.s.get("/api/me")).status, 401, "signed out everywhere");
  assert.equal((await o.get("/api/me")).status, 401);
  // Re-enrolment required: the next email sign-in has no code step but administration stays closed until enrolment.
  const q = await verifyRaw(wk, OWNER);
  assert.equal(((await q.r.json()) as { mfaRequired: boolean }).mfaRequired, false);
  const blocked = await q.s.get("/api/app/admin/overview");
  assert.equal(blocked.status, 403);
  assert.equal(((await blocked.json()) as { error: string }).error, "mfa_setup_required");
  const s2 = (await q.s.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  await q.s.json("POST", "/api/auth/mfa/enable", { code: await code(s2) });
  assert.equal((await q.s.get("/api/app/admin/overview")).status, 200, "enrolled again: access restored");
  // The same token cannot be used twice.
  const again = await verifyRaw(wk, OWNER);
  assert.equal((await again.s.send("POST", "/api/auth/owner-recovery", { token: BREAK_GLASS })).status, 400);
  // A non-owner cannot use the break-glass route at all.
  const other = await signIn(wk, "owner@example.com");
  assert.equal((await other.send("POST", "/api/auth/owner-recovery", { token: BREAK_GLASS })).status, 403);
});

test("MFA reset by the owner revokes sessions, notifies the administrator and requires re-enrolment", async () => {
  const x = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: MFA_KEY } });
  try {
    const own = await signIn(x, OWNER);
    const osec = (await own.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
    await own.json("POST", "/api/auth/mfa/enable", { code: await code(osec) });
    await own.json("POST", "/api/app/owner/bootstrap");
    const id = (await own.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "fin2@example.com", role: "admin", fullName: "Fin Two", sendInvite: false, adminRole: "finance" })).user.id;
    const f = await signIn(x, "fin2@example.com");
    const fsec = (await f.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
    await f.json("POST", "/api/auth/mfa/enable", { code: await code(fsec) });
    const before = x.calls.length;
    assert.equal((await own.send("POST", `/api/app/admin/users/${id}/mfa-reset`)).status, 200);
    assert.equal((await f.get("/api/me")).status, 401, "sessions revoked");
    assert.ok(await x.waitFor((c) => c.slice(before).some((m) => m.url.includes("api.resend.com") && m.body.includes("fin2@example.com") && m.body.includes("reset"))), "administrator notified");
    const back = await verifyRaw(x, "fin2@example.com");
    assert.equal((await back.s.get("/api/app/admin/payments")).status, 403, "must enrol again before using administration");
    // Nobody resets the owner, and nobody resets themselves.
    assert.equal((await back.s.send("POST", `/api/app/admin/users/${(await own.json<{ user: { id: string } }>("GET", "/api/me")).user.id}/mfa-reset`)).status, 403);
  } finally { await x.dispose(); }
});

// ------------------------------------------------------------------ 2. live class and idle timeout ----
test("live class: idle sign-out during a Meet class creates no missed class and erases nothing; the class is recorded normally", async () => {
  const st = (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "learner@example.com", role: "student", fullName: "Live Learner", sendInvite: false })).user.id;
  const ins = (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "teacher@example.com", role: "instructor", fullName: "Live Teacher", sendInvite: false })).user.id;
  await owner.json("PATCH", `/api/app/admin/recruitment/${ins}`, { checks: { identity: { done: true }, credentials: { done: true }, technical: { done: true } }, stage: "approved", sendInvite: false });
  await eligible(owner, ins, "webdev");
  const en = (await owner.json<{ enrolment: { id: string } }>("POST", "/api/app/admin/enrolments", { studentId: st, programme: "webdev", instructorId: ins })).enrolment.id;
  const db = await w.db();
  // A 60-minute class that started 20 minutes ago, with a Meet link.
  await db.prepare("INSERT INTO class_sessions (id, enrolment_id, student_id, instructor_id, starts_at, ends_at, status, meet_url, created_at) VALUES ('live-1', ?1, ?2, ?3, ?4, ?5, 'scheduled', 'https://meet.google.com/abc-defg-hij', ?4)")
    .bind(en, st, ins, ago(20 * 60), ago(-40 * 60)).run();
  const stu = await signIn(w, "learner@example.com");
  const sess = await stu.json<{ sessions: { id: string; meetUrl: string; joinOpen: boolean }[] }>("GET", "/api/app/student/sessions");
  const live = sess.sessions.find((s) => s.id === "live-1")!;
  assert.equal(live.meetUrl, "https://meet.google.com/abc-defg-hij");
  // The student opens Meet (a new tab) and does not touch the dashboard for 11 minutes.
  await setSession(w, stu, "last_activity_at", ago(11 * 60));
  const r = await stu.get("/api/app/student/overview");
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("x-session-expired"), "idle");
  const row = await db.prepare("SELECT status, outcome_at FROM class_sessions WHERE id = 'live-1'").first<{ status: string; outcome_at: string | null }>();
  assert.deepEqual({ ...row }, { status: "scheduled", outcome_at: null }, "the class is untouched by the sign-out");
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM class_sessions WHERE student_id = ?1 AND status = 'missed'").bind(st).first<{ n: number }>())!.n, 0, "no missed record");
  // The instructor records attendance as usual; the student signs in again and sees it.
  const teacher = await signIn(w, "teacher@example.com");
  await db.prepare("UPDATE class_sessions SET ends_at = ?2 WHERE id = 'live-1'").bind("live-1", ago(60)).run();
  await teacher.json("POST", "/api/app/instructor/sessions/live-1/outcome", { status: "completed" });
  const back = await signIn(w, "learner@example.com");
  const after = await back.json<{ sessions: { id: string; status: string }[] }>("GET", "/api/app/student/sessions?scope=all");
  const done = after.sessions.find((s) => s.id === "live-1");
  const stored = await db.prepare("SELECT status FROM class_sessions WHERE id = 'live-1'").first<{ status: string }>();
  assert.equal(stored!.status, "completed", "attendance recorded normally");
  if (done) assert.equal(done.status, "completed");
});

// ------------------------------------------------------------------ 8. staff session settings (server-side) ----
test("staff session variables are enforced by the server when set", async () => {
  await resetLimits(ws);
  const owner2 = await helperSignIn(ws, "owner@example.com");
  const insId = (await owner2.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "inst@example.com", role: "instructor", fullName: "Inst", sendInvite: false })).user.id;
  await owner2.json("PATCH", `/api/app/admin/recruitment/${insId}`, { checks: { identity: { done: true }, credentials: { done: true }, technical: { done: true } }, stage: "approved", sendInvite: false });
  const i = await verifyRaw(ws, "inst@example.com");
  assert.match(i.r.headers.get("set-cookie") ?? "", /Max-Age=86400\b/, "instructor: 24-hour cookie");
  await setSession(ws, i.s, "last_activity_at", ago(59 * 60));
  assert.equal((await i.s.get("/api/me")).status, 200, "59 minutes idle: fine");
  await setSession(ws, i.s, "last_activity_at", ago(61 * 60));
  assert.equal((await i.s.get("/api/me")).status, 401, "61 minutes idle: signed out");
  const i2 = await verifyRaw(ws, "inst@example.com");
  await setSession(ws, i2.s, "created_at", ago(25 * 3600));
  await setSession(ws, i2.s, "last_activity_at", ago(5));
  assert.equal((await i2.s.get("/api/me")).status, 401, "24-hour lifetime");
  const a = await verifyRaw(ws, "owner@example.com");
  assert.match(a.r.headers.get("set-cookie") ?? "", /Max-Age=43200\b/, "admin: 12-hour cookie");
  await setSession(ws, a.s, "last_activity_at", ago(16 * 60));
  assert.equal((await a.s.get("/api/me")).status, 401, "admin 15-minute idle");
  // Defaults unchanged where nothing is set (main worker): instructors keep 30 days with no idle limit.
  const t = await signIn(w, "teacher@example.com");
  await setSession(w, t, "last_activity_at", ago(3 * 3600));
  assert.equal((await t.get("/api/me")).status, 200);
});

// ------------------------------------------------------------------ 3. IP pseudonymisation ----
async function privacyModule() {
  const r = await build({ entryPoints: ["src/server/privacy.ts"], bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}`);
}
// A tiny stand-in for D1 that implements the two statements privacy.ts uses.
function fakeD1() {
  const rows = new Map<string, string>();
  return { rows, prepare: (sql: string) => ({ bind: (...a: string[]) => ({
    run: async () => { if (/INSERT INTO app_settings/.test(sql) && !rows.has(a[0])) rows.set(a[0], a[1]); return {}; },
    first: async () => (rows.has(a[0]) ? { value: rows.get(a[0]) } : null),
  }) }) };
}

test("IP key: dedicated secret; one persistent D1 key shared by every isolate; strict mode fails safe; never a constant", async () => {
  const p = await privacyModule();
  // 1. IP_HASH_SALT.
  p.__newIsolate();
  assert.equal(await p.ipPseudonym({ IP_HASH_SALT: "s".repeat(32) }, "1.2.3.4"), createHmac("sha256", "s".repeat(32)).update("ip|1.2.3.4").digest("hex"));
  assert.equal(await p.ipKeySource({ IP_HASH_SALT: "s".repeat(32) }), "secret");
  // 2. No secret: a key is created once in D1 and every new isolate reads the same one.
  const db = fakeD1();
  p.__newIsolate();
  const h1 = await p.ipPseudonym({ DB: db }, "1.2.3.4");
  assert.equal(db.rows.size, 1, "stored once");
  p.__newIsolate();
  const h2 = await p.ipPseudonym({ DB: db }, "1.2.3.4");
  assert.equal(h1, h2, "consistent across isolates");
  assert.equal(await p.ipKeySource({ DB: db }), "d1");
  // 3. Strict mode refuses to run without the secret (503), whatever else is available.
  p.__newIsolate();
  await assert.rejects(p.ipPseudonym({ DB: db, IP_HASH_STRICT: "true" }, "1.2.3.4"), (e: { status: number }) => e.status === 503);
  assert.equal(await p.ipKeySource({ IP_HASH_STRICT: "true" }), "missing");
  // 4. Nothing available: a random per-isolate key (never a constant), reported as "ephemeral".
  p.__newIsolate();
  const e1 = await p.ipPseudonym({}, "1.2.3.4");
  p.__newIsolate();
  const e2 = await p.ipPseudonym({}, "1.2.3.4");
  assert.notEqual(e1, e2, "two isolates get different random keys: no predictable value");
  for (const guess of ["sma", "", "ip"]) assert.notEqual(e1, createHmac("sha256", guess).update("ip|1.2.3.4").digest("hex"));
});

test("IP key in the Worker: persisted in D1, never returned by any API", async () => {
  const row = await (await w.db()).prepare("SELECT value FROM app_settings WHERE key = 'sec:ip-hash-key'").first<{ value: string }>();
  assert.ok(row, "generated and stored");
  const key = JSON.parse(row!.value) as string;
  for (const p of ["/api/app/admin/settings/retention", "/api/me", "/api/app/owner/status", "/api/app/admin/platform"]) {
    const t = await (await owner.get(p)).text();
    assert.ok(!t.includes(key), p);
  }
  const st = await owner.json<{ security: { ipHashKey: string } }>("GET", "/api/app/admin/settings/retention");
  assert.equal(st.security.ipHashKey, "d1");
  const strict = await startWorker({ env: { ...SECRETS, IP_HASH_STRICT: "true" } });
  try {
    const r = await strict.post("/api/auth/request", { email: "x@example.com", turnstileToken: "good-token" });
    assert.equal(r.status, 503, "strict mode without the secret refuses service instead of weakening privacy");
    assert.doesNotMatch(await r.text(), /IP_HASH|salt|secret/i, "the reason is not exposed publicly");
  } finally { await strict.dispose(); }
});

// ------------------------------------------------------------------ 7. retention backlog ----
test("retention: hitting the batch limit is flagged (audit + last run) so a backlog is visible", async () => {
  const r = await build({ stdin: { contents: `export { runRetention } from "./src/server/lms/retention";`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "silent" });
  const m = await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}`);
  const db = await w.db();
  await owner.json("PUT", "/api/app/admin/settings/retention", { error_log: { on: true, days: 90 } });
  for (let i = 0; i < 3; i++) await db.prepare("INSERT INTO error_log (id, at, route, message) VALUES (?1, ?2, 'x', 'old')").bind(`bk${i}`, ago(400 * 86400)).run();
  const done = await m.runRetention(db, new Date(), 2);
  assert.equal(done.error_log, 2);
  assert.ok(await audited(w, "retention.backlog"));
  const st = await owner.json<{ lastRun: { backlog: string[]; deleted: Record<string, number> } }>("GET", "/api/app/admin/settings/retention");
  assert.deepEqual(st.lastRun.backlog, ["error_log"]);
  await m.runRetention(db, new Date(), 2);
  const st2 = await owner.json<{ lastRun: { backlog: string[] } }>("GET", "/api/app/admin/settings/retention");
  assert.deepEqual(st2.lastRun.backlog, [], "backlog cleared once caught up");
  await owner.json("PUT", "/api/app/admin/settings/retention", { error_log: { on: false, days: 90 } });
});
