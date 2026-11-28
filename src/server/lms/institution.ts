// Institutional rules (Expansion Stage E): owner policies, the approval framework and its executors.
//
// Authority comes ONLY from what already enforces it: the owner (owner_record), administrator groups (admin_role, with
// default-deny areas in permissions.ts) and the authenticator code for sensitive actions. Departments and department
// headship are organisational: they grant no permission by themselves. Every policy below starts OFF / owner-only; the
// owner switches things on. Nothing here grants access that did not exist before Stage E.
import { ApiError, nowIso } from "../http";
import type { Ctx } from "./api";
import { getSetting, putSetting } from "./data/engagement";
import { deleteUserSessions, getUser, setAdminRole, updateUser } from "./data/users";
import { createApproval, createAssignment, currentHead, endAssignment, getDepartment, userAssignments, type ApprovalRequest } from "./data/institution";
import { accountChangeRefusal, groupChangeRefusal, isAdminRole, isOwner, isSuper, type AdminRole } from "./permissions";
import { isBootstrapped } from "./data/owner";
import { releaseAttempt } from "./payment-release";

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
type Exec = (c: Ctx, r: ApprovalRequest, payload: Record<string, unknown>) => Promise<string>;
const EXECUTORS: Record<Category, Exec> = {
  async staff_group_change(c, r, p) {
    const target = await getUser(c.db, r.target_id);
    if (!target) throw new ApiError(404, "not_found", "That staff member no longer exists.");
    const next = String(p.adminRole ?? "");
    if (!isAdminRole(next)) throw new ApiError(400, "invalid", "Unknown administrator group.");
    const booted = await isBootstrapped(c.db);
    // Both the requester and the approver must have had the authority for this change.
    const requester = await getUser(c.db, r.requested_by);
    const why = (requester ? groupChangeRefusal(requester, target, next, c.owner, booted) : "The requester no longer exists.") ?? groupChangeRefusal(c.user, target, next, c.owner, booted);
    if (why) throw new ApiError(403, "forbidden", why);
    await setAdminRole(c.db, target.id, next as AdminRole);
    await deleteUserSessions(c.db, target.id);
    await c.audit("admin.group_assigned", "user", target.id, { from: target.admin_role ?? null, to: next, approvalRequest: r.id, requestedBy: r.requested_by, approvedBy: c.user.id, reason: r.reason });
    return `group changed from ${target.admin_role ?? "none"} to ${next}`;
  },
  async staff_reinstatement(c, r) {
    const target = await getUser(c.db, r.target_id);
    if (!target) throw new ApiError(404, "not_found", "That staff member no longer exists.");
    if (target.status !== "suspended") throw new ApiError(409, "not_suspended", "This account is not suspended.");
    const why = accountChangeRefusal(c.user, target, c.owner, await isBootstrapped(c.db));
    if (why) throw new ApiError(403, "forbidden", why);
    await updateUser(c.db, target.id, { status: "active" });
    await c.audit("staff.reinstated", "user", target.id, { from: "suspended", to: "active", approvalRequest: r.id, requestedBy: r.requested_by, approvedBy: c.user.id, reason: r.reason });
    return "account reactivated";
  },
  async department_head_appointment(c, r, p) {
    const slug = String(p.departmentSlug ?? "");
    const dept = await getDepartment(c.db, slug);
    if (!dept || dept.status !== "active") throw new ApiError(404, "not_found", "That department is not active.");
    await appointHead(c, slug, r.target_id, `${r.reason} (approval ${r.id})`);
    return `head of ${dept.name} appointed`;
  },
  async payment_attempt_release(c, r, p) {
    await releaseAttempt(c, r.target_id, { reason: r.reason, confirmedWithPaystack: p.confirmedWithPaystack === true, releasedBy: r.requested_by, approvedBy: c.user.id, approvalRequest: r.id });
    return "payment attempt released";
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
// Appoints a head, ending the current head's headship (their record is kept). Caller has checked authority.
export async function appointHead(c: Ctx, slug: string, userId: string, reason: string) {
  await assertAssignable(c, userId);
  const at = nowIso();
  const current = await currentHead(c.db, slug);
  if (current?.user_id === userId) throw new ApiError(409, "exists", "This person already heads that department.");
  // The new head must not already belong to another department unless the policy allows it.
  const mine = await userAssignments(c.db, userId);
  const elsewhere = mine.filter((a) => a.department_slug !== slug);
  if (elsewhere.length && !(await getInstitutionPolicy(c.db)).multipleDepartments)
    throw new ApiError(409, "one_department", "This person belongs to another department. Belonging to several departments needs the owner's policy.");
  if (current) {
    await endAssignment(c.db, current.id, c.user.id, `replaced as head: ${reason}`, at);
    await c.audit("staff.head_replaced", "user", current.user_id, { department: slug, reason });
  }
  const sameDept = mine.find((a) => a.department_slug === slug);
  if (sameDept) await endAssignment(c.db, sameDept.id, c.user.id, `became head: ${reason}`, at);
  const id = crypto.randomUUID();
  await createAssignment(c.db, { id, user_id: userId, department_slug: slug, position: "head", reason, created_at: at, created_by: c.user.id });
  await c.audit("staff.head_appointed", "user", userId, { department: slug, assignment: id, previousHead: current?.user_id ?? null, reason });
  return id;
}

// ---------- opening a request (nothing executes here) ----------
export async function openApproval(c: Ctx, f: { category: Category; targetType: string; targetId: string; payload: Record<string, unknown>; reason: string; rule: CategoryRule }) {
  const at = nowIso();
  const hours = Math.min(24 * 30, Math.max(1, Math.round(f.rule.expiresInHours || 72)));
  const r: ApprovalRequest = { id: crypto.randomUUID(), category: f.category, target_type: f.targetType, target_id: f.targetId, payload: JSON.stringify(f.payload), reason: f.reason,
    requested_by: c.user.id, approver: f.rule.approver === "super" ? "super" : "owner", status: "pending", expires_at: new Date(Date.now() + hours * 3600_000).toISOString(),
    decided_by: null, decided_at: null, decision_comment: null, executed_at: null, execution_result: null, escalated_at: null, created_at: at, updated_at: at };
  try { await createApproval(c.db, r); }
  catch (e) {
    if (/UNIQUE/i.test(String(e))) throw new ApiError(409, "already_requested", "There is already a pending request for this. It must be decided or cancelled first.");
    throw e;
  }
  await c.audit("approval.requested", "approval_request", r.id, { category: r.category, target: r.target_id, approver: r.approver, expiresAt: r.expires_at, reason: r.reason, payload: f.payload });
  return r;
}
