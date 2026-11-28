// Expansion Stage E.2: approval execution fencing. A superseded (stale) run must not be able to commit the action
// itself, not merely its final status. Real requests to the real Worker (Miniflare) on an isolated database.
// "A newer run took over" is simulated two ways:
//   - a SQLite trigger that replaces the claim (as a recovery would) at the moment the old run has claimed and is
//     about to check and commit: the old run then really tries to commit, after its claim was superseded;
//   - a real second request (an explicit recovery) while the first run is paused inside the Paystack check.
// Every approval rule is a test fixture. Paystack and email are mocked. Nothing is paid or sent.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker, SECRETS, registration } from "./worker-harness.ts";
import { signIn as helperSignIn, type Session } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";

type W = Awaited<ReturnType<typeof startWorker>>;
let w: W;
let owner: Session, sup: Session, sup2: Session, fin: Session;
const ids: Record<string, string> = {};
const OWNER = "boss@example.com";

// Paystack: initialize fails with a network error (leaving an uncertain attempt); verify can be held and answered.
let verifyAnswer: () => Response = () => Response.json({ status: false, message: "Transaction reference not found" }, { status: 400 });
let hold: { armed: boolean; open?: () => void; wait?: Promise<void>; reached: boolean } = { armed: false, reached: false };
const armHold = () => { let open!: () => void; const wait = new Promise<void>((r) => { open = r; }); hold = { armed: true, open, wait, reached: false }; };

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
const n = async (s: string, ...a: unknown[]) => (await sql<{ n: number }>(`SELECT COUNT(*) AS n FROM ${s}`, ...a))[0].n;
const mkUser = async (email: string, role: string, adminRole?: string) =>
  (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email, role, adminRole, fullName: email.split("@")[0], sendInvite: false })).user.id;
const setGroup = (id: string, g: string) => sql("UPDATE users SET admin_role = ?2 WHERE id = ?1", id, g);
const groupOf = async (id: string) => (await sql<{ admin_role: string }>("SELECT admin_role FROM users WHERE id = ?1", id))[0].admin_role;
const req = async (id: string) => (await sql<{ status: string; execution_status: string; execution_claim_id: string | null; execution_result: string | null; execution_attempts: number; executed_at: string | null }>(
  "SELECT status, execution_status, execution_claim_id, execution_result, execution_attempts, executed_at FROM approval_requests WHERE id = ?1", id))[0];
const fences = (id: string) => sql<{ claim_id: string; owner_check: string; effect_check: string }>("SELECT claim_id, owner_check, effect_check FROM execution_fences WHERE approval_id = ?1", id);
const audits = (action: string, like: string) => n("audit_log WHERE action = ?1 AND detail LIKE ?2", action, `%${like}%`);
const RULES = {
  categories: {
    staff_group_change: { enabled: true, approver: "super", expiresInHours: 48 },
    staff_reinstatement: { enabled: true, approver: "super", expiresInHours: 48 },
    department_head_appointment: { enabled: true, approver: "owner", expiresInHours: 48 },
  },
  paymentRelease: { enabled: true, approver: "owner", expiresInHours: 24, allowedGroups: ["finance"], requiresApproval: true },
};
const ask = async (s: Session, category: string, targetId: string, payload: Record<string, unknown> = {}, reason = "Needed") =>
  (await s.json<{ request: { id: string } }>("POST", "/api/app/admin/approvals", { category, targetId, payload, reason })).request.id;
const approve = (s: Session, id: string) => s.send("POST", `/api/app/admin/approvals/${id}/decision`, { decision: "approve" });
const recover = (s: Session, id: string) => s.send("POST", `/api/app/admin/approvals/${id}/execute`, {});
const makeStale = (id: string) => sql("UPDATE approval_requests SET execution_claimed_at = '2026-11-01T00:00:00Z' WHERE id = ?1", id);

// Simulates a newer run taking over at the moment the old run has claimed and is about to check and commit: replaces
// the claim id exactly as a recovery's claim would. The old run continues and really attempts its commit.
async function supersedeAfterClaim(approvalId: string) {
  // (one line: the D1 exec helper runs one statement per line)
  await exec(`CREATE TRIGGER t_supersede AFTER INSERT ON audit_log WHEN NEW.action = 'approval.execution_started' AND NEW.target_id = '${approvalId}' BEGIN UPDATE approval_requests SET execution_claim_id = 'newer-' || NEW.id, execution_claimed_at = NEW.at WHERE id = NEW.target_id; END`);
}
const dropSupersede = () => exec("DROP TRIGGER IF EXISTS t_supersede");

// The old run was superseded: it committed nothing, recorded no outcome, and the newer claim still stands.
async function assertOldRunCommittedNothing(approvalId: string, r: Response) {
  assert.equal(r.status, 200, await r.clone().text());
  const j = await body<{ executed: boolean; execution: { status: string } }>(r);
  assert.deepEqual([j.executed, j.execution.status], [false, "superseded"]);
  const q = await req(approvalId);
  assert.equal(q.status, "approved", "the decision is preserved");
  assert.equal(q.execution_status, "executing", "the newer run still owns it");
  assert.match(q.execution_claim_id!, /^newer-/, "the newer claim was not overwritten");
  assert.equal(q.execution_result, null, "no result written by the old run");
  assert.equal(q.executed_at, null);
  assert.deepEqual(await fences(approvalId), [], "no fence row: the old run's batch rolled back");
  assert.equal(await n("audit_log WHERE action = 'approval.executed' AND target_id = ?1", approvalId), 0, "no false completion in the audit trail");
  assert.equal(await n("audit_log WHERE action = 'approval.execution_failed' AND target_id = ?1", approvalId), 0, "no outcome over the newer run");
  // It got as far as committing: the fence (not an earlier check) is what stopped it.
  assert.equal(await n("audit_log WHERE action = 'approval.execution_superseded' AND target_id = ?1 AND detail LIKE '%\"at\":\"commit\"%'", approvalId), 1, "stopped at the commit by the fence");
}

let payN = 0;
async function uncertainAttempt() {
  const b = registration({ programme: "cloud", method: "paystack", idempotencyKey: crypto.randomUUID(), learner: { ...registration().learner, email: `payer${++payN}@example.com`, country: "Nigeria", countryCode: "NG" } });
  await reset();
  await w.post("/api/register", b);
  const [a] = await sql<{ id: string; state: string }>("SELECT a.id, a.state FROM payment_attempts a JOIN orders o ON o.id = a.order_id WHERE o.idempotency_key = ?1", b.idempotencyKey);
  assert.equal(a.state, "uncertain");
  return a.id;
}
const attemptState = async (id: string) => (await sql<{ state: string; released_reason: string | null }>("SELECT state, released_reason FROM payment_attempts WHERE id = ?1", id))[0];

before(async () => {
  w = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64") }, mock: async (rq) => {
    const u = new URL(rq.url);
    if (u.host === "api.paystack.co" && u.pathname === "/transaction/initialize") throw new TypeError("network connection lost");
    if (u.host === "api.paystack.co" && u.pathname.startsWith("/transaction/verify/")) {
      if (hold.armed) { hold.armed = false; hold.reached = true; await hold.wait; }
      return verifyAnswer();
    }
    return undefined;
  } });
  owner = await strong(OWNER);
  await owner.json("POST", "/api/app/owner/bootstrap");
  ids.sup = await mkUser("sup@example.com", "admin", "super");
  ids.sup2 = await mkUser("sup2@example.com", "admin", "super");
  ids.fin = await mkUser("fin@example.com", "admin", "finance");
  ids.t1 = await mkUser("t1@example.com", "admin", "support");
  ids.t2 = await mkUser("t2@example.com", "admin", "support");
  sup = await strong("sup@example.com");
  sup2 = await strong("sup2@example.com");
  fin = await strong("fin@example.com");
  await owner.json("POST", "/api/app/admin/departments", { slug: "support", name: "Student Support" });
  await owner.json("PUT", "/api/app/owner/approval-policy", RULES);
});
after(async () => { await w.dispose(); });

// ---------------------------------------------------------------- 1-5: superseded runs cannot commit ----
test("E2.1 group change: an old run whose claim was superseded cannot change the group, end sessions or write audit outcomes", async () => {
  const t1 = await signIn("t1@example.com"); // a live session of the target: the action would end it
  const id = await ask(sup, "staff_group_change", ids.t1, { adminRole: "reporting" });
  await supersedeAfterClaim(id);
  try { await assertOldRunCommittedNothing(id, await approve(sup2, id)); } finally { await dropSupersede(); }
  assert.equal(await groupOf(ids.t1), "support", "group unchanged");
  assert.equal((await t1.get("/api/me")).status, 200, "sessions not ended");
  assert.equal(await audits("admin.group_assigned", id), 0, "no audit of a change that did not happen");
  // While the newer run's claim is fresh, nobody takes it over.
  await expectErr(recover(sup2, id), 409, "execution_in_progress");
  // The newer run (here: an explicit recovery once that claim is stale) commits it exactly once.
  await makeStale(id);
  assert.equal((await body<{ executed: boolean }>(await recover(sup2, id))).executed, true);
  assert.equal(await groupOf(ids.t1), "reporting");
  assert.equal(await audits("admin.group_assigned", id), 1);
  const f = await fences(id);
  assert.equal(f.length, 1);
  assert.deepEqual([f[0].owner_check, f[0].effect_check, f[0].claim_id], ["current", "confirmed", (await req(id)).execution_claim_id]);
  assert.equal((await t1.get("/api/me")).status, 401, "sessions ended by the run that committed");
  await setGroup(ids.t1, "support");
});

test("E2.2 reinstatement: a superseded run cannot reactivate the account", async () => {
  await owner.json("PATCH", `/api/app/admin/users/${ids.t2}`, { status: "suspended", reason: "Hold" });
  const id = await ask(sup, "staff_reinstatement", ids.t2);
  await supersedeAfterClaim(id);
  try { await assertOldRunCommittedNothing(id, await approve(sup2, id)); } finally { await dropSupersede(); }
  assert.equal((await sql<{ status: string }>("SELECT status FROM users WHERE id = ?1", ids.t2))[0].status, "suspended");
  assert.equal(await audits("staff.reinstated", id), 0);
  await makeStale(id);
  assert.equal((await body<{ executed: boolean }>(await recover(sup2, id))).executed, true);
  assert.equal((await sql<{ status: string }>("SELECT status FROM users WHERE id = ?1", ids.t2))[0].status, "active");
  assert.equal(await audits("staff.reinstated", id), 1);
});

test("E2.3 head appointment: a superseded run cannot end the current headship or create a new one (multi-statement action)", async () => {
  await owner.json("POST", "/api/app/admin/departments/support/members", { userId: ids.t2, position: "head", reason: "First head" });
  const id = await ask(sup, "department_head_appointment", ids.t1, { departmentSlug: "support" });
  await supersedeAfterClaim(id);
  try { await assertOldRunCommittedNothing(id, await approve(owner, id)); } finally { await dropSupersede(); }
  const heads = await sql<{ user_id: string }>("SELECT user_id FROM staff_assignments WHERE department_slug = 'support' AND position = 'head' AND ended_at IS NULL");
  assert.deepEqual(heads.map((h) => h.user_id), [ids.t2], "the current head is untouched; nothing partial was committed");
  assert.equal(await n("staff_assignments WHERE user_id = ?1", ids.t1), 0);
  assert.equal(await audits("staff.head_appointed", id) + await audits("staff.head_replaced", id), 0);
  await makeStale(id);
  assert.equal((await body<{ executed: boolean }>(await recover(owner, id))).executed, true);
  const after = await sql<{ user_id: string; ended_at: string | null }>("SELECT user_id, ended_at FROM staff_assignments WHERE department_slug = 'support' AND position = 'head' ORDER BY created_at");
  assert.deepEqual(after.map((a) => [a.user_id, !!a.ended_at]), [[ids.t2, true], [ids.t1, false]]);
  assert.equal(await audits("staff.head_appointed", id), 1);
  assert.equal(await audits("staff.head_replaced", id), 1);
});

test("E2.4 payment release: a superseded run cannot release the attempt", async () => {
  const att = await uncertainAttempt();
  const rq = await fin.send("POST", `/api/app/admin/payments/attempts/${att}/release`, { reason: "Not in the Paystack dashboard", confirmedWithPaystack: true });
  assert.equal(rq.status, 202);
  const id = (await body<{ request: { id: string } }>(rq)).request.id;
  await supersedeAfterClaim(id);
  try { await assertOldRunCommittedNothing(id, await approve(owner, id)); } finally { await dropSupersede(); }
  assert.equal((await attemptState(att)).state, "uncertain", "not released");
  assert.equal(await audits("payment.attempt_release", id), 0);
  await makeStale(id);
  assert.equal((await body<{ executed: boolean }>(await recover(owner, id))).executed, true);
  assert.equal((await attemptState(att)).state, "released");
  assert.equal(await audits("payment.attempt_release", id), 1);
});

test("E2.5 real interleaving: the first run is paused, a newer run takes over and completes, the first resumes and changes nothing", async () => {
  const att = await uncertainAttempt();
  const id = (await body<{ request: { id: string } }>(await fin.send("POST", `/api/app/admin/payments/attempts/${att}/release`, { reason: "Checked by Finance", confirmedWithPaystack: true }))).request.id;
  armHold();
  const first = approve(owner, id); // claims, then pauses inside the Paystack check
  for (let i = 0; i < 200 && !hold.reached; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(hold.reached, "the first run is paused mid-execution");
  const firstClaim = (await req(id)).execution_claim_id;
  assert.equal((await req(id)).execution_status, "executing");
  await expectErr(recover(owner, id), 409, "execution_in_progress", "a fresh claim is not taken over");
  await makeStale(id);
  const second = await recover(owner, id); // the newer run: new claim id, completes
  assert.equal((await body<{ executed: boolean }>(second)).executed, true);
  const secondClaim = (await req(id)).execution_claim_id;
  assert.notEqual(secondClaim, firstClaim);
  const done = await req(id);
  hold.open!(); // the first run resumes
  const r1 = await body<{ executed: boolean; execution: { status: string } }>(await first);
  assert.deepEqual([r1.executed, r1.execution.status], [false, "superseded"]);
  const now = await req(id);
  assert.deepEqual([now.execution_status, now.execution_claim_id, now.execution_result, now.executed_at], [done.execution_status, secondClaim, done.execution_result, done.executed_at], "the newer result stands");
  assert.equal((await attemptState(att)).state, "released");
  assert.equal(await audits("payment.attempt_release", id), 1, "released once");
  assert.deepEqual((await fences(id)).map((f) => f.claim_id), [secondClaim], "only the newer run committed");
  assert.equal(await n("audit_log WHERE action = 'approval.executed' AND target_id = ?1", id), 1);
  assert.equal(await n("audit_log WHERE action = 'approval.execution_failed' AND target_id = ?1", id), 0, "the first run did not record a failure over the newer success");
});

// ---------------------------------------------------------------- 6-10 ----
test("E2.6 concurrent recovery requests apply the action once", async () => {
  const id = await ask(sup, "staff_group_change", ids.t1, { adminRole: "academic" });
  await setGroup(ids.sup, "finance"); // the requester loses authority: the first run is refused, nothing changed
  assert.equal((await body<{ executed: boolean }>(await approve(sup2, id))).executed, false);
  await setGroup(ids.sup, "super");
  const rs = await Promise.all([recover(sup2, id), recover(owner, id), recover(sup2, id), recover(owner, id)]);
  assert.equal(rs.filter((r) => r.status === 200).length, 1, (await Promise.all(rs.map((r) => r.clone().text()))).join(" | "));
  assert.equal(await audits("admin.group_assigned", id), 1);
  assert.equal((await fences(id)).length, 1);
  assert.equal(await groupOf(ids.t1), "academic");
  await setGroup(ids.t1, "support");
});

test("E2.7 a stale run whose outcome is unknown is reconciled, not blindly retried", async () => {
  // A run that committed, but whose request still reads "executing" (as if its response had been lost).
  const id = await ask(sup, "staff_group_change", ids.t1, { adminRole: "reporting" });
  assert.equal((await body<{ executed: boolean }>(await approve(sup2, id))).executed, true);
  const committedClaim = (await req(id)).execution_claim_id;
  await sql("UPDATE approval_requests SET execution_status = 'executing', execution_result = NULL, execution_claimed_at = '2026-11-01T00:00:00Z' WHERE id = ?1", id);
  await setGroup(ids.t1, "support"); // the target has since changed again, so a state check alone would re-run it
  const r = await body<{ executed: boolean; execution: { result: string } }>(await recover(sup2, id));
  assert.equal(r.executed, true);
  assert.match(r.execution.result, /already committed by the previous run/);
  assert.equal(await groupOf(ids.t1), "support", "not applied a second time");
  assert.equal(await audits("admin.group_assigned", id), 1);
  assert.equal(await n("audit_log WHERE action = 'approval.execution_reconciled' AND target_id = ?1 AND detail LIKE ?2", id, `%${committedClaim}%`), 1);
  // A run with no fence row and a fresh claim is never taken over.
  const id2 = await ask(sup, "staff_group_change", ids.t1, { adminRole: "faculty" });
  await sql("UPDATE approval_requests SET status = 'approved', execution_status = 'executing', execution_claim_id = 'someone-else', execution_claimed_at = ?2 WHERE id = ?1", id2, new Date().toISOString());
  await expectErr(recover(sup2, id2), 409, "execution_in_progress");
  assert.equal(await groupOf(ids.t1), "support");
  await sql("UPDATE approval_requests SET status = 'cancelled', execution_status = 'not_applicable' WHERE id = ?1", id2);
});

test("E2.8 a completed action stays completed and cannot be reclaimed", async () => {
  const [row] = await sql<{ id: string }>("SELECT id FROM approval_requests WHERE execution_status = 'completed' AND category = 'staff_group_change' LIMIT 1");
  const before = await req(row.id);
  await expectErr(recover(owner, row.id), 409, "already_completed");
  await expectErr(recover(sup2, row.id), 409);
  const after = await req(row.id);
  assert.deepEqual(after, before, "untouched");
});

test("E2.9 a policy withdrawn before recovery still prevents execution", async () => {
  const id = await ask(sup, "staff_group_change", ids.t1, { adminRole: "academic" });
  await setGroup(ids.sup, "finance");
  await approve(sup2, id); // refused: failed
  await setGroup(ids.sup, "super");
  await owner.json("PUT", "/api/app/owner/approval-policy", { ...RULES, categories: { ...RULES.categories, staff_group_change: { ...RULES.categories.staff_group_change, enabled: false } } });
  const attempts = (await req(id)).execution_attempts;
  await expectErr(recover(sup2, id), 409, "policy_withdrawn");
  assert.deepEqual([(await req(id)).execution_status, (await req(id)).execution_attempts, await groupOf(ids.t1)], ["failed", attempts, "support"], "not even claimed");
  await owner.json("PUT", "/api/app/owner/approval-policy", RULES);
  ids.failedGroup = id;
});

test("E2.10 requester and approver permissions are revalidated at recovery", async () => {
  await setGroup(ids.sup2, "finance");
  await expectErr(recover(sup2, ids.failedGroup), 404, undefined, "an approver who lost the group cannot act (or even see it)");
  await setGroup(ids.sup2, "super");
  await setGroup(ids.sup, "finance");
  const r = await body<{ executed: boolean; error: string }>(await recover(sup2, ids.failedGroup));
  assert.equal(r.executed, false, "the requester no longer has the authority");
  assert.match(r.error, /forbidden/);
  await setGroup(ids.sup, "super");
  assert.equal(await groupOf(ids.t1), "support");
  assert.equal((await fences(ids.failedGroup)).length, 0);
});

// ---------------------------------------------------------------- 11, 12 ----
test("E2.11 every executor keeps its safeguards (refused with nothing committed)", async () => {
  // Group change to Super Administrator: a Super approver lacks that authority.
  const g = await ask(sup, "staff_group_change", ids.t1, { adminRole: "reporting" });
  await sql("UPDATE approval_requests SET payload = ?2 WHERE id = ?1", g, JSON.stringify({ adminRole: "super", from: "support" }));
  const rg = await body<{ executed: boolean; error: string }>(await approve(sup2, g));
  assert.equal(rg.executed, false);
  assert.equal(await groupOf(ids.t1), "support");
  // Reinstatement of a permanently removed account.
  const gone = await mkUser("gone@example.com", "admin", "support");
  await owner.json("PATCH", `/api/app/admin/users/${gone}`, { status: "suspended", reason: "Leaving" });
  const ri = await ask(sup, "staff_reinstatement", gone);
  await owner.json("POST", `/api/app/owner/users/${gone}/remove`, { reason: "Left" });
  assert.equal((await body<{ executed: boolean }>(await approve(sup2, ri))).executed, false);
  assert.equal((await sql<{ status: string }>("SELECT status FROM users WHERE id = ?1", gone))[0].status, "suspended");
  // Head appointment into a department archived after the request.
  await owner.json("POST", "/api/app/admin/departments", { slug: "admissions", name: "Admissions" });
  const ha = await ask(sup, "department_head_appointment", ids.sup2, { departmentSlug: "admissions" });
  await owner.json("PATCH", "/api/app/admin/departments/admissions", { status: "archived", reason: "Merged" });
  assert.equal((await body<{ executed: boolean }>(await approve(owner, ha))).executed, false);
  assert.equal(await n("staff_assignments WHERE department_slug = 'admissions'"), 0);
  for (const id of [g, ri, ha]) {
    assert.equal((await req(id)).execution_status, "failed");
    assert.match((await req(id)).execution_result!, /^refused, nothing changed/);
    assert.equal((await fences(id)).length, 0);
  }
});

test("E2.12 payment release keeps verify-first and the confirmation requirement", async () => {
  const att = await uncertainAttempt();
  // Confirmation is still required before a request can even be made.
  await expectErr(fin.send("POST", `/api/app/admin/payments/attempts/${att}/release`, { reason: "Checked" }), 409, "confirm_required");
  const id = (await body<{ request: { id: string } }>(await fin.send("POST", `/api/app/admin/payments/attempts/${att}/release`, { reason: "Checked", confirmedWithPaystack: true }))).request.id;
  // Paystack now reports the payment as successful: it is recorded, and the approved release is refused.
  const [a] = await sql<{ reference: string; amount: number }>("SELECT a.reference, i.amount_kobo AS amount FROM payment_attempts a JOIN instalments i ON i.id = a.instalment_id WHERE a.id = ?1", att);
  verifyAnswer = () => Response.json({ status: true, message: "Verification successful", data: { id: 99001, status: "success", reference: a.reference, amount: a.amount, currency: "NGN", paid_at: new Date().toISOString() } });
  try {
    const r = await body<{ executed: boolean; error: string }>(await approve(owner, id));
    assert.equal(r.executed, false);
    assert.match(r.error, /paid_at_paystack/);
  } finally { verifyAnswer = () => Response.json({ status: false, message: "Transaction reference not found" }, { status: 400 }); }
  assert.notEqual((await attemptState(att)).state, "released", "never released");
  assert.equal((await sql<{ status: string }>("SELECT i.status FROM instalments i JOIN payment_attempts a ON a.instalment_id = i.id WHERE a.id = ?1", att))[0].status, "paid", "recorded through the existing path");
  assert.equal((await fences(id)).length, 0);
  // Release starts no payment: the only Paystack initialize calls are the students' own checkouts.
  assert.equal(w.calls.filter((c) => c.url.endsWith("/transaction/initialize")).length, payN);
});
