// Stage 2C regression tests: owner identity binding, owner MFA for every sensitive operation, atomic bootstrap, legacy
// (unassigned) administrators, permanent removal with record preservation and reassignment, and audit integrity.
// Real requests to the real Worker (Miniflare). boss@example.com is the configured owner; owner@example.com (in the
// harness ADMIN_EMAILS) is an existing, unassigned, NON-owner ("legacy") administrator.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { startWorker, SECRETS } from "./worker-harness.ts";
import { signIn as helperSignIn, session, approve, type Session, eligible } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";

type W = Awaited<ReturnType<typeof startWorker>>;
const OWNER = "boss@example.com";
const MFA_KEY = Buffer.alloc(32, 7).toString("base64");
const BREAK_GLASS = "stage2c-break-glass-token-0123456789abcdefghij";
let w: W;
let legacy: Session, ownerEmailOnly: Session, owner: Session;
const ids: Record<string, string> = {};

const resetLimits = async (x: W) => { await (await x.db()).prepare("DELETE FROM rate_limits").run(); };
const signIn = async (x: W, email: string) => { await resetLimits(x); return helperSignIn(x, email); };
const code = async (secret: string) => totpAt(secret, stepOf(Date.now()));
// A session that passed the authenticator code: email link, enrol (first time), session marked verified.
async function strong(x: W, email: string) {
  const s = await signIn(x, email);
  const secret = (await s.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  await s.json("POST", "/api/auth/mfa/enable", { code: await code(secret) });
  return { s, secret };
}
// Email-link sign-in that returns the raw verify response (to see the pending-MFA state).
async function emailLink(x: W, email: string, ip = "10.77.1.1") {
  await resetLimits(x);
  const before = x.calls.length;
  await x.post("/api/auth/request", { email, turnstileToken: "good-token" }, { "cf-connecting-ip": ip });
  const isLink = (m: { url: string; body: string }) => m.url.includes("api.resend.com") && m.body.includes(email) && m.body.includes("/app/confirm/?t=");
  assert.ok(await x.waitFor((c) => c.slice(before).some(isLink)), `link to ${email}`);
  const token = JSON.parse(x.calls.slice(before).filter(isLink).at(-1)!.body).html.match(/\/app\/confirm\/\?t=([\w-]+)/)[1] as string;
  return token;
}
async function verify(x: W, token: string, ip = "10.77.1.1") {
  const r = await x.post("/api/auth/verify", { token }, { "cf-connecting-ip": ip });
  return { r, s: session(x, r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), ip) };
}
const errOf = async (r: Response) => ((await r.json()) as { error: string }).error;
const audited = async (action: string, target?: string) =>
  !!(await (await w.db()).prepare("SELECT 1 FROM audit_log WHERE action = ?1 AND (?2 IS NULL OR target_id = ?2)").bind(action, target ?? null).first());
const groupOf = async (id: string) => (await (await w.db()).prepare("SELECT admin_role FROM users WHERE id = ?1").bind(id).first<{ admin_role: string | null }>())!.admin_role;
const idOf = async (s: Session) => (await s.json<{ user: { id: string } }>("GET", "/api/me")).user.id;

async function bundle(entry: string) {
  const r = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, format: "esm", platform: "neutral", mainFields: ["module", "main"], write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}`);
}

before(async () => {
  w = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: MFA_KEY, OWNER_RECOVERY_TOKEN: BREAK_GLASS } });
  legacy = await signIn(w, "owner@example.com");
  ids.legacy = await idOf(legacy);
  ownerEmailOnly = await signIn(w, OWNER); // the real owner, but only an email link so far
  ids.owner = await idOf(ownerEmailOnly);
});
after(async () => { await w.dispose(); });

// ------------------------------------------------------------------ 1. owner authentication ----
test("an email link alone opens nothing sensitive: owner console, bootstrap and audit search need the authenticator code (fail closed)", async () => {
  const st = await ownerEmailOnly.json<{ isOwner: boolean; state: string; strongSession: boolean }>("GET", "/api/app/owner/status");
  assert.deepEqual([st.isOwner, st.state, st.strongSession], [true, "pending", false]);
  for (const [m, p, b] of [["POST", "/api/app/owner/bootstrap"], ["GET", "/api/app/owner/staff"], ["GET", "/api/app/owner/audit"], ["GET", "/api/app/owner/legacy-admins"],
    ["PUT", "/api/app/owner/policy", { restrictUnassigned: true }], ["GET", "/api/app/owner/removal-requests"], ["POST", `/api/app/owner/users/${ids.legacy}/remove`, { reason: "x" }]] as [string, string, unknown?][]) {
    const r = await ownerEmailOnly.send(m, p, b);
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(await errOf(r), "owner_mfa_required", `${m} ${p}`);
  }
  assert.ok(await audited("owner.mfa_refused"), "refusals recorded");
  // Administrator management through the ordinary Users routes is refused too.
  const c = await ownerEmailOnly.send("POST", "/api/app/admin/users", { email: "x1@example.com", role: "admin", fullName: "X One", sendInvite: false });
  assert.equal(c.status, 403);
  assert.equal(await errOf(c), "mfa_step_required");
  assert.ok(await audited("admin.mfa_step_refused"));
  // Day-to-day work is unaffected.
  assert.equal((await ownerEmailOnly.send("POST", "/api/app/admin/users", { email: "day@example.com", role: "student", fullName: "Day Student", sendInvite: false })).status, 201);
});

test("a session still waiting for the authenticator code reaches no owner or administration route", async () => {
  const o = await strong(w, OWNER);
  owner = o.s;
  ids.ownerSecret = o.secret;
  const pending = await verify(w, await emailLink(w, OWNER));
  assert.equal(((await pending.r.json()) as { mfaRequired: boolean }).mfaRequired, true);
  for (const p of ["/api/app/owner/staff", "/api/app/owner/audit", "/api/app/admin/overview", "/api/app/owner/status"]) {
    const r = await pending.s.get(p);
    assert.equal(r.status, 403, p);
    assert.equal(await errOf(r), "mfa_required", p);
  }
  assert.equal(await errOf(await pending.s.send("POST", "/api/app/owner/bootstrap")), "mfa_required");
});

test("bootstrap: owner only, MFA-verified, atomic (two simultaneous attempts: exactly one succeeds), audited with the owner's identity", async () => {
  assert.equal((await legacy.send("POST", "/api/app/owner/bootstrap")).status, 403, "a non-owner administrator cannot bootstrap");
  const rs = await Promise.all([owner.send("POST", "/api/app/owner/bootstrap"), owner.send("POST", "/api/app/owner/bootstrap")]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  const db = await w.db();
  const rec = await db.prepare("SELECT user_id, email FROM owner_record").all<{ user_id: string; email: string }>();
  assert.deepEqual(rec.results, [{ user_id: ids.owner, email: OWNER }]);
  const a = await db.prepare("SELECT actor_id, target_id, detail FROM audit_log WHERE action = 'owner.bootstrap'").all<{ actor_id: string; target_id: string; detail: string }>();
  assert.equal(a.results.length, 1);
  assert.deepEqual([a.results[0].actor_id, a.results[0].target_id, JSON.parse(a.results[0].detail).email], [ids.owner, ids.owner, OWNER]);
  assert.equal(await groupOf(ids.owner), "super");
  assert.equal((await owner.send("POST", "/api/app/owner/bootstrap")).status, 409, "cannot be repeated");
  const st = await owner.json<{ state: string; bootstrapped: boolean }>("GET", "/api/app/owner/status");
  assert.deepEqual([st.state, st.bootstrapped], ["bootstrapped", true]);
});

test("the owner record cannot be changed or deleted, and changing OWNER_EMAIL creates no replacement owner", async () => {
  const db = await w.db();
  await assert.rejects(db.prepare("UPDATE owner_record SET user_id = ?1").bind(ids.legacy).run(), /fixed after bootstrap/);
  await assert.rejects(db.prepare("DELETE FROM owner_record").run(), /fixed after bootstrap/);
  const m = await bundle(`export { resolveOwner } from "./src/server/lms/data/owner";`);
  const same = await m.resolveOwner(db, { OWNER_EMAIL: OWNER });
  assert.deepEqual([same.state, same.ownerId], ["bootstrapped", ids.owner]);
  // OWNER_EMAIL repointed at another active administrator: nobody is the owner.
  const moved = await m.resolveOwner(db, { OWNER_EMAIL: "owner@example.com" });
  assert.deepEqual([moved.state, moved.ownerId], ["mismatch", null]);
  const gone = await m.resolveOwner(db, {});
  assert.deepEqual([gone.state, gone.ownerId], ["unconfigured", null]);
});

test("a lost bootstrap record is detected from the audit log: nobody becomes owner and bootstrap stays closed", async () => {
  const x = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: MFA_KEY } });
  try {
    const o = (await strong(x, OWNER)).s;
    // Simulates a database where owner_record was removed out of band after a bootstrap had happened.
    await (await x.db()).prepare("INSERT INTO audit_log (id, at, actor_id, action, target_type, target_id) VALUES ('old-boot', ?1, 'someone', 'owner.bootstrap', 'user', 'someone')").bind(new Date().toISOString()).run();
    const st = await o.json<{ state: string; isOwner: boolean }>("GET", "/api/app/owner/status");
    assert.deepEqual([st.state, st.isOwner], ["record_missing", false]);
    assert.equal((await o.send("POST", "/api/app/owner/bootstrap")).status, 403, "not the owner, so not even reachable");
    assert.equal((await o.send("POST", "/api/app/admin/users", { email: "z@example.com", role: "admin", fullName: "Z", adminRole: "super", sendInvite: false })).status, 403);
  } finally { await x.dispose(); }
});

test("the owner cannot accidentally suspend, regroup, reset or remove their own account; nobody else can either", async () => {
  assert.equal((await owner.send("PATCH", `/api/app/admin/users/${ids.owner}`, { status: "suspended", reason: "Stage E test" })).status, 400);
  assert.equal((await owner.send("PATCH", `/api/app/admin/users/${ids.owner}`, { role: "student", reason: "Stage E test" })).status, 400);
  assert.equal((await owner.send("PATCH", `/api/app/admin/users/${ids.owner}`, { adminRole: "reporting", reason: "Stage E test" })).status, 403);
  assert.equal((await owner.send("POST", `/api/app/admin/users/${ids.owner}/mfa-reset`)).status, 400);
  assert.equal((await owner.send("POST", `/api/app/owner/users/${ids.owner}/remove`, { reason: "oops" })).status, 403);
  assert.equal(await groupOf(ids.owner), "super");
  const u = await (await w.db()).prepare("SELECT status, removed_at FROM users WHERE id = ?1").bind(ids.owner).first<{ status: string; removed_at: string | null }>();
  assert.deepEqual({ ...u }, { status: "active", removed_at: null });
});

test("Super Administrators also need the authenticator code for group changes, MFA resets and removal requests", async () => {
  ids.sup = (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "sup@example.com", role: "admin", fullName: "Sup Admin", sendInvite: false, adminRole: "super" })).user.id;
  ids.fin = (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "fin@example.com", role: "admin", fullName: "Fin Admin", sendInvite: false, adminRole: "finance" })).user.id;
  const supEmail = await signIn(w, "sup@example.com"); // email link only, no authenticator yet
  for (const [m, p, b] of [["PATCH", `/api/app/admin/users/${ids.fin}`, { adminRole: "academic", reason: "Stage E test" }], ["POST", `/api/app/admin/users/${ids.fin}/mfa-reset`],
    ["POST", `/api/app/admin/users/${ids.fin}/removal-requests`, { reason: "x" }], ["PATCH", `/api/app/admin/users/${ids.fin}`, { status: "suspended", reason: "Stage E test" }]] as [string, string, unknown?][]) {
    const r = await supEmail.send(m, p, b);
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(await errOf(r), "mfa_step_required", `${m} ${p}`);
  }
  assert.equal(await groupOf(ids.fin), "finance", "nothing changed");
  const sup = (await strong(w, "sup@example.com")).s;
  assert.equal((await sup.send("PATCH", `/api/app/admin/users/${ids.fin}`, { adminRole: "academic", reason: "Stage E test" })).status, 200, "with the code: allowed");
  assert.equal(await groupOf(ids.fin), "academic");
  ids.supCookie = sup.cookie;
});

// ------------------------------------------------------------------ 3. legacy administrators ----
test("legacy (unassigned) administrators: day-to-day access kept; every administrator-management and owner power refused; never auto-assigned", async () => {
  assert.equal(await groupOf(ids.legacy), null, "bootstrap did not assign the legacy administrator a group");
  // Allowed (unchanged from before Stage 2B).
  for (const p of ["/api/app/admin/overview", "/api/app/admin/payments", "/api/app/admin/enrolments", "/api/app/admin/recruitment", "/api/app/admin/audit", "/api/app/admin/settings/retention"])
    assert.equal((await legacy.get(p)).status, 200, p);
  assert.equal((await legacy.send("POST", "/api/app/admin/users", { email: "legacy-made@example.com", role: "student", fullName: "Legacy Made", sendInvite: false })).status, 201);
  // Refused.
  const refused: [string, string, unknown?][] = [
    ["PATCH", `/api/app/admin/users/${ids.legacy}`, { adminRole: "super", reason: "Stage E test" }], ["PATCH", `/api/app/admin/users/${ids.legacy}`, { adminRole: "finance", reason: "Stage E test" }],
    ["PATCH", `/api/app/admin/users/${ids.fin}`, { adminRole: "reporting", reason: "Stage E test" }], ["PATCH", `/api/app/admin/users/${ids.fin}`, { status: "suspended", reason: "Stage E test" }],
    ["POST", "/api/app/admin/users", { email: "l2@example.com", role: "admin", fullName: "L Two", sendInvite: false }],
    ["POST", "/api/app/admin/users", { email: "l3@example.com", role: "admin", fullName: "L Three", sendInvite: false, adminRole: "super" }],
    ["POST", `/api/app/admin/users/${ids.fin}/mfa-reset`], ["POST", `/api/app/admin/users/${ids.fin}/removal-requests`, { reason: "x" }],
    ["PUT", "/api/app/admin/settings/retention", { audit_log: { on: true, days: 730 } }],
    ["POST", "/api/app/owner/bootstrap"], ["GET", "/api/app/owner/staff"], ["GET", "/api/app/owner/audit"], ["GET", "/api/app/owner/legacy-admins"],
    ["PUT", "/api/app/owner/policy", { restrictUnassigned: false }], ["GET", "/api/app/owner/removal-requests"], ["POST", `/api/app/owner/users/${ids.fin}/remove`, { reason: "x" }],
  ];
  for (const [m, p, b] of refused) assert.equal((await legacy.send(m, p, b)).status, 403, `${m} ${p} ${JSON.stringify(b ?? "")}`);
  assert.equal(await groupOf(ids.legacy), null);
  assert.ok(await audited("admin.group_refused", ids.legacy) && await audited("settings.retention_refused"));
});

test("owner review of legacy administrators: warning list, optional read-only restriction, explicit assignment", async () => {
  const list = await owner.json<{ admins: { id: string }[]; policy: { restrictUnassigned: boolean } }>("GET", "/api/app/owner/legacy-admins");
  assert.deepEqual(list.admins.map((a) => a.id), [ids.legacy]);
  assert.equal(list.policy.restrictUnassigned, false, "off by default");
  assert.equal((await owner.json<{ unassignedAdmins: number }>("GET", "/api/app/owner/status")).unassignedAdmins, 1);
  await owner.json("PUT", "/api/app/owner/policy", { restrictUnassigned: true });
  assert.ok(await audited("owner.policy"));
  const me = await legacy.json<{ admin: { role: string | null; applied: string } }>("GET", "/api/me");
  assert.deepEqual([me.admin.role, me.admin.applied], [null, "reporting"], "group itself unchanged; read-only applied");
  assert.equal((await legacy.get("/api/app/admin/overview")).status, 200);
  assert.equal((await legacy.send("POST", "/api/app/admin/users", { email: "blocked@example.com", role: "student", fullName: "Blocked", sendInvite: false })).status, 403, "restricted: read-only");
  assert.ok(await audited("admin.access_refused", undefined));
  // The owner assigns the group explicitly; the list empties.
  await owner.json("PATCH", `/api/app/admin/users/${ids.legacy}`, { adminRole: "admissions", reason: "Stage E test" });
  assert.equal(await groupOf(ids.legacy), "admissions");
  assert.equal((await owner.json<{ admins: unknown[] }>("GET", "/api/app/owner/legacy-admins")).admins.length, 0);
  await owner.json("PUT", "/api/app/owner/policy", { restrictUnassigned: false });
});

// ------------------------------------------------------------------ 4. permanent removal ----
test("removing an instructor revokes access only: every academic record stays, teaching is listed and reassigned, no further email", async () => {
  const db = await w.db();
  const make = async (role: string, email: string, name: string) => (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email, role, fullName: name, sendInvite: false })).user.id;
  const stu = await make("student", "rs@example.com", "Removal Student");
  const ins = await make("instructor", "ri@example.com", "Removed Instructor");
  const ins2 = await make("instructor", "ri2@example.com", "New Instructor");
  await approve(owner, ins); await approve(owner, ins2);
  await eligible(owner, ins, "webdev");
  const en = (await owner.json<{ enrolment: { id: string } }>("POST", "/api/app/admin/enrolments", { studentId: stu, programme: "webdev", instructorId: ins })).enrolment.id;
  const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  await db.batch([
    db.prepare("INSERT INTO class_sessions (id, enrolment_id, student_id, instructor_id, starts_at, ends_at, status, created_at) VALUES ('past-1', ?1, ?2, ?3, ?4, ?5, 'completed', ?4)").bind(en, stu, ins, ago(48), ago(47)),
    db.prepare("INSERT INTO class_sessions (id, enrolment_id, student_id, instructor_id, starts_at, ends_at, status, meet_url, created_at) VALUES ('future-1', ?1, ?2, ?3, ?4, ?5, 'scheduled', 'https://meet.google.com/abc-defg-hij', ?6)").bind(en, stu, ins, ago(-48), ago(-49), ago(1)),
    db.prepare("INSERT INTO assignments (id, student_id, instructor_id, enrolment_id, title, due_at, created_at) VALUES ('as-1', ?1, ?2, ?3, 'Task', ?4, ?4)").bind(stu, ins, en, ago(72)),
    db.prepare("INSERT INTO submissions (id, assignment_id, student_id, text, submitted_at, score, graded_at) VALUES ('sub-1', 'as-1', ?1, 'work', ?2, 88, ?2)").bind(stu, ago(60)),
  ]);
  const count = async () => db.prepare(`SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM enrolments) e, (SELECT COUNT(*) FROM class_sessions) c,
    (SELECT COUNT(*) FROM class_sessions WHERE status = 'completed') att, (SELECT COUNT(*) FROM assignments) a, (SELECT COUNT(*) FROM submissions) s,
    (SELECT score FROM submissions WHERE id = 'sub-1') grade, (SELECT COUNT(*) FROM orders) o, (SELECT COUNT(*) FROM messages) m`).first();
  const beforeCounts = await count();
  const auditBefore = (await db.prepare("SELECT COUNT(*) n FROM audit_log").first<{ n: number }>())!.n;
  // A sign-in link issued before the removal must stop working.
  const oldLink = await emailLink(w, "ri@example.com", "10.77.2.2");
  const insSession = await signIn(w, "ri@example.com");
  assert.equal((await owner.send("POST", `/api/app/owner/users/${ins}/remove`, {})).status, 400, "a reason is required");
  const r = await owner.json<{ accessRevoked: boolean; recordsDeleted: boolean; reassign: { enrolmentId: string; futureClasses: number }[] }>("POST", `/api/app/owner/users/${ins}/remove`, { reason: "Contract ended" });
  assert.deepEqual([r.accessRevoked, r.recordsDeleted], [true, false]);
  assert.deepEqual(r.reassign.map((x) => [x.enrolmentId, x.futureClasses]), [[en, 1]], "the owner is told what to reassign");
  assert.deepEqual(await count(), beforeCounts, "students, classes, attendance, assignments, grades, payments and messages untouched");
  assert.ok((await db.prepare("SELECT COUNT(*) n FROM audit_log").first<{ n: number }>())!.n > auditBefore);
  const row = await db.prepare("SELECT status, removed_at, removal_reason FROM users WHERE id = ?1").bind(ins).first<{ status: string; removed_at: string; removal_reason: string }>();
  assert.deepEqual([row!.status, !!row!.removed_at, row!.removal_reason], ["suspended", true, "Contract ended"]);
  const log = await db.prepare("SELECT detail FROM audit_log WHERE action = 'owner.remove' AND target_id = ?1").bind(ins).first<{ detail: string }>();
  assert.equal(JSON.parse(log!.detail).reason, "Contract ended", "the reason is in the audit trail");
  // Access revoked everywhere.
  assert.equal((await insSession.get("/api/me")).status, 401, "sessions ended");
  assert.notEqual((await verify(w, oldLink, "10.77.2.2")).r.status, 200, "older sign-in link revoked");
  assert.equal((await owner.send("PATCH", `/api/app/admin/users/${ins}`, { status: "active", reason: "Stage E test" })).status, 403, "cannot be reactivated");
  assert.equal((await owner.send("PATCH", `/api/app/admin/users/${ins}`, { role: "admin", reason: "Stage E test" })).status, 403);
  await eligible(owner, ins, "graphics");
  assert.equal((await owner.send("POST", "/api/app/admin/enrolments", { studentId: stu, programme: "graphics", instructorId: ins })).status, 400, "cannot be given new students");
  // Until reassigned, the removed instructor receives no more email (no Meet links or student details).
  const mark = w.calls.length;
  const lagosDate = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
  await owner.json("POST", "/api/app/admin/sessions/future-1/reschedule", { date: lagosDate, startTime: "10:00", reason: "Instructor change" });
  await new Promise((res) => setTimeout(res, 400));
  const mails = w.calls.slice(mark).filter((c) => c.url.includes("api.resend.com"));
  assert.ok(mails.some((m) => m.body.includes("rs@example.com")), "the student is told");
  assert.ok(!mails.some((m) => m.body.includes("ri@example.com")), "the removed instructor is not");
  // Reassignment: future classes move to the new instructor; the completed class keeps its history.
  await eligible(owner, ins2, "webdev"); // Stage C: eligibility and a reason are required for a change of instructor
  await owner.json("PATCH", `/api/app/admin/enrolments/${en}`, { instructorId: ins2, reason: "Instructor change" });
  const cls = await db.prepare("SELECT id, status, instructor_id FROM class_sessions WHERE enrolment_id = ?1 ORDER BY starts_at").bind(en).all<{ id: string; status: string; instructor_id: string }>();
  assert.equal(cls.results.find((c) => c.id === "past-1")!.instructor_id, ins, "history keeps the original instructor");
  for (const c of cls.results.filter((x) => x.status === "scheduled")) assert.equal(c.instructor_id, ins2, "future classes reassigned");
  assert.equal((await db.prepare("SELECT score FROM submissions WHERE id = 'sub-1'").first<{ score: number }>())!.score, 88);
});

test("removing an administrator revokes MFA factors and recovery codes; approved requests carry the documented reason", async () => {
  const db = await w.db();
  const sup = session(w, ids.supCookie);
  const victim = (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "gone-admin@example.com", role: "admin", fullName: "Gone Admin", sendInvite: false, adminRole: "support" })).user.id;
  await strong(w, "gone-admin@example.com");
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM mfa_recovery_codes WHERE user_id = ?1").bind(victim).first<{ n: number }>())!.n, 10);
  const req = await sup.json<{ id: string }>("POST", `/api/app/admin/users/${victim}/removal-requests`, { reason: "Role no longer needed" });
  const d = await owner.json<{ accessRevoked: boolean; recordsDeleted: boolean }>("POST", `/api/app/owner/removal-requests/${req.id}`, { decision: "approve", note: "Agreed" });
  assert.deepEqual([d.accessRevoked, d.recordsDeleted], [true, false]);
  const left = await db.prepare("SELECT (SELECT COUNT(*) FROM mfa_factors WHERE user_id = ?1) f, (SELECT COUNT(*) FROM mfa_recovery_codes WHERE user_id = ?1) c, (SELECT COUNT(*) FROM auth_sessions WHERE user_id = ?1) s").bind(victim).first();
  assert.deepEqual({ ...left }, { f: 0, c: 0, s: 0 });
  const a = await db.prepare("SELECT actor_id, detail FROM audit_log WHERE action = 'owner.removal_approved' AND target_id = ?1").bind(victim).first<{ actor_id: string; detail: string }>();
  assert.equal(a!.actor_id, ids.owner);
  assert.deepEqual([JSON.parse(a!.detail).reason, JSON.parse(a!.detail).note], ["Role no longer needed", "Agreed"]);
  assert.ok(await audited("owner.removal_requested", victim));
});

// ------------------------------------------------------------------ 5. audit integrity ----
test("audit log: append-only in the database, no application route can change it, and its retention is the owner's decision", async () => {
  const db = await w.db();
  await assert.rejects(db.prepare("UPDATE audit_log SET action = 'x' WHERE action = 'owner.bootstrap'").run(), /append-only/);
  await assert.rejects(db.prepare("DELETE FROM audit_log WHERE action = 'owner.bootstrap'").run(), /younger than 365 days/);
  const m = await bundle(`import "./src/server/lms/index"; export { routeList } from "./src/server/lms/api"; export { runRetention } from "./src/server/lms/retention";`);
  const writers = (m.routeList() as { method: string; path: string }[]).filter((r) => r.method !== "GET" && /audit/.test(r.path));
  assert.deepEqual(writers, [], "no route writes to or deletes from the audit log");
  // Retention: only the owner, with the authenticator code, can switch on audit-log retention; younger entries survive.
  const legacyNow = await signIn(w, "owner@example.com");
  assert.equal((await legacyNow.send("PUT", "/api/app/admin/settings/retention", { audit_log: { on: true, days: 365 } })).status, 403);
  // (Enrolling signed out the owner's email-only session; an email link now gives a session waiting for the code.)
  assert.equal((await ownerEmailOnly.get("/api/me")).status, 401, "enrolment ended the email-only session");
  const pending = await verify(w, await emailLink(w, OWNER, "10.77.4.4"), "10.77.4.4");
  assert.equal(await errOf(await pending.s.send("PUT", "/api/app/admin/settings/retention", { audit_log: { on: true, days: 365 } })), "mfa_required");
  assert.equal((await owner.send("PUT", "/api/app/admin/settings/retention", { audit_log: { on: true, days: 100 } })).status, 200, "accepted but clamped");
  const st = await owner.json<{ categories: { id: string; days: number; on: boolean }[] }>("GET", "/api/app/admin/settings/retention");
  const al = st.categories.find((c) => c.id === "audit_log")!;
  assert.ok(al.on && al.days >= 365, `audit_log days ${al.days} (minimum 365)`);
  const old = new Date(Date.now() - 800 * 86400_000).toISOString();
  await db.prepare("INSERT INTO audit_log (id, at, action) VALUES ('ancient', ?1, 'test.old')").bind(old).run();
  const total = (await db.prepare("SELECT COUNT(*) n FROM audit_log").first<{ n: number }>())!.n;
  await m.runRetention(db, new Date());
  assert.equal(await db.prepare("SELECT 1 FROM audit_log WHERE id = 'ancient'").first(), null, "beyond the period: deleted");
  assert.ok((await db.prepare("SELECT COUNT(*) n FROM audit_log").first<{ n: number }>())!.n >= total - 1, "nothing younger deleted");
  await owner.json("PUT", "/api/app/admin/settings/retention", { audit_log: { on: false, days: 730 } });
});

test("audit entries record actor, target, time and reason, and never secrets, codes or recovery tokens", async () => {
  const db = await w.db();
  // A refused break-glass attempt with a wrong token, then check nothing secret was stored anywhere in the log.
  const wrong = "wrong-token-wrong-token-wrong-token-wrong";
  const p = await verify(w, await emailLink(w, OWNER, "10.77.3.3"), "10.77.3.3");
  assert.equal((await p.s.send("POST", "/api/auth/owner-recovery", { token: wrong })).status, 400);
  assert.ok(await audited("mfa.owner_break_glass_failed"));
  const codes = await db.prepare("SELECT code_hash FROM mfa_recovery_codes LIMIT 5").all<{ code_hash: string }>();
  const all = (await db.prepare("SELECT action, actor_id, target_id, at, detail FROM audit_log").all<{ action: string; actor_id: string | null; target_id: string | null; at: string; detail: string | null }>()).results;
  const text = JSON.stringify(all);
  for (const s of [BREAK_GLASS, wrong, MFA_KEY, ids.ownerSecret, SECRETS.RESEND_API_KEY, ...codes.results.map((c) => c.code_hash)].filter(Boolean))
    assert.ok(!text.includes(s as string), "no secret, code, token or hash in the audit log");
  assert.doesNotMatch(text, /"(token|secret|code|password|recoveryCodes?)"\s*:/i);
  for (const e of all.filter((x) => x.action.startsWith("owner.") || x.action.startsWith("admin.group"))) {
    assert.ok(e.at && e.action, "time and action");
    assert.ok(e.actor_id || e.action === "owner.bootstrap", `actor for ${e.action}`);
  }
});

test("owner audit search works only for the owner with the code, and filters by actor, action and target", async () => {
  const r = await owner.json<{ entries: { action: string; actor_id: string }[] }>("GET", `/api/app/owner/audit?actor=${encodeURIComponent(OWNER)}&action=owner.`);
  assert.ok(r.entries.length > 0 && r.entries.every((e) => e.action.startsWith("owner.") && e.actor_id === ids.owner));
  const pending = await verify(w, await emailLink(w, OWNER, "10.77.5.5"), "10.77.5.5");
  assert.equal(await errOf(await pending.s.get("/api/app/owner/audit")), "mfa_required", "email link without the code");
  assert.equal((await session(w, ids.supCookie).get("/api/app/owner/audit")).status, 403, "a Super Administrator cannot");
});
