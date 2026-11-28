// Expansion Stage E.1: invitation acceptance atomicity, and approval decision kept apart from execution.
// Real requests to the real Worker (Miniflare). Failures are injected with SQLite triggers in this isolated database.
// Emails and Paystack are mocked; every approval rule here is a test fixture, never a real owner decision.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker, SECRETS } from "./worker-harness.ts";
import { signIn as helperSignIn, type Session } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";

type W = Awaited<ReturnType<typeof startWorker>>;
let w: W;
let owner: Session, sup: Session, sup2: Session;
const ids: Record<string, string> = {};
const OWNER = "boss@example.com";

const sql = async <T = Record<string, unknown>>(s: string, ...a: unknown[]) => (await (await w.db()).prepare(s).bind(...a).all<T>()).results;
const exec = async (s: string) => { await (await w.db()).exec(s); };
const reset = async () => { await (await w.db()).prepare("DELETE FROM rate_limits").run(); };
const signIn = async (email: string) => { await reset(); return helperSignIn(w, email); };
async function strong(email: string) {
  const s = await signIn(email);
  const secret = (await s.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  await s.json("POST", "/api/auth/mfa/enable", { code: await totpAt(secret, stepOf(Date.now())) });
  return s;
}
const body = async <T = Record<string, unknown>>(r: Response) => (await r.clone().json()) as T;
const expectErr = async (r: Promise<Response>, status: number, code?: string, msg?: string) => {
  const res = await r;
  assert.equal(res.status, status, `${msg ?? ""} ${await res.clone().text()}`);
  if (code) assert.equal((await body<{ error: string }>(res)).error, code, msg);
};
const mkUser = async (email: string, role: string, adminRole?: string) =>
  (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email, role, adminRole, fullName: email.split("@")[0], sendInvite: false })).user.id;
const countWhere = async (s: string, ...a: unknown[]) => (await sql<{ n: number }>(`SELECT COUNT(*) AS n FROM ${s}`, ...a))[0].n;
const pub = async (path: string, b: unknown, ip = "10.66.0.1") => { await reset(); return w.post(path, b, { "cf-connecting-ip": ip }); };
async function invite(b: Record<string, unknown>) {
  const before = w.calls.length;
  const r = await owner.send("POST", "/api/app/admin/invitations", b);
  assert.equal(r.status, 201, await r.clone().text());
  const id = (await body<{ invitation: { id: string } }>(r)).invitation.id;
  assert.ok(await w.waitFor((c) => c.slice(before).some((x) => x.url.includes("api.resend.com") && x.body.includes(String(b.email)))));
  const mail = w.calls.slice(before).filter((x) => x.url.includes("api.resend.com") && x.body.includes(String(b.email))).at(-1)!;
  return { id, token: JSON.parse(mail.body).html.match(/\/app\/invite\/\?t=([\w-]+)/)[1] as string };
}
const invStatus = async (id: string) => (await sql<{ status: string; accepted_user_id: string | null }>("SELECT status, accepted_user_id FROM staff_invitations WHERE id = ?1", id))[0];
const setApprovals = (p: Record<string, unknown>) => owner.json("PUT", "/api/app/owner/approval-policy", { categories: {}, paymentRelease: null, ...p });
const GROUP_RULE = { categories: { staff_group_change: { enabled: true, approver: "super", expiresInHours: 48 } } };
const groupOf = async (id: string) => (await sql<{ admin_role: string }>("SELECT admin_role FROM users WHERE id = ?1", id))[0].admin_role;
// Authority changes are made directly in this test database so the sessions in use stay valid (an API group change
// signs the person out). Every request reads the person's current group from the database.
const setGroup = (id: string, g: string) => sql("UPDATE users SET admin_role = ?2 WHERE id = ?1", id, g);
const approval = async (id: string) => (await sql<{ status: string; execution_status: string; execution_attempts: number; executed_at: string | null; execution_result: string | null }>(
  "SELECT status, execution_status, execution_attempts, executed_at, execution_result FROM approval_requests WHERE id = ?1", id))[0];
const request = async (target: string, adminRole: string, reason = "Change of duties") =>
  (await sup.json<{ request: { id: string } }>("POST", "/api/app/admin/approvals", { category: "staff_group_change", targetId: target, payload: { adminRole }, reason })).request.id;
const decide = (s: Session, id: string, decision = "approve", comment?: string) => s.send("POST", `/api/app/admin/approvals/${id}/decision`, { decision, comment });
const recover = (s: Session, id: string) => s.send("POST", `/api/app/admin/approvals/${id}/execute`, {});
// A request whose first run fails with a definite refusal: the requester loses authority after asking.
async function failedRequest(target: string, adminRole: string) {
  const id = await request(target, adminRole);
  await setGroup(ids.sup, "finance");
  const r = await body<{ executed: boolean; execution: { status: string } }>(await decide(sup2, id));
  await setGroup(ids.sup, "super");
  assert.deepEqual([r.executed, r.execution.status], [false, "failed"]);
  return id;
}

before(async () => {
  w = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") } });
  owner = await strong(OWNER);
  await owner.json("POST", "/api/app/owner/bootstrap");
  ids.owner = (await sql<{ id: string }>("SELECT id FROM users WHERE email = ?1", OWNER))[0].id;
  ids.sup = await mkUser("sup@example.com", "admin", "super");
  ids.sup2 = await mkUser("sup2@example.com", "admin", "super");
  ids.fin = await mkUser("fin@example.com", "admin", "finance");
  ids.sto = await mkUser("sto@example.com", "admin", "support");
  sup = await strong("sup@example.com");
  sup2 = await strong("sup2@example.com");
  await owner.json("POST", "/api/app/admin/departments", { slug: "finance", name: "Finance" });
});
after(async () => { await w.dispose(); });

// ================================================================ 1. invitation acceptance ====
test("E1.1 failure during account creation rolls everything back; the invitation stays usable", async () => {
  const { id, token } = await invite({ email: "boom1@example.com", fullName: "Boom One", role: "admin", adminRole: "support", departmentSlug: "finance", position: "staff" });
  await exec("CREATE TRIGGER t_fail_user BEFORE INSERT ON users WHEN NEW.email = 'boom1@example.com' BEGIN SELECT RAISE(ABORT, 'injected account failure'); END");
  try { await expectErr(pub("/api/auth/invitations/accept", { token }), 503, "try_again"); }
  finally { await exec("DROP TRIGGER t_fail_user"); }
  assert.deepEqual(await invStatus(id), { status: "pending", accepted_user_id: null }, "not consumed");
  assert.equal(await countWhere("users WHERE email = 'boom1@example.com'"), 0);
  assert.equal(await countWhere("audit_log WHERE action = 'invite.accepted' AND target_id = ?1", id), 0);
  assert.ok(!(await sql<{ message: string }>("SELECT message FROM error_log")).some((e) => e.message.includes(token)), "token never logged");
  // Retry works and gives exactly the invited access.
  const ok = await pub("/api/auth/invitations/accept", { token, adminRole: "super" });
  assert.equal(ok.status, 200);
  const [u] = await sql<{ id: string; role: string; admin_role: string }>("SELECT id, role, admin_role FROM users WHERE email = 'boom1@example.com'");
  assert.deepEqual([u.role, u.admin_role], ["admin", "support"]);
  assert.equal((await invStatus(id)).accepted_user_id, u.id);
  assert.equal(await countWhere("staff_assignments WHERE user_id = ?1 AND department_slug = 'finance' AND position = 'staff'", u.id), 1);
});

test("E1.2 failure while persisting the acceptance (or the department assignment) creates no account", async () => {
  const { id, token } = await invite({ email: "boom2@example.com", fullName: "Boom Two", role: "instructor" });
  await exec("CREATE TRIGGER t_fail_accept BEFORE UPDATE OF status ON staff_invitations WHEN NEW.status = 'accepted' AND OLD.email = 'boom2@example.com' BEGIN SELECT RAISE(ABORT, 'injected acceptance failure'); END");
  try { await expectErr(pub("/api/auth/invitations/accept", { token }), 503, "try_again"); }
  finally { await exec("DROP TRIGGER t_fail_accept"); }
  assert.equal((await invStatus(id)).status, "pending");
  assert.equal(await countWhere("users WHERE email = 'boom2@example.com'"), 0);
  const a = await invite({ email: "boom2b@example.com", fullName: "Boom Twob", role: "admin", adminRole: "finance", departmentSlug: "finance", position: "staff" });
  await exec("CREATE TRIGGER t_fail_assign BEFORE INSERT ON staff_assignments WHEN NEW.reason LIKE 'invitation %' BEGIN SELECT RAISE(ABORT, 'injected assignment failure'); END");
  try { await expectErr(pub("/api/auth/invitations/accept", { token: a.token }), 503, "try_again"); }
  finally { await exec("DROP TRIGGER t_fail_assign"); }
  assert.equal((await invStatus(a.id)).status, "pending");
  assert.equal(await countWhere("users WHERE email = 'boom2b@example.com'"), 0, "no account without its department");
  // Both recover.
  assert.equal((await pub("/api/auth/invitations/accept", { token })).status, 200);
  assert.equal((await sql<{ verification: string }>("SELECT verification FROM users WHERE email = 'boom2@example.com'"))[0].verification, "application_received", "instructor stays a candidate");
  assert.equal((await pub("/api/auth/invitations/accept", { token: a.token })).status, 200);
});

test("E1.3 repeated acceptance never creates a second account or a second session", async () => {
  const { id, token } = await invite({ email: "twice@example.com", fullName: "Twice Over", role: "admin", adminRole: "reporting" });
  const first = await pub("/api/auth/invitations/accept", { token });
  assert.equal((await body<{ signedIn: boolean }>(first)).signedIn, true);
  for (let i = 0; i < 3; i++) {
    const again = await pub("/api/auth/invitations/accept", { token });
    assert.equal(again.status, 200);
    assert.deepEqual(await body(again), { ok: true, accepted: true, signedIn: false, alreadyAccepted: true, message: "This invitation was already accepted. Sign in from your staff entrance with the invited email address." });
    assert.equal(again.headers.getSetCookie().length, 0, "no session from a used link");
  }
  assert.equal(await countWhere("users WHERE email = 'twice@example.com'"), 1);
  assert.equal(await countWhere("auth_sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'twice@example.com'"), 1);
  assert.equal(await countWhere("audit_log WHERE action = 'invite.accepted' AND target_id = ?1", id), 1);
  // The used link still cannot be previewed or declined.
  await expectErr(pub("/api/auth/invitations/preview", { token }), 400, "invalid_invitation");
  await expectErr(pub("/api/auth/invitations/decline", { token }), 400, "invalid_invitation");
});

test("E1.4 the account stays valid when the session cannot be started; the person signs in the usual way", async () => {
  const { id, token } = await invite({ email: "nosession@example.com", fullName: "No Session", role: "admin", adminRole: "support" });
  await exec("CREATE TRIGGER t_fail_session BEFORE INSERT ON auth_sessions WHEN NEW.user_id IN (SELECT id FROM users WHERE email = 'nosession@example.com') BEGIN SELECT RAISE(ABORT, 'injected session failure'); END");
  let r: Response;
  try { r = await pub("/api/auth/invitations/accept", { token }); }
  finally { await exec("DROP TRIGGER t_fail_session"); }
  assert.equal(r.status, 200);
  assert.deepEqual([(await body<{ accepted: boolean; signedIn: boolean }>(r)).accepted, (await body<{ signedIn: boolean }>(r)).signedIn], [true, false]);
  assert.equal(r.headers.getSetCookie().length, 0);
  assert.equal((await invStatus(id)).status, "accepted");
  const [u] = await sql<{ id: string; admin_role: string; status: string }>("SELECT id, admin_role, status FROM users WHERE email = 'nosession@example.com'");
  assert.deepEqual([u.admin_role, u.status], ["support", "active"]);
  assert.equal(await countWhere("audit_log WHERE action = 'invite.session_failed' AND target_id = ?1", u.id), 1);
  const s = await signIn("nosession@example.com"); // the existing email-link sign-in
  assert.equal((await s.get("/api/me")).status, 200);
});

test("E1.5 expired, revoked and declined invitations stay unusable", async () => {
  const exp = await invite({ email: "exp1@example.com", fullName: "Exp One", role: "instructor" });
  await sql("UPDATE staff_invitations SET expires_at = '2026-01-01T00:00:00Z' WHERE id = ?1", exp.id);
  await expectErr(pub("/api/auth/invitations/accept", { token: exp.token }), 400, "invalid_invitation");
  // Expiry is also enforced inside the atomic claim itself (expires_at > now), not only before it.
  const exp2 = await invite({ email: "exp2@example.com", fullName: "Exp Two", role: "instructor" });
  // The staff number is taken after the pre-checks and before the claim: expiring the invitation at that moment
  // leaves only the claim's own condition to stop it.
  await exec("CREATE TRIGGER t_expire_now AFTER UPDATE ON id_sequences BEGIN UPDATE staff_invitations SET expires_at = '2026-01-01T00:00:00Z' WHERE email = 'exp2@example.com'; END");
  await exec("CREATE TRIGGER t_expire_now2 AFTER INSERT ON id_sequences BEGIN UPDATE staff_invitations SET expires_at = '2026-01-01T00:00:00Z' WHERE email = 'exp2@example.com'; END");
  try { await expectErr(pub("/api/auth/invitations/accept", { token: exp2.token }), 400, "invalid_invitation"); }
  finally { await exec("DROP TRIGGER t_expire_now"); await exec("DROP TRIGGER t_expire_now2"); }
  assert.equal((await invStatus(exp2.id)).status, "pending", "the claim refused it; it is marked expired on its next use");
  const rev = await invite({ email: "rev1@example.com", fullName: "Rev One", role: "instructor" });
  await owner.json("POST", `/api/app/admin/invitations/${rev.id}/revoke`, { reason: "Wrong person" });
  await expectErr(pub("/api/auth/invitations/accept", { token: rev.token }), 400, "invalid_invitation");
  const dec = await invite({ email: "dec1@example.com", fullName: "Dec One", role: "instructor" });
  assert.equal((await pub("/api/auth/invitations/decline", { token: dec.token })).status, 200);
  await expectErr(pub("/api/auth/invitations/accept", { token: dec.token }), 400, "invalid_invitation");
  assert.equal(await countWhere("users WHERE email IN ('exp1@example.com', 'exp2@example.com', 'rev1@example.com', 'dec1@example.com')"), 0);
});

test("E1.6 concurrent acceptance: one account, one assignment, one session", async () => {
  const { id, token } = await invite({ email: "race@example.com", fullName: "Race Condition", role: "admin", adminRole: "admissions", departmentSlug: "finance", position: "staff" });
  await reset();
  const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => w.post("/api/auth/invitations/accept", { token }, { "cf-connecting-ip": `10.55.0.${i + 1}` })));
  const signedIn = [];
  for (const r of rs) {
    assert.ok([200, 400].includes(r.status), `${r.status} ${await r.clone().text()}`);
    if (r.headers.getSetCookie().length) signedIn.push(r);
  }
  assert.equal(signedIn.length, 1, "exactly one session");
  assert.equal(await countWhere("users WHERE email = 'race@example.com'"), 1);
  const uid = (await invStatus(id)).accepted_user_id;
  assert.equal(await countWhere("staff_assignments WHERE user_id = ?1", uid), 1);
  assert.equal(await countWhere("audit_log WHERE action = 'invite.accepted' AND target_id = ?1", id), 1);
});

// ================================================================ 2. approval execution ====
test("E1.7 success: the decision and the execution are recorded separately", async () => {
  await setApprovals(GROUP_RULE);
  const id = await request(ids.fin, "reporting");
  assert.deepEqual([(await approval(id)).status, (await approval(id)).execution_status], ["pending", "not_applicable"]);
  const r = await body<{ executed: boolean; approval: { status: string; execution_status: string } }>(await decide(sup2, id));
  assert.deepEqual([r.executed, r.approval.status, r.approval.execution_status], [true, "approved", "completed"]);
  const a = await approval(id);
  assert.deepEqual([a.execution_attempts, !!a.executed_at], [1, true]);
  assert.equal(await groupOf(ids.fin), "reporting");
  await setGroup(ids.fin, "finance");
});

test("E1.8 an approval whose action fails stays approved but is never shown as completed; the failure is visible", async () => {
  const id = await failedRequest(ids.fin, "support");
  const a = await approval(id);
  assert.deepEqual([a.status, a.execution_status, a.executed_at], ["approved", "failed", null]);
  assert.match(a.execution_result!, /^refused, nothing changed/);
  assert.equal(await groupOf(ids.fin), "finance", "nothing changed");
  const list = await sup2.json<{ approvals: { id: string; status: string; execution_status: string; execution_result: string; canRecover: boolean }[] }>("GET", "/api/app/admin/approvals");
  const row = list.approvals.find((x) => x.id === id)!;
  assert.deepEqual([row.status, row.execution_status, row.canRecover], ["approved", "failed", true]);
  const mine = await sup.json<{ approvals: { id: string; canRecover: boolean }[] }>("GET", "/api/app/admin/approvals");
  assert.equal(mine.approvals.find((x) => x.id === id)!.canRecover, false, "the requester cannot carry it out");
  await expectErr(recover(sup, id), 403, "forbidden");
  ids.failed1 = id;
});

test("E1.9 recovery after failure re-checks everything, then completes once", async () => {
  const r = await body<{ executed: boolean; approval: { execution_status: string; execution_attempts: number } }>(await recover(sup2, ids.failed1));
  assert.deepEqual([r.executed, r.approval.execution_status, r.approval.execution_attempts], [true, "completed", 2]);
  assert.equal(await groupOf(ids.fin), "support");
  await expectErr(recover(sup2, ids.failed1), 409, "already_completed", "never twice");
  await expectErr(decide(sup2, ids.failed1), 409, "decided");
  await setGroup(ids.fin, "finance");
});

test("E1.10 concurrent recovery requests: exactly one runs the action", async () => {
  const id = await failedRequest(ids.fin, "academic");
  const before = await countWhere("audit_log WHERE action = 'admin.group_assigned' AND target_id = ?1", ids.fin);
  const rs = await Promise.all([recover(sup2, id), recover(owner, id), recover(sup2, id)]);
  const ok = rs.filter((r) => r.status === 200);
  assert.equal(ok.length, 1, (await Promise.all(rs.map((r) => r.clone().text()))).join(" | "));
  for (const r of rs.filter((x) => x.status !== 200)) assert.ok(["execution_in_progress", "already_completed"].includes((await body<{ error: string }>(r)).error));
  assert.equal(await countWhere("audit_log WHERE action = 'admin.group_assigned' AND target_id = ?1", ids.fin) - before, 1, "one change only");
  assert.equal((await approval(id)).execution_status, "completed");
  await setGroup(ids.fin, "finance");
});

test("E1.11 an interrupted execution: refused while fresh, recovered once stale, and never repeated if it took effect", async () => {
  const id = await request(ids.sto, "reporting");
  // Simulates a Worker that stopped after claiming the run (decision recorded, action not finished).
  const now = new Date().toISOString();
  await sql("UPDATE approval_requests SET status = 'approved', decided_by = ?2, decided_at = ?3, execution_status = 'executing', execution_claimed_at = ?3, execution_claimed_by = ?2, execution_attempts = 1 WHERE id = ?1", id, ids.sup2, now);
  await expectErr(recover(sup2, id), 409, "execution_in_progress", "a run claimed moments ago is not taken over");
  await sql("UPDATE approval_requests SET execution_claimed_at = '2026-11-01T00:00:00Z' WHERE id = ?1", id);
  const r = await body<{ executed: boolean; execution: { result: string } }>(await recover(sup2, id));
  assert.equal(r.executed, true);
  assert.equal(await groupOf(ids.sto), "reporting");
  await setGroup(ids.sto, "support");
  // Interrupted AFTER the change took effect: recovery records it and does not apply it again.
  const id2 = await request(ids.sto, "academic");
  await sql("UPDATE approval_requests SET status = 'approved', decided_by = ?2, decided_at = ?3, execution_status = 'executing', execution_claimed_at = '2026-11-01T00:00:00Z', execution_attempts = 1 WHERE id = ?1", id2, ids.sup2, now);
  await setGroup(ids.sto, "academic");
  const before = await countWhere("audit_log WHERE action = 'admin.group_assigned' AND target_id = ?1", ids.sto);
  const r2 = await body<{ execution: { result: string } }>(await recover(sup2, id2));
  assert.match(r2.execution.result, /already in effect/);
  assert.equal(await countWhere("audit_log WHERE action = 'admin.group_assigned' AND target_id = ?1", ids.sto), before, "not applied twice");
  assert.equal(await countWhere("audit_log WHERE action = 'approval.execution_reconciled' AND target_id = ?1", id2), 1);
  await setGroup(ids.sto, "support");
});

test("E1.12 an unexpected database failure is recorded as failed and is not retried automatically", async () => {
  const id = await request(ids.sto, "faculty");
  await exec("CREATE TRIGGER t_fail_group BEFORE UPDATE OF admin_role ON users WHEN NEW.admin_role = 'faculty' BEGIN SELECT RAISE(ABORT, 'injected database failure'); END");
  try {
    const r = await body<{ executed: boolean }>(await decide(sup2, id));
    assert.equal(r.executed, false);
  } finally { await exec("DROP TRIGGER t_fail_group"); }
  const a = await approval(id);
  assert.deepEqual([a.status, a.execution_status, a.execution_attempts], ["approved", "failed", 1]);
  // Stage E.2: the action commits in one fenced batch, so a database failure inside it is known to have rolled back
  // (no fence row for the run). Before E.2 this outcome could only be reported as uncertain.
  assert.match(a.execution_result!, /^failed, nothing committed/);
  assert.equal(await countWhere("execution_fences WHERE approval_id = ?1", id), 0);
  assert.equal(await groupOf(ids.sto), "support", "nothing committed");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await approval(id)).execution_attempts, 1, "no automatic retry");
  // An explicit recovery checks the target first, then runs.
  assert.equal((await body<{ executed: boolean }>(await recover(sup2, id))).executed, true);
  assert.equal(await groupOf(ids.sto), "faculty");
  await setGroup(ids.sto, "support");
});

test("E1.13 policy withdrawn before execution: recovery is refused and nothing runs", async () => {
  const id = await failedRequest(ids.fin, "reporting");
  await setApprovals({});
  await expectErr(recover(sup2, id), 409, "policy_withdrawn");
  await expectErr(recover(owner, id), 409, "policy_withdrawn");
  assert.deepEqual([(await approval(id)).execution_status, await groupOf(ids.fin)], ["failed", "finance"]);
  await setApprovals(GROUP_RULE);
  ids.failed2 = id;
});

test("E1.14 an approver who lost authority cannot recover; an eligible approver can", async () => {
  await setGroup(ids.sup2, "finance");
  // No longer a Super Administrator: the request is not even visible to them any more.
  await expectErr(recover(sup2, ids.failed2), 404, "not_found", "no longer a Super Administrator");
  assert.equal((await approval(ids.failed2)).execution_status, "failed");
  await setGroup(ids.sup2, "super");
  // The requester's authority is re-checked too: a requester who lost it blocks recovery (definite refusal again).
  await setGroup(ids.sup, "finance");
  assert.equal((await body<{ executed: boolean }>(await recover(owner, ids.failed2))).executed, false);
  assert.equal((await approval(ids.failed2)).execution_status, "failed");
  await setGroup(ids.sup, "super");
  assert.equal((await body<{ executed: boolean }>(await recover(owner, ids.failed2))).executed, true);
  assert.equal(await groupOf(ids.fin), "reporting");
  await setGroup(ids.fin, "finance");
});

test("E1.15 rejected, expired and cancelled requests never execute, even if their row is tampered with", async () => {
  const rej = await request(ids.fin, "support");
  await sup2.json("POST", `/api/app/admin/approvals/${rej}/decision`, { decision: "reject", comment: "No" });
  const can = await request(ids.fin, "support");
  await sup.json("POST", `/api/app/admin/approvals/${can}/cancel`, { reason: "Withdrawn" });
  const exp = await request(ids.fin, "support");
  await sql("UPDATE approval_requests SET expires_at = '2026-01-01T00:00:00Z' WHERE id = ?1", exp);
  await expectErr(decide(sup2, exp), 409, "expired");
  for (const id of [rej, can, exp]) {
    assert.equal((await approval(id)).execution_status, "not_applicable");
    await expectErr(recover(sup2, id), 409, "not_approved");
    // Even a row forced into "awaiting execution" is not claimable unless the decision is "approved".
    await sql("UPDATE approval_requests SET execution_status = 'awaiting_execution' WHERE id = ?1", id);
    await expectErr(recover(owner, id), 409, "not_approved");
  }
  assert.equal(await groupOf(ids.fin), "finance");
});

test("E1.16 audit history and display: decision and execution trail; owner direct actions are distinguishable", async () => {
  const h = await owner.json<{ approval: { status: string; execution_status: string; execution_attempts: number }; history: { action: string }[] }>("GET", `/api/app/admin/approvals/${ids.failed1}`);
  assert.deepEqual([h.approval.status, h.approval.execution_status, h.approval.execution_attempts], ["approved", "completed", 2]);
  assert.deepEqual(h.history.map((x) => x.action), ["approval.requested", "approval.approved", "approval.execution_started", "approval.execution_failed",
    "approval.recovery_refused", "approval.recovery_requested", "approval.execution_started", "approval.executed"]);
  const viaApproval = (await sql<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'admin.group_assigned' AND detail LIKE ?1", `%${ids.failed1}%`)).map((x) => JSON.parse(x.detail));
  assert.equal(viaApproval.length, 1);
  assert.deepEqual([viaApproval[0].authority, viaApproval[0].approvalRequest, viaApproval[0].approvedBy], ["approval", ids.failed1, ids.sup2]);
  // The owner acts directly even with the rule on, and the record says so.
  await owner.json("PATCH", `/api/app/admin/users/${ids.fin}`, { adminRole: "academic", reason: "Owner decision" });
  const [direct] = (await sql<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'staff.access_changed' AND target_id = ?1 ORDER BY at DESC LIMIT 1", ids.fin)).map((x) => JSON.parse(x.detail));
  assert.equal(direct.authority, "owner_direct");
  assert.equal(direct.approvalRequest, undefined);
  await setApprovals({});
});
