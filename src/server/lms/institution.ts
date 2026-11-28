// Institutional rules (Expansion Stage E): owner policies, the approval framework and its executors.
//
// Authority comes ONLY from what already enforces it: the owner (owner_record), administrator groups (admin_role, with
// default-deny areas in permissions.ts) and the authenticator code for sensitive actions. Departments and department
// headship are organisational: they grant no permission by themselves. Every policy below starts OFF / owner-only; the
// owner switches things on. Nothing here grants access that did not exist before Stage E.
import { ApiError, nowIso } from "../http";
import type { Ctx } from "./api";
import { getSetting, putSetting } from "./data/engagement";
import { auditStmt, deleteUserSessionsStmt, getUser, reinstateStmt, setAdminRoleStmt } from "./data/users";
import { claimExecution, completeStmt, createApproval, validateStmt, createAssignmentStmt, currentHead, effectStmt, endAssignmentStmt, fenceFor, fenceStmt, getApproval, getDepartment, recordOutcome, userAssignments, type ApprovalRequest } from "./data/institution";
import { batch } from "./data/base";
import { Repo } from "../repo";
import { accountChangeRefusal, adminMay, groupChangeRefusal, isAdminRole, isOwner, isSuper, ownerEmail, type AdminRole } from "./permissions";
import { getOwnerPolicy, isBootstrapped } from "./data/owner";
import { commonConditions, groupChangeConditions, headConditions, probeSql, reinstatementConditions, validationSql, type Cond } from "./policy-sql";
import { planRelease } from "./payment-release";

// ---------- owner policies ----------
export type InstitutionPolicy = {
  superMayManageDepartments: boolean; // create, rename, archive departments
  superMayAssignStaff: boolean;       // add or end ordinary (non-head) department membership
  superMayAppointHeads: boolean;      // appoint or replace a department head directly
  multipleDepartments: boolean;       // may one person belong to more than one department
};
export const DEFAULT_INSTITUTION: InstitutionPolicy = { superMayManageDepartments: false, superMayAssignStaff: false, superMayAppointHeads: false, multipleDepartments: false };
export const getInstitutionPolicy = async (db: D1Database): Promise<InstitutionPolicy> => ({ ...DEFAULT_INSTITUTION, ...((await getSetting<Partial<InstitutionPolicy>>(db, "institution_policy")) ?? {}) });
export const saveInstitutionPolicy = (db: D1Database, p: InstitutionPolicy, by: string) => putSetting(db, "institution_policy", p, by, nowIso());

// Approval categories. Only those with an executor can be switched on; the others were evaluated and are documented
// as needing an owner policy and an executor first (see the Stage E report).
export const EXECUTABLE = ["staff_group_change", "staff_reinstatement", "department_head_appointment", "payment_attempt_release"] as const;
export const EVALUATED_ONLY = ["sensitive_academic_override", "financial_adjustment", "exceptional_admission", "sensitive_data_access"] as const;
export type Category = (typeof EXECUTABLE)[number];
export type CategoryRule = { enabled: boolean; approver: "owner" | "super"; expiresInHours: number };
// Paystack release (Stage D.1.1 safeguard): disabled for EVERYONE until the owner names who may release and whether a
// second person must approve. allowedGroups lists administrator groups ("super" is not implied).
export type PaymentReleaseRule = CategoryRule & { allowedGroups: AdminRole[]; requiresApproval: boolean };
export type ApprovalPolicy = { categories: Partial<Record<Exclude<Category, "payment_attempt_release">, CategoryRule>>; paymentRelease: PaymentReleaseRule | null };
export const DEFAULT_APPROVALS: ApprovalPolicy = { categories: {}, paymentRelease: null };
export const getApprovalPolicy = async (db: D1Database): Promise<ApprovalPolicy> => {
  const v = await getSetting<Partial<ApprovalPolicy>>(db, "approval_policy");
  return { categories: v?.categories ?? {}, paymentRelease: v?.paymentRelease ?? null };
};
export const saveApprovalPolicy = (db: D1Database, p: ApprovalPolicy, by: string) => putSetting(db, "approval_policy", p, by, nowIso());
export async function ruleFor(db: D1Database, cat: Category): Promise<CategoryRule | null> {
  const p = await getApprovalPolicy(db);
  const r = cat === "payment_attempt_release" ? p.paymentRelease : p.categories[cat];
  return r && r.enabled ? r : null;
}

// ---------- approver eligibility (server-side; never the requester) ----------
export function mayDecide(c: Ctx, r: ApprovalRequest): string | null {
  if (r.requested_by === c.user.id) return "Nobody can approve their own request.";
  if (r.target_type === "user" && r.target_id === c.user.id) return "Nobody can approve a change to their own access.";
  if (r.approver === "owner" && !c.isOwner) return "This request needs the owner's decision.";
  if (r.approver === "super" && !c.isOwner && !isSuper(c.user)) return "This request needs a Super Administrator or the owner.";
  return null;
}

// ---------- executors: run ONLY after approval, re-checking every rule with the approver's authority ----------
// Stage E.2: an executor no longer writes anything. It checks (reads only; for payment release, also the read-only
// Paystack verification) and returns a PLAN: the action's statements, its audit records, and an SQL condition that
// is true only when the action's intended result is in place. executeApproved() commits the plan in ONE D1 batch (one
// transaction) behind the run's fence, so a superseded run cannot commit any part of it.
// Stage E.3: `conditions` are the plan's commit-time rules (policy-sql.ts), evaluated inside the same transaction.
export type Plan = { stmts: D1PreparedStatement[]; effect: { sql: string; binds: (string | number | null)[] }; result: string; conditions: Cond[] };
const activeAccount = (u: { status: string; removed_at?: string | null } | null | undefined) => !!u && u.status === "active" && !u.removed_at;
type Exec = (c: Ctx, r: ApprovalRequest, payload: Record<string, unknown>, claimId: string) => Promise<Plan>;
const via = (c: Ctx, r: ApprovalRequest, claimId: string) => ({ authority: "approval", approvalRequest: r.id, requestedBy: r.requested_by, approvedBy: c.user.id, claim: claimId, attempt: r.execution_attempts });
const EXECUTORS: Record<Category, Exec> = {
  async staff_group_change(c, r, p, claimId) {
    const target = await getUser(c.db, r.target_id);
    if (!target) throw new ApiError(404, "not_found", "That staff member no longer exists.");
    const next = String(p.adminRole ?? "");
    if (!isAdminRole(next)) throw new ApiError(400, "invalid", "Unknown administrator group.");
    const booted = await isBootstrapped(c.db);
    // Both the requester and the approver must have had the authority for this change.
    const requester = await getUser(c.db, r.requested_by);
    const why = (requester ? groupChangeRefusal(requester, target, next, c.owner, booted) : "The requester no longer exists.") ?? groupChangeRefusal(c.user, target, next, c.owner, booted)
      ?? (activeAccount(requester) ? null : "The person who asked no longer has an active account.");
    if (why) throw new ApiError(403, "forbidden", why);
    return {
      conditions: groupChangeConditions({ approverId: c.user.id, requesterId: r.requested_by, targetId: target.id, next, ownerEmail: ownerEmail(c.env) }),
      stmts: [setAdminRoleStmt(c.db, target.id, next), deleteUserSessionsStmt(c.db, target.id),
        auditStmt(c.db, { actor_id: c.user.id, action: "admin.group_assigned", target_type: "user", target_id: target.id, ip_hash: c.ipHash,
          detail: { from: target.admin_role ?? null, to: next, reason: r.reason, ...via(c, r, claimId) } })],
      effect: { sql: "SELECT 1 FROM users WHERE id = ?2 AND admin_role = ?3", binds: [target.id, next] },
      result: `group changed from ${target.admin_role ?? "none"} to ${next}`,
    };
  },
  async staff_reinstatement(c, r, _p, claimId) {
    const target = await getUser(c.db, r.target_id);
    if (!target) throw new ApiError(404, "not_found", "That staff member no longer exists.");
    if (target.status !== "suspended") throw new ApiError(409, "not_suspended", "This account is not suspended.");
    const booted = await isBootstrapped(c.db);
    if (!["admin", "instructor"].includes(target.role) || target.removed_at) throw new ApiError(409, "not_staff", "This is not a suspended staff account.");
    // The requester's authority, as required when the request was made (the "users" area and accountChangeRefusal).
    const requester = await getUser(c.db, r.requested_by);
    const reqGroup = requester?.role !== "admin" ? null : (requester.admin_role ?? ((await getOwnerPolicy(c.db)).restrictUnassigned ? "reporting" : null));
    const reqWhy = !requester || !activeAccount(requester) ? "The person who asked no longer has an active account."
      : !adminMay(reqGroup, "PATCH", "/api/app/admin/users/:id", isOwner(requester, c.owner)) ? "The person who asked can no longer change accounts."
      : accountChangeRefusal(requester, target, c.owner, booted);
    const why = reqWhy ?? accountChangeRefusal(c.user, target, c.owner, booted);
    if (why) throw new ApiError(403, "forbidden", why);
    return {
      conditions: reinstatementConditions({ approverId: c.user.id, requesterId: r.requested_by, targetId: target.id, ownerEmail: ownerEmail(c.env) }),
      stmts: [reinstateStmt(c.db, target.id),
        auditStmt(c.db, { actor_id: c.user.id, action: "staff.reinstated", target_type: "user", target_id: target.id, ip_hash: c.ipHash,
          detail: { from: "suspended", to: "active", reason: r.reason, ...via(c, r, claimId) } })],
      effect: { sql: "SELECT 1 FROM users WHERE id = ?2 AND status = 'active' AND removed_at IS NULL", binds: [target.id] },
      result: "account reactivated",
    };
  },
  async department_head_appointment(c, r, p, claimId) {
    const slug = String(p.departmentSlug ?? "");
    const dept = await getDepartment(c.db, slug);
    if (!dept || dept.status !== "active") throw new ApiError(404, "not_found", "That department is not active.");
    const requester = await getUser(c.db, r.requested_by);
    if (!requester || !isSuper(requester) || !activeAccount(requester)) throw new ApiError(403, "forbidden", "The person who asked is no longer an active Super Administrator.");
    const h = await planHead(c, slug, r.target_id, `${r.reason} (approval ${r.id})`, via(c, r, claimId));
    return { stmts: h.stmts,
      conditions: headConditions({ requesterId: r.requested_by, targetId: r.target_id, slug, currentHeadAssignment: h.currentHead, targetAssignments: h.targetAssignments,
        needsMultiple: h.needsMultiple, ownerEmail: ownerEmail(c.env) }), effect: { sql: "SELECT 1 FROM staff_assignments WHERE id = ?2 AND position = 'head' AND ended_at IS NULL", binds: [h.id] }, result: `head of ${dept.name} appointed` };
  },
  async payment_attempt_release(c, r, p, claimId) {
    const rule = (await getApprovalPolicy(c.db)).paymentRelease;
    const requester = await getUser(c.db, r.requested_by);
    if (!requester || !activeAccount(requester) || requester.role !== "admin" || !(rule?.allowedGroups as string[] | undefined)?.includes(requester.admin_role ?? ""))
      throw new ApiError(403, "forbidden", "The person who asked is no longer in a group the owner authorised to release payment attempts.");
    return planRelease(c, r.target_id, { reason: r.reason, confirmedWithPaystack: p.confirmedWithPaystack === true, releasedBy: r.requested_by, approvedBy: c.user.id, approvalRequest: r.id, claimId });
  },
};
export const executorFor = (cat: string): Exec | null => (EXECUTABLE as readonly string[]).includes(cat) ? EXECUTORS[cat as Category] : null;

// ---------- department membership ----------
export async function assertAssignable(c: Ctx, userId: string) {
  const u = await getUser(c.db, userId);
  if (!u || u.removed_at || !["admin", "instructor"].includes(u.role)) throw new ApiError(400, "invalid", "Departments are for active staff (administrators and instructors).");
  if (u.status !== "active") throw new ApiError(400, "inactive", "This staff member is not active.");
  if (isOwner(u, c.owner)) throw new ApiError(400, "invalid", "The owner stands above the departments and is not assigned to one.");
  return u;
}
export async function assertOneDepartment(c: Ctx, userId: string, slug: string) {
  const mine = await userAssignments(c.db, userId);
  if (mine.some((a) => a.department_slug === slug)) throw new ApiError(409, "exists", "This person already belongs to that department.");
  if (mine.length && !(await getInstitutionPolicy(c.db)).multipleDepartments)
    throw new ApiError(409, "one_department", "This person already belongs to another department. Belonging to several departments needs the owner's policy.");
}
// Plans a head appointment: ends the current head's headship (their record is kept) and the person's ordinary
// membership of the same department, then creates the headship, with audit records. Caller has checked authority.
export async function planHead(c: Ctx, slug: string, userId: string, reason: string, viaInfo: Record<string, unknown>) {
  await assertAssignable(c, userId);
  const at = nowIso();
  const current = await currentHead(c.db, slug);
  if (current?.user_id === userId) throw new ApiError(409, "exists", "This person already heads that department.");
  // The new head must not already belong to another department unless the policy allows it.
  const mine = await userAssignments(c.db, userId);
  const elsewhere = mine.filter((a) => a.department_slug !== slug);
  if (elsewhere.length && !(await getInstitutionPolicy(c.db)).multipleDepartments)
    throw new ApiError(409, "one_department", "This person belongs to another department. Belonging to several departments needs the owner's policy.");
  const stmts: D1PreparedStatement[] = [];
  const audit = (action: string, target: string, detail: unknown) => auditStmt(c.db, { actor_id: c.user.id, action, target_type: "user", target_id: target, detail, ip_hash: c.ipHash });
  if (current) stmts.push(endAssignmentStmt(c.db, current.id, c.user.id, `replaced as head: ${reason}`, at), audit("staff.head_replaced", current.user_id, { department: slug, reason, ...viaInfo }));
  const sameDept = mine.find((a) => a.department_slug === slug);
  if (sameDept) stmts.push(endAssignmentStmt(c.db, sameDept.id, c.user.id, `became head: ${reason}`, at));
  const id = crypto.randomUUID();
  stmts.push(createAssignmentStmt(c.db, { id, user_id: userId, department_slug: slug, position: "head", reason, created_at: at, created_by: c.user.id }),
    audit("staff.head_appointed", userId, { department: slug, assignment: id, previousHead: current?.user_id ?? null, reason, ...viaInfo }));
  return { id, stmts, currentHead: current?.id ?? null, targetAssignments: mine.map((a) => a.id), needsMultiple: elsewhere.length > 0 };
}
// A direct appointment (the owner, or a Super Administrator the owner has authorised): the same plan, in one batch.
export async function appointHead(c: Ctx, slug: string, userId: string, reason: string) {
  const h = await planHead(c, slug, userId, reason, { authority: c.isOwner ? "owner_direct" : "delegated" });
  await batch(c.db, h.stmts);
  return h.id;
}

// ---------- opening a request (nothing executes here) ----------
export async function openApproval(c: Ctx, f: { category: Category; targetType: string; targetId: string; payload: Record<string, unknown>; reason: string; rule: CategoryRule }) {
  const at = nowIso();
  const hours = Math.min(24 * 30, Math.max(1, Math.round(f.rule.expiresInHours || 72)));
  const r: ApprovalRequest = { id: crypto.randomUUID(), category: f.category, target_type: f.targetType, target_id: f.targetId, payload: JSON.stringify(f.payload), reason: f.reason,
    requested_by: c.user.id, approver: f.rule.approver === "super" ? "super" : "owner", status: "pending", expires_at: new Date(Date.now() + hours * 3600_000).toISOString(),
    decided_by: null, decided_at: null, decision_comment: null, executed_at: null, execution_result: null, escalated_at: null, created_at: at, updated_at: at,
    execution_status: "not_applicable", execution_claimed_at: null, execution_claimed_by: null, execution_attempts: 0, execution_claim_id: null };
  try { await createApproval(c.db, r); }
  catch (e) {
    if (/UNIQUE/i.test(String(e))) throw new ApiError(409, "already_requested", "There is already a pending request for this. It must be decided or cancelled first.");
    throw e;
  }
  await c.audit("approval.requested", "approval_request", r.id, { category: r.category, target: r.target_id, approver: r.approver, expiresAt: r.expires_at, reason: r.reason, payload: f.payload });
  return r;
}

// ---------- execution (Stage E.1, fenced in Stage E.2) ----------
// Has the approved change already taken effect? Checked before every run, so a recovery never repeats a change that
// already happened: it records it instead.
async function alreadyApplied(c: Ctx, r: ApprovalRequest, p: Record<string, unknown>): Promise<boolean> {
  if (r.category === "staff_group_change") return (await getUser(c.db, r.target_id))?.admin_role === String(p.adminRole ?? "");
  if (r.category === "staff_reinstatement") { const t = await getUser(c.db, r.target_id); return !!t && t.status === "active" && !t.removed_at; }
  if (r.category === "department_head_appointment") return (await currentHead(c.db, String(p.departmentSlug ?? "")))?.user_id === r.target_id;
  if (r.category === "payment_attempt_release") return (await new Repo(c.db).getAttempt(r.target_id))?.state === "released";
  return false;
}
// A run claimed more than this long ago may be taken over by an explicit recovery. Safe because of the fence: taking
// over issues a new claim id, after which the earlier run can never commit (see executeApproved).
export const EXECUTION_STALE_MS = 120_000;
export type ExecutionOutcome = { executed: boolean; status: string; result: string; error?: string };
const isFence = (e: unknown, col: "owner_check" | "effect_check") => new RegExp(`NOT NULL constraint failed: execution_fences\\.${col}`).test(String((e as Error)?.message ?? e));

// Runs an approved request's action.
//  1. Claim: exactly one caller wins, with a NEW claim id (the fencing token).
//  2. Reconcile: a recovery first looks for a fence row of the previous run (proof its action committed) and checks
//     whether the change is already in effect; either way it records completion and changes nothing.
//  3. Check and plan: every rule is checked again with the acting approver's CURRENT authority (reads only).
//  4. Commit, as ONE D1 batch: [fence (aborts unless this run still owns the claim) → the action → effect check
//     (aborts unless the intended result is in place) → audit "executed" → status completed]. All or nothing.
//  5. Outcome: a definite refusal or a rolled-back batch is recorded as failed (nothing committed); a superseded run
//     records nothing over the newer run; an outcome that cannot be determined is left for reconciliation, never retried.
export async function executeApproved(c: Ctx, id: string, recovery: boolean): Promise<ExecutionOutcome> {
  const before = await getApproval(c.db, id);
  const at = nowIso();
  const claimId = crypto.randomUUID();
  const stale = recovery ? new Date(Date.now() - EXECUTION_STALE_MS).toISOString() : null;
  if (!(await claimExecution(c.db, id, c.user.id, at, stale, claimId))) {
    const now = await getApproval(c.db, id);
    if (now?.execution_status === "executing") throw new ApiError(409, "execution_in_progress", "This request is being carried out right now. Reload in a moment.");
    if (now?.execution_status === "completed") throw new ApiError(409, "already_completed", "This request has already been carried out.");
    throw new ApiError(409, "not_executable", `This request cannot be carried out (decision: ${now?.status ?? "unknown"}).`);
  }
  const r = (await getApproval(c.db, id))!;
  const payload = (() => { try { return JSON.parse(r.payload) as Record<string, unknown>; } catch { return {}; } })();
  const base = { category: r.category, target: r.target_id, attempt: r.execution_attempts, claim: claimId, recovery };
  await c.audit("approval.execution_started", "approval_request", id, { ...base, previousClaim: before?.execution_claim_id ?? null, previousStatus: before?.execution_status ?? null });
  const record = async (outcome: "completed" | "failed", result: string, action: string, detail: Record<string, unknown> = {}) => {
    return recordOutcome(c.db, id, claimId, outcome, result, nowIso(), { actor_id: c.user.id, action, detail: { ...base, result, ...detail }, ip_hash: c.ipHash });
  };
  const superseded = async (where: string): Promise<ExecutionOutcome> => {
    await c.audit("approval.execution_superseded", "approval_request", id, { ...base, at: where, committed: false });
    return { executed: false, status: "superseded", result: "a newer run took over; this run committed nothing" };
  };
  try {
    // 2. Reconcile.
    if (recovery && before?.execution_claim_id && (await fenceFor(c.db, before.execution_claim_id))) {
      const result = `already committed by the previous run (attempt ${before.execution_attempts}): no change made`;
      return (await record("completed", result, "approval.execution_reconciled", { previousClaim: before.execution_claim_id })) ? { executed: true, status: "completed", result } : superseded("reconcile");
    }
    if (await alreadyApplied(c, r, payload)) {
      const result = "already in effect: no change made";
      return (await record("completed", result, "approval.execution_reconciled")) ? { executed: true, status: "completed", result } : superseded("reconcile");
    }
    // 3. Check and plan.
    const exec = executorFor(r.category);
    if (!exec) throw new ApiError(409, "no_executor", "This kind of request has no executor.");
    const plan = await exec(c, r, payload, claimId);
    // Stage E.3: every rule the action depends on, re-evaluated inside the commit transaction (see policy-sql.ts).
    const conds = [...commonConditions({ approvalId: id, category: r.category, approverId: c.user.id, requesterId: r.requested_by, targetType: r.target_type, targetId: r.target_id,
      ownerEmail: ownerEmail(c.env) }), ...plan.conditions];
    // 4. Commit.
    const done = nowIso();
    try {
      await batch(c.db, [
        fenceStmt(c.db, claimId, id, done),
        validateStmt(c.db, claimId, validationSql(conds, 2)),
        ...plan.stmts,
        effectStmt(c.db, claimId, plan.effect.sql, ...plan.effect.binds),
        auditStmt(c.db, { actor_id: c.user.id, action: "approval.executed", target_type: "approval_request", target_id: id, ip_hash: c.ipHash, detail: { ...base, result: plan.result } }),
        completeStmt(c.db, id, claimId, plan.result, done),
      ]);
    } catch (e) {
      if (isFence(e, "owner_check")) return superseded("commit");
      if (isFence(e, "effect_check")) {
        // Rolled back by the commit-time validation or the effect check. Say which rule failed (a read, for the message only).
        for (const cond of conds) {
          const q = probeSql(cond);
          const ok = await c.db.prepare(q.sql).bind(...q.vals).first<{ ok: number }>().catch(() => null);
          if (ok && !ok.ok) throw new ApiError(409, `commit_refused:${cond.name}`, `${cond.message} Nothing was committed.`);
        }
        throw new ApiError(409, "target_changed", "The target changed while this was being carried out. Nothing was committed.");
      }
      // Anything else rolled the batch back, unless the error came after a commit (a lost response): the fence row
      // tells which. If even that cannot be read, the outcome is left for reconciliation.
      let committed: boolean | null = null;
      try { committed = !!(await fenceFor(c.db, claimId)); } catch { committed = null; }
      if (committed) return { executed: true, status: "completed", result: plan.result };
      if (committed === null) {
        await c.audit("approval.execution_uncertain", "approval_request", id, { ...base, error: String((e as Error)?.message ?? e).slice(0, 300) }).catch(() => undefined);
        return { executed: false, status: "executing", result: "outcome could not be confirmed; reconcile before any further run" };
      }
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      const result = `failed, nothing committed (${msg})`;
      if (!(await record("failed", result, "approval.execution_failed", { definite: true, rolledBack: true, error: msg }))) return superseded("rolled back");
      return { executed: false, status: "failed", result, error: msg };
    }
    return { executed: true, status: "completed", result: plan.result };
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    const msg = `${e.code}: ${e.message}`;
    const result = `refused, nothing changed (${msg})`;
    if (!(await record("failed", result, "approval.execution_failed", { definite: true, error: msg }))) return superseded("refusal");
    return { executed: false, status: "failed", result, error: msg };
  }
}
