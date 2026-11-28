// Expansion Stage E.3: commit-time authorization and business-rule revalidation. No approved action may commit on
// authority or state that was read earlier and has since changed. Real requests to the real Worker (Miniflare) on an
// isolated database. Two deterministic ways of changing state after planning and before the commit:
//   (a) PAUSED: the payment-release plan calls Paystack (read-only verify) after its database reads; the test holds
//       that call, makes a real (persistent) change, then lets the run continue to its commit;
//   (b) IN-TRANSACTION: a trigger on the fence insert (the first statement of the commit transaction, which only runs
//       after planning has finished) makes the change inside the same transaction, just before the validation. Each
//       such test has a CONTROL with the same trigger making a harmless change, which commits: so the refusal is
//       caused by the change, and the race window is proven to be reached.
// Every approval rule is a test fixture. Paystack and email are mocked. Nothing is paid or sent.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker, SECRETS, registration } from "./worker-harness.ts";
import { signIn as helperSignIn, type Session } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";
import { accountChangeRefusal, adminMay, groupChangeRefusal } from "../src/server/lms/permissions.ts";
import { accountChangeAllowed, groupChangeAllowed, usersAreaWriter, Params } from "../src/server/lms/policy-sql.ts";

type W = Awaited<ReturnType<typeof startWorker>>;
let w: W;
let owner: Session, sup: Session, sup2: Session, fin: Session;
const ids: Record<string, string> = {};
const OWNER = "boss@example.com";

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
const n = async (s: string, ...a: unknown[]) => (await sql<{ n: number }>(`SELECT COUNT(*) AS n FROM ${s}`, ...a))[0].n;
const mkUser = async (email: string, role: string, adminRole?: string) =>
  (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email, role, adminRole, fullName: email.split("@")[0], sendInvite: false })).user.id;
const user = async (id: string) => (await sql<{ admin_role: string | null; status: string; removed_at: string | null }>("SELECT admin_role, status, removed_at FROM users WHERE id = ?1", id))[0];
const req = async (id: string) => (await sql<{ status: string; execution_status: string; execution_result: string | null; executed_at: string | null }>(
  "SELECT status, execution_status, execution_result, executed_at FROM approval_requests WHERE id = ?1", id))[0];
const fenceCount = (id: string) => n("execution_fences WHERE approval_id = ?1", id);
const auditCount = (action: string, like: string) => n("audit_log WHERE action = ?1 AND detail LIKE ?2", action, `%${like}%`);
const RULES = {
  categories: {
    staff_group_change: { enabled: true, approver: "super", expiresInHours: 48 },
    staff_reinstatement: { enabled: true, approver: "super", expiresInHours: 48 },
    department_head_appointment: { enabled: true, approver: "owner", expiresInHours: 48 },
  },
  paymentRelease: { enabled: true, approver: "super", expiresInHours: 24, allowedGroups: ["finance"], requiresApproval: true },
};
const ask = async (s: Session, category: string, targetId: string, payload: Record<string, unknown> = {}) =>
  (await s.json<{ request: { id: string } }>("POST", "/api/app/admin/approvals", { category, targetId, payload, reason: "Needed" })).request.id;
const approve = (s: Session, id: string) => s.send("POST", `/api/app/admin/approvals/${id}/decision`, { decision: "approve" });

// The common "nothing happened" assertions for an approved request that failed its commit-time validation.
async function assertNothingCommitted(id: string, r: { executed: boolean; error?: string }, code?: string) {
  assert.equal(r.executed, false);
  if (code) assert.match(r.error ?? "", new RegExp(`^${code}`), r.error);
  const q = await req(id);
  assert.equal(q.status, "approved", "the decision is preserved");
  assert.equal(q.execution_status, "failed", "never a false completed");
  assert.equal(q.executed_at, null);
  assert.match(q.execution_result!, /nothing (changed|committed)/);
  assert.equal(await fenceCount(id), 0, "no fence row: the commit transaction rolled back");
  assert.equal(await n("audit_log WHERE action = 'approval.executed' AND target_id = ?1", id), 0, "no success audit");
}

// (b) A change made inside the commit transaction, at its first statement, after planning.
async function withFenceTrigger<T>(sqlBody: string, fn: () => Promise<T>): Promise<T> {
  await exec(`CREATE TRIGGER t_race BEFORE INSERT ON execution_fences BEGIN ${sqlBody} END`);
  try { return await fn(); } finally { await exec("DROP TRIGGER IF EXISTS t_race"); }
}

let payN = 0;
async function uncertainAttempt() {
  const b = registration({ programme: "cloud", method: "paystack", idempotencyKey: crypto.randomUUID(), learner: { ...registration().learner, email: `e3payer${++payN}@example.com`, country: "Nigeria", countryCode: "NG" } });
  await reset();
  await w.post("/api/register", b);
  return (await sql<{ id: string }>("SELECT a.id FROM payment_attempts a JOIN orders o ON o.id = a.order_id WHERE o.idempotency_key = ?1", b.idempotencyKey))[0].id;
}
const attempt = async (id: string) => (await sql<{ state: string; instalment_id: string }>("SELECT state, instalment_id FROM payment_attempts WHERE id = ?1", id))[0];
async function releaseRequest() {
  const att = await uncertainAttempt();
  const r = await fin.send("POST", `/api/app/admin/payments/attempts/${att}/release`, { reason: "Checked in the dashboard", confirmedWithPaystack: true });
  assert.equal(r.status, 202, await r.clone().text());
  return { att, id: (await body<{ request: { id: string } }>(r)).request.id };
}
// (a) Approves a release, holds its Paystack call (after the plan's database reads), runs `change`, then resumes.
async function approveReleaseWith(id: string, change: () => Promise<unknown>) {
  armHold();
  const pending = approve(sup2, id);
  for (let i = 0; i < 300 && !hold.reached; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(hold.reached, "the run is paused after planning reads, before its commit");
  assert.equal((await req(id)).execution_status, "executing");
  await change();
  hold.open!();
  return body<{ executed: boolean; error?: string }>(await pending);
}

before(async () => {
  w = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString("base64") }, mock: async (rq) => {
    const u = new URL(rq.url);
    if (u.host === "api.paystack.co" && u.pathname === "/transaction/initialize") throw new TypeError("network connection lost");
    if (u.host === "api.paystack.co" && u.pathname.startsWith("/transaction/verify/")) {
      if (hold.armed) { hold.armed = false; hold.reached = true; await hold.wait; }
      return Response.json({ status: false, message: "Transaction reference not found" }, { status: 400 });
    }
    return undefined;
  } });
  owner = await strong(OWNER);
  await owner.json("POST", "/api/app/owner/bootstrap");
  ids.owner = (await sql<{ id: string }>("SELECT id FROM users WHERE email = ?1", OWNER))[0].id;
  ids.sup = await mkUser("sup@example.com", "admin", "super");
  ids.sup2 = await mkUser("sup2@example.com", "admin", "super");
  ids.fin = await mkUser("fin@example.com", "admin", "finance");
  ids.t1 = await mkUser("t1@example.com", "admin", "support");
  ids.t2 = await mkUser("t2@example.com", "admin", "support");
  ids.t3 = await mkUser("t3@example.com", "instructor");
  sup = await strong("sup@example.com");
  sup2 = await strong("sup2@example.com");
  fin = await strong("fin@example.com");
  await owner.json("POST", "/api/app/admin/departments", { slug: "support", name: "Student Support" });
  await owner.json("POST", "/api/app/admin/departments", { slug: "academic", name: "Academic Administration" });
  await owner.json("PUT", "/api/app/owner/approval-policy", RULES);
});
after(async () => { await w.dispose(); });

// ================================================================ (a) paused, persistent changes: payment release ====
test("E3.1 approver loses the required group after planning: no release (paused interleaving)", async () => {
  const { att, id } = await releaseRequest();
  const r = await approveReleaseWith(id, () => sql("UPDATE users SET admin_role = 'finance' WHERE id = ?1", ids.sup2));
  await sql("UPDATE users SET admin_role = 'super' WHERE id = ?1", ids.sup2);
  await assertNothingCommitted(id, r, "commit_refused:approver_authority");
  assert.equal((await attempt(att)).state, "uncertain", "not released");
  assert.equal(await auditCount("payment.attempt_release", id), 0);
});

test("E3.2 approver is suspended after planning: no release", async () => {
  const { att, id } = await releaseRequest();
  const r = await approveReleaseWith(id, () => sql("UPDATE users SET status = 'suspended' WHERE id = ?1", ids.sup2));
  await sql("UPDATE users SET status = 'active' WHERE id = ?1", ids.sup2);
  await assertNothingCommitted(id, r, "commit_refused:approver_authority");
  assert.equal((await attempt(att)).state, "uncertain");
  assert.equal(await auditCount("payment.attempt_release", id), 0);
});

test("E3.3 requester leaves the authorised group after planning: no release", async () => {
  const { att, id } = await releaseRequest();
  const r = await approveReleaseWith(id, () => sql("UPDATE users SET admin_role = 'support' WHERE id = ?1", ids.fin));
  await sql("UPDATE users SET admin_role = 'finance' WHERE id = ?1", ids.fin);
  await assertNothingCommitted(id, r, "commit_refused:requester_authority");
  assert.equal((await attempt(att)).state, "uncertain");
});

test("E3.7 the instalment is paid after planning: no release", async () => {
  const { att, id } = await releaseRequest();
  const inst = (await attempt(att)).instalment_id;
  const r = await approveReleaseWith(id, () => sql("UPDATE instalments SET status = 'paid' WHERE id = ?1", inst));
  await assertNothingCommitted(id, r, "commit_refused:instalment_unpaid");
  assert.equal((await attempt(att)).state, "uncertain", "a paid part is never released");
  assert.equal(await auditCount("payment.attempt_release", id), 0);
});

test("E3.8 the attempt becomes ineligible after planning (resolved elsewhere, or a fresh claim): no release", async () => {
  const a = await releaseRequest();
  const r = await approveReleaseWith(a.id, () => sql("UPDATE payment_attempts SET state = 'failed' WHERE id = ?1", a.att));
  await assertNothingCommitted(a.id, r, "commit_refused:attempt_releasable");
  assert.equal((await attempt(a.att)).state, "failed", "untouched by the release");
  const b = await releaseRequest();
  const r2 = await approveReleaseWith(b.id, () => sql("UPDATE payment_attempts SET state = 'claimed', claimed_at = ?2 WHERE id = ?1", b.att, new Date().toISOString()));
  await assertNothingCommitted(b.id, r2, "commit_refused:attempt_releasable");
  assert.equal((await attempt(b.att)).state, "claimed", "an attempt in progress is not released");
});

test("E3.policy the owner switches release off after planning: no release", async () => {
  const { att, id } = await releaseRequest();
  const r = await approveReleaseWith(id, () => owner.json("PUT", "/api/app/owner/approval-policy", { ...RULES, paymentRelease: { ...RULES.paymentRelease, enabled: false } }));
  await owner.json("PUT", "/api/app/owner/approval-policy", RULES);
  await assertNothingCommitted(id, r, "commit_refused:policy_enabled");
  assert.equal((await attempt(att)).state, "uncertain");
});

test("E3.9 a valid approver with unchanged authority still releases (paused, nothing changed)", async () => {
  const { att, id } = await releaseRequest();
  const r = await approveReleaseWith(id, async () => undefined);
  assert.equal(r.executed, true);
  assert.equal((await attempt(att)).state, "released");
  assert.equal(await fenceCount(id), 1);
  assert.equal(await auditCount("payment.attempt_release", id), 1);
  assert.equal((await req(id)).execution_status, "completed");
});

// ================================================================ (b) in-transaction changes, with controls ====
test("E3.10 control: valid requester and approver complete a group change with the race trigger in place (harmless change)", async () => {
  const id = await ask(sup, "staff_group_change", ids.t1, { adminRole: "reporting" });
  const r = await withFenceTrigger(`UPDATE users SET admin_role = admin_role WHERE id = '${ids.sup2}';`, async () => body<{ executed: boolean }>(await approve(sup2, id)));
  assert.equal(r.executed, true, "the trigger fires inside the commit and, when harmless, the commit succeeds");
  assert.equal((await user(ids.t1)).admin_role, "reporting");
  assert.equal(await fenceCount(id), 1);
  await sql("UPDATE users SET admin_role = 'support' WHERE id = ?1", ids.t1);
});

test("E3.1b/2b/3b group change: approver demoted, approver suspended or requester demoted inside the commit: no change, sessions kept", async () => {
  for (const [label, change] of [
    ["approver demoted", `UPDATE users SET admin_role = 'finance' WHERE id = '${ids.sup2}';`],
    ["approver suspended", `UPDATE users SET status = 'suspended' WHERE id = '${ids.sup2}';`],
    ["requester demoted", `UPDATE users SET admin_role = 'finance' WHERE id = '${ids.sup}';`],
    ["requester removed", `UPDATE users SET removed_at = '2026-11-28T00:00:00Z' WHERE id = '${ids.sup}';`],
  ] as const) {
    const t1 = await signIn("t1@example.com"); // a live session the action would end
    const id = await ask(sup, "staff_group_change", ids.t1, { adminRole: "academic" });
    const r = await withFenceTrigger(change, async () => body<{ executed: boolean; error?: string }>(await approve(sup2, id)));
    await assertNothingCommitted(id, r);
    assert.equal((await user(ids.t1)).admin_role, "support", `${label}: group unchanged`);
    assert.equal((await t1.get("/api/me")).status, 200, `${label}: the target's sessions were not ended`);
    assert.equal(await auditCount("admin.group_assigned", id), 0, `${label}: no action audit`);
    // The change itself was inside the rolled-back transaction: the database is as before.
    assert.deepEqual([(await user(ids.sup)).admin_role, (await user(ids.sup)).removed_at, (await user(ids.sup2)).admin_role, (await user(ids.sup2)).status], ["super", null, "super", "active"]);
  }
});

test("E3.4 target suspended or removed inside the commit: no group change, no reinstatement", async () => {
  const id = await ask(sup, "staff_group_change", ids.t1, { adminRole: "academic" });
  const r = await withFenceTrigger(`UPDATE users SET removed_at = '2026-11-28T00:00:00Z' WHERE id = '${ids.t1}';`, async () => body<{ executed: boolean }>(await approve(sup2, id)));
  await assertNothingCommitted(id, r);
  assert.equal((await user(ids.t1)).admin_role, "support");
  // Reinstatement: the target is removed (or no longer suspended) by the time of the commit.
  await owner.json("PATCH", `/api/app/admin/users/${ids.t2}`, { status: "suspended", reason: "Hold" });
  const ri = await ask(sup, "staff_reinstatement", ids.t2);
  const r2 = await withFenceTrigger(`UPDATE users SET removed_at = '2026-11-28T00:00:00Z' WHERE id = '${ids.t2}';`, async () => body<{ executed: boolean }>(await approve(sup2, ri)));
  await assertNothingCommitted(ri, r2);
  assert.deepEqual([(await user(ids.t2)).status, (await user(ids.t2)).removed_at], ["suspended", null]);
  assert.equal(await auditCount("staff.reinstated", ri), 0);
  // Approver suspended inside the commit: still suspended target; then the control commits.
  const r3 = await withFenceTrigger(`UPDATE users SET status = 'suspended' WHERE id = '${ids.sup2}';`, async () => body<{ executed: boolean }>(await (async () => {
    const ri2 = await ask(sup, "staff_reinstatement", ids.t2); ids.ri2 = ri2; return approve(sup2, ri2); })()));
  await assertNothingCommitted(ids.ri2, r3);
  assert.equal((await user(ids.t2)).status, "suspended");
  const ri3 = await ask(sup, "staff_reinstatement", ids.t2);
  const ok = await withFenceTrigger(`UPDATE users SET status = status WHERE id = '${ids.sup2}';`, async () => body<{ executed: boolean }>(await approve(sup2, ri3)));
  assert.equal(ok.executed, true, "control");
  assert.equal((await user(ids.t2)).status, "active");
});

test("E3.5 department archived inside the commit: no headship ended, none created", async () => {
  await owner.json("POST", "/api/app/admin/departments/support/members", { userId: ids.t2, position: "head", reason: "First head" });
  const id = await ask(sup, "department_head_appointment", ids.t1, { departmentSlug: "support" });
  const r = await withFenceTrigger("UPDATE departments SET status = 'archived' WHERE slug = 'support';", async () => body<{ executed: boolean }>(await approve(owner, id)));
  await assertNothingCommitted(id, r);
  const heads = await sql<{ user_id: string; ended_at: string | null }>("SELECT user_id, ended_at FROM staff_assignments WHERE department_slug = 'support' AND position = 'head'");
  assert.deepEqual(heads.map((h) => [h.user_id, h.ended_at]), [[ids.t2, null]], "the old headship was not ended and no new one exists");
  assert.equal(await n("staff_assignments WHERE user_id = ?1", ids.t1), 0);
  assert.equal(await auditCount("staff.head_appointed", id) + await auditCount("staff.head_replaced", id), 0);
  assert.equal((await sql<{ status: string }>("SELECT status FROM departments WHERE slug = 'support'"))[0].status, "active");
  ids.headReq = id;
});

test("E3.6 headship or membership changed inside the commit: the stale plan cannot make an invalid appointment", async () => {
  // The planned head to replace is no longer the head (ended in the meantime).
  const head = (await sql<{ id: string }>("SELECT id FROM staff_assignments WHERE department_slug = 'support' AND position = 'head' AND ended_at IS NULL"))[0].id;
  const a = await ask(sup, "department_head_appointment", ids.t3, { departmentSlug: "support" });
  const r = await withFenceTrigger(`UPDATE staff_assignments SET ended_at = '2026-11-28T00:00:00Z', end_reason = 'race' WHERE id = '${head}';`, async () => body<{ executed: boolean }>(await approve(owner, a)));
  await assertNothingCommitted(a, r);
  assert.equal((await sql<{ ended_at: string | null }>("SELECT ended_at FROM staff_assignments WHERE id = ?1", head))[0].ended_at, null);
  assert.equal(await n("staff_assignments WHERE user_id = ?1", ids.t3), 0);
  // The person joined another department in the meantime (one department per person by policy).
  const b = await ask(sup, "department_head_appointment", ids.t3, { departmentSlug: "support" });
  const r2 = await withFenceTrigger(`INSERT INTO staff_assignments (id, user_id, department_slug, position, reason, created_at, created_by) VALUES ('race-m', '${ids.t3}', 'academic', 'staff', 'race', '2026-11-28T00:00:00Z', '${ids.owner}');`,
    async () => body<{ executed: boolean }>(await approve(owner, b)));
  await assertNothingCommitted(b, r2);
  assert.equal(await n("staff_assignments WHERE user_id = ?1", ids.t3), 0, "neither the racing membership (rolled back with it) nor the headship");
  assert.equal((await sql<{ user_id: string }>("SELECT user_id FROM staff_assignments WHERE department_slug = 'support' AND position = 'head' AND ended_at IS NULL"))[0].user_id, ids.t2);
  // Control: the same trigger point with a harmless change lets a valid appointment through.
  const c = await ask(sup, "department_head_appointment", ids.t3, { departmentSlug: "support" });
  const ok = await withFenceTrigger("UPDATE departments SET status = status WHERE slug = 'support';", async () => body<{ executed: boolean }>(await approve(owner, c)));
  assert.equal(ok.executed, true);
  assert.deepEqual((await sql<{ user_id: string }>("SELECT user_id FROM staff_assignments WHERE department_slug = 'support' AND position = 'head' AND ended_at IS NULL")).map((x) => x.user_id), [ids.t3]);
});

test("E3.11 a superseded claim cannot commit even when every authorization check is valid", async () => {
  const id = await ask(sup, "staff_group_change", ids.t1, { adminRole: "reporting" });
  await exec(`CREATE TRIGGER t_supersede AFTER INSERT ON audit_log WHEN NEW.action = 'approval.execution_started' AND NEW.target_id = '${id}' BEGIN UPDATE approval_requests SET execution_claim_id = 'newer-' || NEW.id, execution_claimed_at = NEW.at WHERE id = NEW.target_id; END`);
  let r: { executed: boolean; execution: { status: string } };
  try { r = await body(await approve(sup2, id)); } finally { await exec("DROP TRIGGER IF EXISTS t_supersede"); }
  assert.deepEqual([r.executed, r.execution.status], [false, "superseded"]);
  assert.equal((await user(ids.t1)).admin_role, "support");
  assert.equal(await fenceCount(id), 0);
  assert.equal(await auditCount("admin.group_assigned", id), 0);
  assert.equal(await n("audit_log WHERE action = 'approval.execution_superseded' AND target_id = ?1 AND detail LIKE '%\"at\":\"commit\"%'", id), 1, "it reached the commit with valid authority and was stopped by the fence");
});

test("E3.12 a refused commit leaves no partial action anywhere (multi-statement head appointment, checked statement by statement)", async () => {
  // The head request from E3.5 failed at commit. Its plan had four statements: end the old headship, its audit,
  // create the new headship, its audit. None of them is present, and nothing claims completion.
  const id = ids.headReq;
  assert.equal((await req(id)).execution_status, "failed");
  assert.equal(await n("staff_assignments WHERE end_reason LIKE ?1", `%approval ${id}%`), 0);
  assert.equal(await n("staff_assignments WHERE reason LIKE ?1", `%approval ${id}%`), 0);
  assert.equal(await n("audit_log WHERE detail LIKE ?1 AND action IN ('staff.head_replaced', 'staff.head_appointed', 'approval.executed')", `%${id}%`), 0);
  assert.equal(await n("audit_log WHERE action = 'approval.execution_failed' AND target_id = ?1", id), 1, "the failure is recorded, once");
});

// ================================================================ the SQL predicates match the JavaScript rules ====
test("E3.parity commit-time SQL predicates agree with groupChangeRefusal, accountChangeRefusal and adminMay on a matrix of cases", async () => {
  const db = await w.db();
  const people: Record<string, { role: string; admin_role: string | null; status: string; removed_at: string | null }> = {
    "m-super": { role: "admin", admin_role: "super", status: "active", removed_at: null },
    "m-super2": { role: "admin", admin_role: "super", status: "active", removed_at: null },
    "m-fin": { role: "admin", admin_role: "finance", status: "active", removed_at: null },
    "m-rep": { role: "admin", admin_role: "reporting", status: "active", removed_at: null },
    "m-legacy": { role: "admin", admin_role: null, status: "active", removed_at: null },
    "m-gone": { role: "admin", admin_role: "support", status: "suspended", removed_at: "2026-11-01T00:00:00Z" },
    "m-ins": { role: "instructor", admin_role: null, status: "active", removed_at: null },
    "m-stu": { role: "student", admin_role: null, status: "active", removed_at: null },
  };
  for (const [id, p] of Object.entries(people))
    await db.prepare("INSERT INTO users (id, email, role, status, full_name, created_at, admin_role, removed_at) VALUES (?1, ?2, ?3, ?4, ?1, '2026-11-28', ?5, ?6)").bind(id, `${id}@example.com`, p.role, p.status, p.admin_role, p.removed_at).run();
  const who = (id: string) => id === ids.owner ? { id, email: OWNER, role: "admin", status: "active", admin_role: null, removed_at: null } : { id, email: `${id}@example.com`, ...people[id] };
  const ownerRef = { ownerId: ids.owner };
  const everyone = [ids.owner, ...Object.keys(people)];
  const probe = async (build: (ps: Params) => string) => { const ps = new Params(1); const s = build(ps); return ((await db.prepare(`SELECT CASE WHEN (${s}) THEN 1 ELSE 0 END AS ok`).bind(...ps.vals).first<{ ok: number }>())!.ok) === 1; };
  let cases = 0;
  for (const restrict of [false, true]) {
    await db.prepare("INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('owner_policy', ?1, '2026-11-28', 'test') ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ restrictUnassigned: restrict })).run();
    for (const a of everyone) {
      const effective = who(a).role !== "admin" ? null : who(a).admin_role ?? (a !== ids.owner && restrict ? "reporting" : null);
      assert.equal(await probe((ps) => usersAreaWriter(ps, a, OWNER)), who(a).role === "admin" && adminMay(effective, "PATCH", "/api/app/admin/users/:id", a === ids.owner), `usersAreaWriter ${a} restrict=${restrict}`);
      cases++;
      for (const t of everyone) {
        assert.equal(await probe((ps) => accountChangeAllowed(ps, a, t, OWNER)), accountChangeRefusal(who(a), who(t), ownerRef, true) === null, `accountChange ${a} -> ${t}`);
        for (const next of ["finance", "super"]) {
          assert.equal(await probe((ps) => groupChangeAllowed(ps, a, t, next, OWNER)), groupChangeRefusal(who(a), who(t), next, ownerRef, true) === null, `groupChange ${a} -> ${t} (${next})`);
          cases++;
        }
        cases++;
      }
    }
  }
  assert.ok(cases > 300, `${cases} cases compared`);
});
