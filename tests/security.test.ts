// Stage 2 security regression tests. Every test sends real requests to the real Worker (Miniflare, local D1/KV/R2) and
// checks the response and the stored data. Time is simulated by moving stored timestamps back, never by waiting.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { startWorker, SECRETS } from "./worker-harness.ts";
import { setup, signIn as helperSignIn, session, type Session } from "./lms-helpers.ts";
import { base32Encode, stepOf, totpAt, verifyTotp } from "../src/server/lms/mfa-crypto.ts";
import { checkContent, checkUpload, DOC_TYPES, unsafeName } from "../src/server/lms/upload-rules.ts";
import { buildRules, inlineScriptHashes, policyFor } from "../scripts/csp.mts";

type W = Awaited<ReturnType<typeof startWorker>>;
const MFA_KEY = Buffer.alloc(32, 7).toString("base64");
const IP_SALT = "test-ip-salt-0123456789abcdef";
let w: W;    // default configuration (no IP_HASH_SALT: the random KV key is used)
let wm: W;   // MFA configured, admin idle limit 15 minutes, IP_HASH_SALT set
const ids: Record<string, string> = {};
let admin: Session;

const hashOf = (cookie: string) => createHash("sha256").update(`s|${cookie.split("=")[1]}`).digest("hex");
const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();
async function setSession(x: W, s: Session, cols: Record<string, string | number | null>) {
  const keys = Object.keys(cols);
  await (await x.db()).prepare(`UPDATE auth_sessions SET ${keys.map((k, i) => `${k} = ?${i + 2}`).join(", ")} WHERE token_hash = ?1`).bind(hashOf(s.cookie), ...keys.map((k) => cols[k])).run();
}
const sessionRow = async (x: W, s: Session) => (await x.db()).prepare("SELECT * FROM auth_sessions WHERE token_hash = ?1").bind(hashOf(s.cookie)).first<Record<string, string | number | null>>();
const resetLimits = async (x: W) => { await (await x.db()).prepare("DELETE FROM rate_limits").run(); };
// These tests sign the same people in many times; the per-email sign-in limit (tested on its own below) is reset first.
const signIn = async (x: W, email: string) => { await resetLimits(x); return helperSignIn(x, email); };

// Requests a link and confirms it, returning the raw verify response (so MFA-pending answers can be inspected).
let ipN = 1;
async function linkVerify(x: W, email: string, extraCookie?: string) {
  const ip = `10.77.${Math.floor(ipN / 200)}.${(ipN++ % 200) + 1}`;
  await (await x.db()).prepare("DELETE FROM rate_limits WHERE key LIKE 'login%'").run();
  const before = x.calls.length;
  assert.equal((await x.post("/api/auth/request", { email, turnstileToken: "good-token" }, { "cf-connecting-ip": ip })).status, 200);
  const isLink = (m: { url: string; body: string }) => m.url.includes("api.resend.com") && m.body.includes(email) && m.body.includes("/app/confirm/?t=");
  assert.ok(await x.waitFor((c) => c.slice(before).some(isLink)));
  const mail = x.calls.slice(before).filter(isLink).at(-1)!;
  const token = JSON.parse(mail.body).html.match(/\/app\/confirm\/\?t=([\w-]+)/)[1];
  const r = await x.post("/api/auth/verify", { token }, { "cf-connecting-ip": ip, ...(extraCookie ? { cookie: extraCookie } : {}) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return { r, cookie, setCookie: r.headers.get("set-cookie") ?? "", s: session(x, cookie, ip) };
}

before(async () => {
  // owner@example.com (the harness administrator) is the configured platform owner here. Since Stage 2C, owner-console
  // routes and administrator management need a session that passed the authenticator code (see the permissions test).
  w = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: "owner@example.com" } });
  wm = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: "owner@example.com", MFA_ENCRYPTION_KEY: MFA_KEY, ADMIN_IDLE_MINUTES: "15", IP_HASH_SALT: IP_SALT } });
  const s = await setup(w);
  admin = s.admin;
  ids.stuA = await s.make("student", "sec-a@example.com", "Student A");
  ids.stuB = await s.make("student", "sec-b@example.com", "Student B");
  ids.insA = await s.make("instructor", "sec-ia@example.com", "Instructor A");
  ids.insB = await s.make("instructor", "sec-ib@example.com", "Instructor B");
  ids.enA = (await admin.json<{ enrolment: { id: string } }>("POST", "/api/app/admin/enrolments", { studentId: ids.stuA, programme: "webdev", instructorId: ids.insA })).enrolment.id;
  ids.enB = (await admin.json<{ enrolment: { id: string } }>("POST", "/api/app/admin/enrolments", { studentId: ids.stuB, programme: "graphics", instructorId: ids.insB })).enrolment.id;
});
after(async () => { await w.dispose(); await wm.dispose(); });

// ---------------------------------------------------------------- student sessions (10-minute idle) ----
test("student session: cookie is HttpOnly, Secure, SameSite=Lax and lasts at most 12 hours", async () => {
  const { setCookie } = await linkVerify(w, "sec-a@example.com");
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Max-Age=43200\b/);
  const { setCookie: staff } = await linkVerify(w, "sec-ia@example.com");
  assert.match(staff, /Max-Age=2592000\b/, "instructor sessions unchanged (30 days)");
});

test("student session: active use works; 10 minutes without genuine activity signs the student out for good", async () => {
  const stu = await signIn(w, "sec-a@example.com");
  assert.equal((await stu.get("/api/me")).status, 200);
  await setSession(w, stu, { last_activity_at: ago(9 * 60 + 30) });
  assert.equal((await stu.get("/api/me")).status, 200, "9.5 minutes idle: still signed in");
  await setSession(w, stu, { last_activity_at: ago(10 * 60 + 5) });
  const r = await stu.get("/api/app/student/overview");
  assert.equal(r.status, 401);
  assert.equal(((await r.json()) as { error: string }).error, "session_expired");
  assert.equal(r.headers.get("x-session-expired"), "idle");
  assert.match(r.headers.get("set-cookie") ?? "", /sma_session=;.*Max-Age=0/, "cookie cleared");
  assert.equal(await sessionRow(w, stu), null, "the session is deleted on the server");
  // Refresh, wake from sleep, reopened browser, copied cookie: the same cookie never works again.
  const again = await stu.get("/api/me");
  assert.equal(again.status, 401);
  assert.equal(((await again.json()) as { error: string }).error, "unauthenticated");
});

test("student session: genuine activity resets the timer; background polling does not", async () => {
  const stu = await signIn(w, "sec-a@example.com");
  await setSession(w, stu, { last_activity_at: ago(9 * 60) });
  const before = (await sessionRow(w, stu))!.last_activity_at;
  for (let i = 0; i < 3; i++) assert.equal((await stu.get("/api/app/notifications")).status, 200);
  assert.equal((await stu.get("/api/me")).status, 200);
  assert.equal((await sessionRow(w, stu))!.last_activity_at, before, "polling and page loads do not count as activity");
  assert.equal((await stu.send("POST", "/api/auth/activity", { ago: 0 })).status, 200);
  const after = Date.parse(String((await sessionRow(w, stu))!.last_activity_at));
  assert.ok(Date.now() - after < 5000, "activity recorded now");
  // Throttled: a second report straight away writes nothing.
  await stu.send("POST", "/api/auth/activity", {});
  assert.equal(Date.parse(String((await sessionRow(w, stu))!.last_activity_at)), after);
  // The browser can only move the time BACK (late report), by at most 30 seconds, never forward.
  await setSession(w, stu, { last_activity_at: ago(300) });
  await stu.send("POST", "/api/auth/activity", { ago: 999_999 });
  const back = Date.now() - Date.parse(String((await sessionRow(w, stu))!.last_activity_at));
  assert.ok(back >= 29_000 && back < 35_000, `clamped to 30 s (${back} ms)`);
  await setSession(w, stu, { last_activity_at: ago(300) });
  await stu.send("POST", "/api/auth/activity", { ago: -60_000 });
  assert.ok(Date.parse(String((await sessionRow(w, stu))!.last_activity_at)) <= Date.now() + 1000, "never in the future");
});

test("student session: an expired session cannot be revived by an activity report (device slept)", async () => {
  const stu = await signIn(w, "sec-a@example.com");
  await setSession(w, stu, { last_activity_at: ago(11 * 60) });
  const r = await stu.send("POST", "/api/auth/activity", {});
  assert.equal(r.status, 401);
  assert.equal(((await r.json()) as { error: string }).error, "session_expired");
  assert.equal((await stu.get("/api/me")).status, 401);
});

test("student session: 12-hour absolute limit even with constant activity", async () => {
  const stu = await signIn(w, "sec-a@example.com");
  await setSession(w, stu, { created_at: ago(13 * 3600), last_activity_at: ago(5) });
  const r = await stu.get("/api/me");
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("x-session-expired"), "lifetime");
});

test("staff sessions keep today's rules unless the owner sets idle limits", async () => {
  const ins = await signIn(w, "sec-ia@example.com");
  await setSession(w, ins, { last_activity_at: ago(2 * 3600) });
  assert.equal((await ins.get("/api/me")).status, 200, "instructor: no idle limit by default");
  const me = await ins.json<{ session: { idleMinutes: number | null } }>("GET", "/api/me");
  assert.equal(me.session.idleMinutes, null);
  // On the second worker ADMIN_IDLE_MINUTES=15.
  const owner = await linkVerify(wm, "owner@example.com");
  await setSession(wm, owner.s, { last_activity_at: ago(16 * 60) });
  assert.equal((await owner.s.get("/api/me")).status, 401, "admin idle limit applies when configured");
});

test("logout ends this device only; logout-all ends every device", async () => {
  const s1 = await signIn(w, "sec-b@example.com");
  const s2 = await signIn(w, "sec-b@example.com");
  assert.equal((await s1.send("POST", "/api/auth/logout")).status, 200);
  assert.equal((await s1.get("/api/me")).status, 401);
  assert.equal((await s2.get("/api/me")).status, 200, "other device still signed in");
  const s3 = await signIn(w, "sec-b@example.com");
  const r = await s2.send("POST", "/api/auth/logout-all");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.equal((await s2.get("/api/me")).status, 401);
  assert.equal((await s3.get("/api/me")).status, 401);
});

test("session fixation: signing in discards any session the browser already had", async () => {
  const old = await signIn(w, "sec-b@example.com");
  const fresh = await linkVerify(w, "sec-b@example.com", old.cookie);
  assert.equal(fresh.r.status, 200);
  assert.notEqual(fresh.cookie, old.cookie, "a new token is issued");
  assert.equal(await sessionRow(w, old), null, "the presented session was deleted");
  assert.equal((await fresh.s.get("/api/me")).status, 200);
});

test("only hashes of session tokens are stored", async () => {
  const s = await signIn(w, "sec-b@example.com");
  const raw = s.cookie.split("=")[1];
  const rows = await (await w.db()).prepare("SELECT token_hash FROM auth_sessions").all<{ token_hash: string }>();
  assert.ok(!rows.results.some((r) => r.token_hash === raw), "raw token never stored");
  assert.ok(rows.results.some((r) => r.token_hash === hashOf(s.cookie)));
});

// ---------------------------------------------------------------- administrator MFA ----
test("TOTP matches the RFC 6238 test vectors (SHA-1, 6 digits)", async () => {
  const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
  assert.equal(await totpAt(secret, 1), "287082");            // T = 59 s
  assert.equal(await totpAt(secret, 37037036), "081804");     // T = 1111111109 s
  assert.equal(await totpAt(secret, 37037037), "050471");     // T = 1111111111 s
  assert.equal(await verifyTotp(secret, "287082", 59_000, 1), null, "a step already used is refused");
});

async function code(secret: string, offset = 0) { return totpAt(secret, stepOf(Date.now()) + offset); }

test("admin MFA: setup, wrong code refused, enable returns 10 single-use recovery codes and signs out other devices", async () => {
  const owner = await linkVerify(wm, "owner@example.com");
  const other = await linkVerify(wm, "owner@example.com");
  const st = await owner.s.json<{ configured: boolean; enabled: boolean }>("GET", "/api/auth/mfa/status");
  assert.deepEqual([st.configured, st.enabled], [true, false]);
  const setupR = await owner.s.json<{ secret: string; otpauthUrl: string }>("POST", "/api/auth/mfa/setup");
  assert.match(setupR.otpauthUrl, /^otpauth:\/\/totp\//);
  const stored = await (await wm.db()).prepare("SELECT secret_enc FROM mfa_factors").first<{ secret_enc: string }>();
  assert.ok(stored && stored.secret_enc.startsWith("v1:") && !stored.secret_enc.includes(setupR.secret), "secret encrypted at rest");
  assert.equal((await owner.s.send("POST", "/api/auth/mfa/enable", { code: "000000" })).status, 400);
  const en = await owner.s.json<{ recoveryCodes: string[] }>("POST", "/api/auth/mfa/enable", { code: await code(setupR.secret) });
  assert.equal(en.recoveryCodes.length, 10);
  assert.equal((await other.s.get("/api/me")).status, 401, "other devices signed out");
  assert.equal((await owner.s.get("/api/app/admin/overview")).status, 200, "this device stays signed in");
  ids.secret = setupR.secret;
  ids.recovery = JSON.stringify(en.recoveryCodes);
  const audit = await (await wm.db()).prepare("SELECT action FROM audit_log WHERE action LIKE 'mfa.%'").all<{ action: string }>();
  assert.ok(audit.results.some((a) => a.action === "mfa.enabled") && audit.results.some((a) => a.action === "mfa.enable_failed"), "security events recorded");
});

test("admin MFA: the email link alone gives no access; the code is checked on the server; codes cannot be replayed", async () => {
  await resetLimits(wm);
  const login = await linkVerify(wm, "owner@example.com");
  assert.equal(((await login.r.json()) as { mfaRequired: boolean }).mfaRequired, true);
  for (const p of ["/api/app/admin/overview", "/api/app/admin/users", "/api/app/admin/payments", "/api/auth/mfa/status"]) {
    const r = await login.s.get(p);
    assert.equal(r.status, 403, p);
    assert.equal(((await r.json()) as { error: string }).error, "mfa_required");
  }
  const me = await login.s.json<{ mfa: { pending: boolean } }>("GET", "/api/me");
  assert.equal(me.mfa.pending, true);
  assert.equal((await login.s.send("POST", "/api/auth/mfa/verify", { code: "123456" })).status, 400);
  // The current step counts as spent (as if its code was just used); the next step's code works.
  const ownerId = (await (await wm.db()).prepare("SELECT user_id FROM mfa_factors WHERE status = 'active' LIMIT 1").first<{ user_id: string }>())!.user_id;
  await (await wm.db()).prepare("UPDATE mfa_factors SET last_step = ?2 WHERE user_id = ?1").bind(ownerId, stepOf(Date.now())).run();
  const spent = await code(ids.secret);
  assert.equal((await login.s.send("POST", "/api/auth/mfa/verify", { code: spent })).status, 400, "replay refused");
  const next = await code(ids.secret, 1);
  const ok = await login.s.send("POST", "/api/auth/mfa/verify", { code: next });
  assert.equal(ok.status, 200);
  const fresh = session(wm, ok.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "));
  assert.notEqual(fresh.cookie, login.cookie, "new token after the second factor");
  assert.equal((await login.s.get("/api/me")).status, 401, "the pending token is gone");
  assert.equal((await fresh.get("/api/app/admin/overview")).status, 200);
  // Same code again on a new sign-in: refused.
  await resetLimits(wm);
  const again = await linkVerify(wm, "owner@example.com");
  assert.equal((await again.s.send("POST", "/api/auth/mfa/verify", { code: next })).status, 400);
});

test("admin MFA: recovery codes work once; brute force is rate limited; a pending session lapses after 10 minutes", async () => {
  await resetLimits(wm);
  const codes = JSON.parse(ids.recovery) as string[];
  const a = await linkVerify(wm, "owner@example.com");
  assert.equal((await a.s.send("POST", "/api/auth/mfa/verify", { recoveryCode: codes[0].toLowerCase() })).status, 200, "recovery code accepted (any case)");
  const b = await linkVerify(wm, "owner@example.com");
  assert.equal((await b.s.send("POST", "/api/auth/mfa/verify", { recoveryCode: codes[0] })).status, 400, "the same recovery code is refused");
  await resetLimits(wm);
  const c = await linkVerify(wm, "owner@example.com");
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) statuses.push((await c.s.send("POST", "/api/auth/mfa/verify", { code: String(100000 + i) })).status);
  assert.deepEqual(statuses.slice(0, 5), [400, 400, 400, 400, 400]);
  assert.equal(statuses[5], 429, "6th attempt in 10 minutes is refused");
  await resetLimits(wm);
  const d = await linkVerify(wm, "owner@example.com");
  await setSession(wm, d.s, { created_at: ago(11 * 60) });
  const r = await d.s.send("POST", "/api/auth/mfa/verify", { code: await code(ids.secret, 1) });
  assert.equal(r.status, 401, "pending session expired");
});

test("admin MFA: turning off needs a current code; a Super Administrator can reset another admin, never themselves", async () => {
  await resetLimits(wm);
  const owner = await linkVerify(wm, "owner@example.com");
  const v = await owner.s.send("POST", "/api/auth/mfa/verify", { recoveryCode: (JSON.parse(ids.recovery) as string[])[1] });
  const s = session(wm, v.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "));
  assert.equal((await s.send("POST", "/api/auth/mfa/disable", { code: "000000" })).status, 400);
  assert.equal((await s.send("POST", "/api/app/admin/users/" + (await s.json<{ user: { id: string } }>("GET", "/api/me")).user.id + "/mfa-reset")).status >= 400, true, "no self reset");
  await s.json("POST", "/api/app/owner/bootstrap"); // Stage 2B: the owner's one-time set-up before appointing administrators
  // A second administrator with MFA, reset by the owner.
  const id2 = (await s.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "admin2@example.com", role: "admin", fullName: "Second Admin", sendInvite: false, adminRole: "finance" })).user.id;
  const a2 = await linkVerify(wm, "admin2@example.com");
  const sec2 = (await a2.s.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  await a2.s.json("POST", "/api/auth/mfa/enable", { code: await code(sec2) });
  assert.equal((await a2.s.send("POST", `/api/app/admin/users/${id2}/mfa-reset`)).status, 403, "finance cannot reset anyone");
  assert.equal((await s.send("POST", `/api/app/admin/users/${id2}/mfa-reset`)).status, 200);
  assert.equal((await a2.s.get("/api/me")).status, 401, "reset signs the person out everywhere");
  const after = await linkVerify(wm, "admin2@example.com");
  assert.equal(((await after.r.json()) as { mfaRequired: boolean }).mfaRequired, false);
  // Turning off with a correct code. (Earlier tests spent the current 30-second steps; moving the stored step back
  // simulates a minute passing.)
  await resetLimits(wm);
  const ownerId = (await s.json<{ user: { id: string } }>("GET", "/api/me")).user.id;
  await (await wm.db()).prepare("UPDATE mfa_factors SET last_step = ?2 WHERE user_id = ?1").bind(ownerId, stepOf(Date.now()) - 2).run();
  assert.equal((await s.send("POST", "/api/auth/mfa/disable", { code: await code(ids.secret) })).status, 200);
  assert.equal((await (await wm.db()).prepare("SELECT COUNT(*) n FROM mfa_recovery_codes WHERE user_id = ?1").bind(ownerId).first<{ n: number }>())!.n, 0, "recovery codes removed too");
});

test("admin MFA: the requirement switch blocks administration until set up, without locking the admin out", async () => {
  const x = await startWorker({ env: { ...SECRETS, MFA_ENCRYPTION_KEY: MFA_KEY, MFA_ENFORCE_ADMINS: "true" } });
  try {
    const o = await linkVerify(x, "owner@example.com");
    const r = await o.s.get("/api/app/admin/overview");
    assert.equal(r.status, 403);
    assert.equal(((await r.json()) as { error: string }).error, "mfa_setup_required");
    assert.equal((await o.s.get("/api/me")).status, 200);
    const sec = (await o.s.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
    await o.s.json("POST", "/api/auth/mfa/enable", { code: await code(sec) });
    assert.equal((await o.s.get("/api/app/admin/overview")).status, 200, "setting it up unlocks administration on this device");
  } finally { await x.dispose(); }
});

test("admin MFA without MFA_ENCRYPTION_KEY: setup is refused (no plain-text secrets) and sign-in is unaffected", async () => {
  const r = await admin.send("POST", "/api/auth/mfa/setup");
  assert.equal(r.status, 503);
  assert.equal((await admin.get("/api/app/admin/overview")).status, 200);
});

// ---------------------------------------------------------------- permissions and isolation ----
async function bundle() {
  const r = await build({ stdin: { contents: `import "./src/server/lms/index"; export { routeList } from "./src/server/lms/api"; export { permissionTable, adminMay } from "./src/server/lms/permissions"; export { runRetention } from "./src/server/lms/retention";`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, format: "esm", platform: "neutral", mainFields: ["module", "main"], write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}`);
}

test("permissions: every route an administrator can call has a permission entry (default deny is complete)", async () => {
  const m = await bundle();
  const table = new Set((m.permissionTable() as { method: string; path: string }[]).map((p) => `${p.method} ${p.path}`));
  const adminRoutes = (m.routeList() as { method: string; path: string; roles: string[] | "public" }[]).filter((r) => r.roles !== "public" && r.roles.includes("admin"));
  const missing = adminRoutes.filter((r) => !table.has(`${r.method} ${r.path}`)).map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(missing, []);
  assert.equal(m.adminMay("finance", "GET", "/api/app/admin/not-listed"), false, "unknown routes are denied");
  assert.equal(m.adminMay("hacker", "GET", "/api/app/admin/payments"), false, "unknown groups are denied");
  assert.equal(m.adminMay(null, "GET", "/api/app/admin/payments"), true, "unassigned administrators keep full access");
});

test("permissions: a limited administrator is refused restricted functions by the server", async () => {
  // Administrator management needs an owner session that passed the authenticator code (Stage 2C), so this test runs on a
  // worker with two-step sign-in configured.
  const x = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: "owner@example.com", MFA_ENCRYPTION_KEY: MFA_KEY } });
  try {
    const st = await setup(x);
    const stu = await st.make("student", "perm-s@example.com", "Perm Student");
    const own = st.admin;
    const osec = (await own.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
    await own.json("POST", "/api/auth/mfa/enable", { code: await code(osec) });
    await own.json("POST", "/api/app/owner/bootstrap");
    const fin = (await own.json<{ user: { id: string; adminRole: string } }>("POST", "/api/app/admin/users", { email: "fin@example.com", role: "admin", fullName: "Finance Admin", sendInvite: false, adminRole: "finance" })).user;
    assert.equal(fin.adminRole, "finance");
    await resetLimits(x);
    const f = await signIn(x, "fin@example.com");
    assert.equal((await f.get("/api/app/admin/payments")).status, 200);
    assert.equal((await f.get("/api/app/admin/orders")).status, 200);
    for (const [m, p, b] of [["GET", "/api/app/admin/recruitment"], ["GET", "/api/app/admin/audit"], ["POST", "/api/app/admin/admit", {}], ["PATCH", `/api/app/admin/users/${stu}`, { status: "suspended" }],
      ["GET", `/api/app/students/${stu}/grades`], ["POST", "/api/app/admin/users", { email: "x@example.com", role: "admin", fullName: "X" }]] as [string, string, unknown?][]) {
      const r = await f.send(m, p, b);
      assert.equal(r.status, 403, `${m} ${p}`);
    }
    // A new administrator without a group gets read-only reporting, not full access.
    const rep = (await own.json<{ user: { id: string; adminRole: string } }>("POST", "/api/app/admin/users", { email: "rep@example.com", role: "admin", fullName: "Reporter", sendInvite: false })).user;
    assert.equal(rep.adminRole, "reporting");
    await resetLimits(x);
    const r = await signIn(x, "rep@example.com");
    assert.equal((await r.get("/api/app/admin/overview")).status, 200);
    assert.equal((await r.send("PATCH", `/api/app/admin/admissions/webdev`, { state: "closed" })).status, 403, "reporting is read-only");
    // Only the owner or a Super Administrator can change groups; nobody can raise their own.
    assert.equal((await f.send("PATCH", `/api/app/admin/users/${fin.id}`, { adminRole: "super" })).status, 403);
    // A group change signs the person out at once.
    await own.json("PATCH", `/api/app/admin/users/${fin.id}`, { adminRole: "academic" });
    assert.equal((await f.get("/api/me")).status, 401);
    // The owner keeps full access.
    assert.equal((await own.get("/api/app/admin/audit")).status, 200);
  } finally { await x.dispose(); }
});

test("isolation: students cannot reach another student's profile, work, grades or messages", async () => {
  const a = await signIn(w, "sec-a@example.com");
  const insB = await signIn(w, "sec-ib@example.com");
  const asg = await insB.json<{ assignment: { id: string } }>("POST", "/api/app/instructor/assignments", { studentId: ids.stuB, title: "B only", dueAt: new Date(Date.now() + 86400_000).toISOString() });
  const checks: [string, string][] = [
    ["GET", `/api/app/admin/users/${ids.stuB}`],
    ["GET", `/api/app/students/${ids.stuB}/progress`],
    ["GET", `/api/app/students/${ids.stuB}/grades`],
    ["GET", `/api/app/files/submission/${asg.assignment.id}`],
    ["GET", `/api/app/messages/${ids.stuB}`],
    ["GET", `/api/app/weekly/${ids.enB}`],
  ];
  for (const [m, p] of checks) { const r = await a.send(m, p); assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`); }
  const mine = await a.json<{ assignments: { id: string }[] }>("GET", "/api/app/student/assignments");
  assert.ok(!mine.assignments.some((x) => x.id === asg.assignment.id), "lists hold only the student's own work");
  assert.equal((await a.send("POST", `/api/app/student/assignments/${asg.assignment.id}/submission`, { text: "mine now" })).status === 200, false, "cannot submit someone else's assignment");
});

test("isolation: instructors cannot reach unassigned students or another instructor's classes", async () => {
  const ia = await signIn(w, "sec-ia@example.com");
  const db = await w.db();
  const t = ago(-86400);
  await db.prepare("INSERT INTO class_sessions (id, enrolment_id, student_id, instructor_id, starts_at, ends_at, status, created_at) VALUES ('sec-s1', ?1, ?2, ?3, ?4, ?4, 'scheduled', ?4)").bind(ids.enB, ids.stuB, ids.insB, t).run();
  for (const p of [`/api/app/instructor/students/${ids.stuB}`, `/api/app/students/${ids.stuB}/progress`, "/api/app/sessions/sec-s1", `/api/app/weekly/${ids.enB}`]) {
    const r = await ia.get(p); assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`);
  }
  assert.ok([403, 404].includes((await ia.send("POST", "/api/app/instructor/sessions/sec-s1/outcome", { status: "completed" })).status));
  assert.equal((await ia.send("POST", `/api/app/instructor/weekly/${ids.enB}/tasks`, { title: "x" })).status, 404);
});

test("isolation: role and registration number cannot be changed through the API; suspended accounts lose old sessions", async () => {
  const a = await signIn(w, "sec-a@example.com");
  const before = await a.json<{ user: { role: string; studentNo: string } }>("GET", "/api/me");
  await a.send("PATCH", "/api/me", { role: "admin", studentNo: "SMA/26/999999", student_no: "X", admin_role: "super", adminRole: "super", status: "active" });
  const after = await a.json<{ user: { role: string; studentNo: string } }>("GET", "/api/me");
  assert.deepEqual([after.user.role, after.user.studentNo], [before.user.role, before.user.studentNo]);
  assert.equal((await a.get("/api/app/admin/overview")).status, 403);
  // Suspension ends existing sessions at once.
  const b = await signIn(w, "sec-b@example.com");
  await admin.json("PATCH", `/api/app/admin/users/${ids.stuB}`, { status: "suspended" });
  assert.equal((await b.get("/api/me")).status, 401);
  await admin.json("PATCH", `/api/app/admin/users/${ids.stuB}`, { status: "active" });
  // Identifiers in the URL are validated: path tricks never reach a handler.
  for (const p of [`/api/app/students/..%2F..%2Fadmin/progress`, `/api/app/students/${"x".repeat(80)}/grades`]) assert.equal((await a.get(p)).status, 404);
});

// ---------------------------------------------------------------- uploads ----
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
function zip(names: string[]): Uint8Array {
  // A minimal archive: local headers are not needed by the checker; central directory entries carry the names.
  const parts: number[] = [0x50, 0x4b, 0x03, 0x04, ...new Array(26).fill(0)];
  for (const n of names) {
    const b = [...new TextEncoder().encode(n)];
    const h = new Array(46).fill(0); h[0] = 0x50; h[1] = 0x4b; h[2] = 0x01; h[3] = 0x02; h[28] = b.length & 255; h[29] = b.length >> 8;
    parts.push(...h, ...b);
  }
  return new Uint8Array(parts);
}
const put = (s: Session, path: string, name: string, body: Uint8Array, type = "application/octet-stream") =>
  w.fetchApi(`${path}?name=${encodeURIComponent(name)}`, { method: "PUT", headers: { cookie: s.cookie, origin: "https://skillmountainacademy.com", "content-type": type, "content-length": String(body.byteLength) }, body });

test("uploads: content must match the format; programs, disguised files and unsafe names are refused", async () => {
  const insA = await signIn(w, "sec-ia@example.com");
  const a = await signIn(w, "sec-a@example.com");
  const asg = (await insA.json<{ assignment: { id: string } }>("POST", "/api/app/instructor/assignments", { studentId: ids.stuA, title: "Upload", dueAt: new Date(Date.now() + 86400_000).toISOString() })).assignment.id;
  const path = `/api/app/student/assignments/${asg}/submission/file`;
  const cases: [string, Uint8Array, number][] = [
    ["report.pdf", PDF, 200],
    ["report.pdf", PNG, 400],                                        // wrong signature
    ["report.pdf", new TextEncoder().encode("MZ\x90\x00 this is a windows program"), 400], // executable renamed
    ["setup.exe", new TextEncoder().encode("MZ"), 400],              // disallowed format
    ["cv.exe.pdf", PDF, 400],                                        // double extension
    ["../../etc/passwd.pdf", PDF, 400],                              // path trick
    ["notes.txt", new TextEncoder().encode("<html><script>alert(1)</script>"), 400],
    ["work.zip", zip(["index.html.txt", "run.exe"]), 400],           // archive carrying a program
    ["essay.docx", zip(["readme.txt"]), 400],                        // not a real Word file
    ["essay.docx", zip(["[Content_Types].xml", "word/document.xml"]), 200],
    ["notes.txt", new TextEncoder().encode("Plain notes\nline 2"), 200],
  ];
  for (const [name, body, want] of cases) assert.equal((await put(a, path, name, body)).status, want, name);
  const row = await (await w.db()).prepare("SELECT file_key, file_name FROM submissions WHERE assignment_id = ?1").bind(asg).first<{ file_key: string; file_name: string }>();
  assert.ok(row && !row.file_key.includes("notes") && /^[\w/-]+$/.test(row.file_key), "storage key is generated, never the uploaded name");
  assert.equal(row!.file_name, "notes.txt");
  // Downloads: owner and instructor only; served as an attachment with nosniff and a sandbox.
  const d = await a.get(`/api/app/files/submission/${asg}`);
  assert.equal(d.status, 200);
  assert.match(d.headers.get("content-disposition") ?? "", /^attachment/);
  assert.equal(d.headers.get("x-content-type-options"), "nosniff");
  assert.match(d.headers.get("content-security-policy") ?? "", /sandbox/);
  const b = await signIn(w, "sec-b@example.com");
  assert.equal((await b.get(`/api/app/files/submission/${asg}`)).status, 404);
  assert.equal((await w.fetchApi(`/api/app/files/submission/${asg}`)).status, 401);
});

test("uploads: size limits and per-user upload rate", async () => {
  assert.equal((checkUpload("big.pdf", 25 * 1024 * 1024 + 1, DOC_TYPES, 25) as { status: number }).status, 413);
  assert.equal(unsafeName("a\u0000b.pdf") !== null, true);
  assert.equal(checkContent("pdf", new Uint8Array()).ok, false, "empty file refused");
  const a = await signIn(w, "sec-a@example.com");
  await (await w.db()).prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 30) ON CONFLICT(key) DO UPDATE SET count = 30, window_start = ?2")
    .bind(`upload:${ids.stuA}`, Math.floor(Date.now() / 1000 / 3600) * 3600).run();
  assert.equal((await put(a, "/api/me/photo", "me.png", PNG, "image/png")).status, 429);
});

// ---------------------------------------------------------------- privacy, rate limits, retention ----
test("IP pseudonyms: keyed HMAC with IP_HASH_SALT; never the old predictable salt", async () => {
  await linkVerify(wm, "owner@example.com");
  const row = await (await wm.db()).prepare("SELECT ip_hash FROM audit_log WHERE ip_hash IS NOT NULL ORDER BY at DESC LIMIT 1").first<{ ip_hash: string }>();
  const ip = `10.77.${Math.floor((ipN - 1) / 200)}.${((ipN - 1) % 200) + 1}`;
  assert.equal(row!.ip_hash, createHmac("sha256", IP_SALT).update(`ip|${ip}`).digest("hex"));
  // Default worker (no secret): a random key from KV, not sha256(ip|"sma") or the hold key.
  const r2 = await (await w.db()).prepare("SELECT ip_hash FROM audit_log WHERE ip_hash IS NOT NULL ORDER BY at DESC LIMIT 20").all<{ ip_hash: string }>();
  for (const x of r2.results) {
    for (const guess of ["sma", SECRETS.HOLD_SIGNING_KEY]) for (let i = 1; i < 255; i++) {
      assert.notEqual(x.ip_hash, createHash("sha256").update(`10.9.0.${i}|${guess}`).digest("hex"));
    }
  }
});

test("secrets are never exposed by the API or the website build", async () => {
  const s = await (await admin.get("/api/app/admin/settings/retention")).text();
  for (const v of [SECRETS.HOLD_SIGNING_KEY, SECRETS.PAYSTACK_SECRET_KEY, SECRETS.RESEND_API_KEY, SECRETS.TURNSTILE_SECRET]) assert.ok(!s.includes(v));
  const me = await (await admin.get("/api/me")).text();
  assert.ok(!/secret|token_hash|sk_test/i.test(me));
  if (existsSync("out/_next/static")) {
    const js = readFileSync("out/_headers", "utf8");
    assert.ok(!/MFA_ENCRYPTION_KEY|IP_HASH_SALT|sk_live|sk_test/.test(js));
  }
});

test("rate limits hold under concurrent requests (atomic counter)", async () => {
  const email = "sec-a@example.com";
  await resetLimits(w);
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => w.post("/api/auth/request", { email, turnstileToken: "good-token" }, { "cf-connecting-ip": `10.55.0.${i + 1}` })));
  const okN = rs.filter((r) => r.status === 200).length;
  assert.equal(okN, 4, "exactly the 4 allowed per email in 10 minutes");
  assert.equal(rs.filter((r) => r.status === 429).length, 6);
});

test("retention: only allow-listed, old, enabled records are deleted, in batches, and the run is audited", async () => {
  const m = await bundle();
  const db = await w.db();
  const old = ago(400 * 86400);
  await db.batch([
    db.prepare("INSERT INTO error_log (id, at, route, message) VALUES ('old-e', ?1, 'x', 'old')").bind(old),
    db.prepare("INSERT INTO error_log (id, at, route, message) VALUES ('new-e', ?1, 'x', 'new')").bind(ago(60)),
    db.prepare("INSERT INTO ai_messages (id, student_id, role, content, created_at) VALUES ('old-ai', ?1, 'user', 'q', ?2)").bind(ids.stuA, old),
  ]);
  const protectedBefore = await db.prepare("SELECT (SELECT COUNT(*) FROM enrolments) e, (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM orders) o, (SELECT COUNT(*) FROM audit_log) a, (SELECT COUNT(*) FROM messages) m").first();
  // Defaults: new categories are OFF, so nothing new is deleted.
  await m.runRetention(db, new Date());
  assert.ok(await db.prepare("SELECT 1 FROM error_log WHERE id = 'old-e'").first(), "error log kept while the category is off");
  // Owner turns on error-log retention (90 days) through the API.
  await admin.json("PUT", "/api/app/admin/settings/retention", { error_log: { on: true, days: 90 } });
  assert.equal((await admin.send("PUT", "/api/app/admin/settings/retention", { payments: { on: true, days: 1 } })).status, 400, "financial tables cannot be added");
  const done = await m.runRetention(db, new Date());
  assert.equal(done.error_log, 1);
  assert.equal(await db.prepare("SELECT 1 FROM error_log WHERE id = 'old-e'").first(), null);
  assert.ok(await db.prepare("SELECT 1 FROM error_log WHERE id = 'new-e'").first(), "recent rows kept");
  assert.ok(await db.prepare("SELECT 1 FROM ai_messages WHERE id = 'old-ai'").first(), "AI conversations untouched (off)");
  const protectedAfter = await db.prepare("SELECT (SELECT COUNT(*) FROM enrolments) e, (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM orders) o, (SELECT COUNT(*) FROM messages) m").first();
  assert.deepEqual({ ...protectedAfter }, { e: protectedBefore!.e, u: protectedBefore!.u, o: protectedBefore!.o, m: protectedBefore!.m });
  assert.ok(await db.prepare("SELECT 1 FROM audit_log WHERE action = 'retention.purge'").first(), "the run is audited");
  // Batch limit: 3 eligible rows, batch of 2.
  for (let i = 0; i < 3; i++) await db.prepare("INSERT INTO error_log (id, at, route, message) VALUES (?1, ?2, 'x', 'old')").bind(`b${i}`, old).run();
  assert.equal((await m.runRetention(db, new Date(), 2)).error_log, 2);
  assert.equal((await m.runRetention(db, new Date(), 2)).error_log, 1);
  assert.deepEqual(await m.runRetention(db, new Date(), 2), {}, "idempotent: nothing left to delete");
  // The settings are refused for administrators outside the Security area.
  const repId = (await admin.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "rep@example.com", role: "student", fullName: "Reporter", sendInvite: false })).user.id;
  await db.prepare("UPDATE users SET role = 'admin', admin_role = 'reporting' WHERE id = ?1").bind(repId).run(); // a Reporting administrator
  await resetLimits(w);
  const rep = await signIn(w, "rep@example.com");
  assert.equal((await rep.get("/api/app/admin/settings/retention")).status, 403);
});

// ---------------------------------------------------------------- CSP ----
test("CSP: generated per page from the real build; inline scripts allowed only by hash; no unsafe-eval", () => {
  if (!existsSync("out/index.html")) return; // the build runs before packaging; this test needs it
  const rules = buildRules("out");
  assert.ok(rules.length >= 25);
  const home = rules.find((r) => r.route === "/")!;
  const html = readFileSync("out/index.html", "utf8");
  for (const h of inlineScriptHashes(html)) assert.ok(home.policy.includes(h));
  for (const r of rules) {
    const script = r.policy.split("; ").find((d) => d.startsWith("script-src "))!;
    assert.doesNotMatch(script, /unsafe-inline|unsafe-eval|\*/, r.route);
    assert.match(r.policy, /frame-ancestors 'none'/);
    assert.match(r.policy, /object-src 'none'/);
    assert.match(script, /https:\/\/challenges\.cloudflare\.com/, "Turnstile allowed");
  }
  assert.doesNotMatch(policyFor("/about/", []), /paystack/, "Paystack only on payment pages");
  assert.match(policyFor("/checkout/", []), /js\.paystack\.co/);
  assert.match(readFileSync("out/_headers", "utf8"), /Content-Security-Policy(-Report-Only)?: default-src 'self'/);
});

test("CSP reports: stored without full URLs, rate limited, never echoed", async () => {
  const body = JSON.stringify({ "csp-report": { "document-uri": "https://skillmountainacademy.com/about/?email=x@y.z", "blocked-uri": "https://evil.example.com/a.js?token=abc", "effective-directive": "script-src-elem" } });
  const r = await w.fetchApi("/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report" }, body });
  assert.equal(r.status, 204);
  const row = await (await w.db()).prepare("SELECT message FROM error_log WHERE route = 'csp' ORDER BY at DESC").first<{ message: string }>();
  assert.equal(row!.message, "script-src-elem blocked https://evil.example.com on /about/");
});
