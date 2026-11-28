// Institutional structure (Expansion Stage E, migration 0015). SQL only; rules are in src/server/lms/institution.ts.
import { all, batch, one, run, stmt, type DB } from "./base";

export type Department = { slug: string; name: string; purpose: string | null; status: "active" | "archived"; created_at: string; created_by: string | null; updated_at: string; updated_by: string | null };
export type Assignment = { id: string; user_id: string; department_slug: string; position: "head" | "staff"; reason: string | null; created_at: string; created_by: string | null;
  ended_at: string | null; ended_by: string | null; end_reason: string | null };
export type Invitation = { id: string; email: string; full_name: string; role: "admin" | "instructor"; admin_role: string | null; department_slug: string | null; position: "head" | "staff" | null;
  token_hash: string; status: "pending" | "accepted" | "declined" | "revoked" | "expired"; expires_at: string; created_at: string; created_by: string; decided_at: string | null;
  decided_by: string | null; revoke_reason: string | null; accepted_user_id: string | null };
export type ApprovalRequest = { id: string; category: string; target_type: string; target_id: string; payload: string; reason: string; requested_by: string; approver: "owner" | "super";
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired"; expires_at: string; decided_by: string | null; decided_at: string | null; decision_comment: string | null;
  executed_at: string | null; execution_result: string | null; escalated_at: string | null; created_at: string; updated_at: string;
  // Stage E.1 (migration 0016): what happened to the action, kept apart from the approver's decision.
  execution_status: ExecutionStatus; execution_claimed_at: string | null; execution_claimed_by: string | null; execution_attempts: number;
  execution_claim_id: string | null }; // Stage E.2 (migration 0017): the fencing token of the current or last run
export type ExecutionStatus = "not_applicable" | "awaiting_execution" | "executing" | "completed" | "failed";

// ---------- departments ----------
export const listDepartments = (db: DB) => all<Department>(db, "SELECT * FROM departments ORDER BY status, name");
export const getDepartment = (db: DB, slug: string) => one<Department>(db, "SELECT * FROM departments WHERE slug = ?1", slug);
export const createDepartment = (db: DB, d: Department) => run(db, "INSERT INTO departments (slug, name, purpose, status, created_at, created_by, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5, ?6)",
  d.slug, d.name, d.purpose, d.status, d.created_at, d.created_by);
export const updateDepartment = (db: DB, slug: string, f: { name: string; purpose: string | null; status: string }, by: string, at: string) =>
  run(db, "UPDATE departments SET name = ?2, purpose = ?3, status = ?4, updated_at = ?5, updated_by = ?6 WHERE slug = ?1", slug, f.name, f.purpose, f.status, at, by);

// ---------- assignments ----------
const ASSIGN_VIEW = `SELECT a.*, u.full_name, u.role, u.admin_role, u.status AS user_status, u.removed_at FROM staff_assignments a JOIN users u ON u.id = a.user_id`;
export type AssignmentView = Assignment & { full_name: string; role: string; admin_role: string | null; user_status: string; removed_at: string | null };
export const activeAssignments = (db: DB) => all<AssignmentView>(db, `${ASSIGN_VIEW} WHERE a.ended_at IS NULL ORDER BY a.department_slug, a.position, u.full_name`);
export const departmentRoster = (db: DB, slug: string) => all<AssignmentView>(db, `${ASSIGN_VIEW} WHERE a.ended_at IS NULL AND a.department_slug = ?1 ORDER BY a.position, u.full_name`, slug);
export const userAssignments = (db: DB, userId: string) => all<Assignment>(db, "SELECT * FROM staff_assignments WHERE user_id = ?1 AND ended_at IS NULL", userId);
export const headedBy = (db: DB, userId: string) => one<Assignment>(db, "SELECT * FROM staff_assignments WHERE user_id = ?1 AND position = 'head' AND ended_at IS NULL", userId);
export const currentHead = (db: DB, slug: string) => one<Assignment>(db, "SELECT * FROM staff_assignments WHERE department_slug = ?1 AND position = 'head' AND ended_at IS NULL", slug);
export const assignmentHistory = (db: DB, userId: string) => all<Assignment>(db, "SELECT * FROM staff_assignments WHERE user_id = ?1 ORDER BY created_at", userId);
export const getAssignment = (db: DB, id: string) => one<Assignment>(db, "SELECT * FROM staff_assignments WHERE id = ?1", id);
export const createAssignmentStmt = (db: DB, a: Omit<Assignment, "ended_at" | "ended_by" | "end_reason">) =>
  stmt(db, "INSERT INTO staff_assignments (id, user_id, department_slug, position, reason, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    a.id, a.user_id, a.department_slug, a.position, a.reason, a.created_at, a.created_by);
export const endAssignmentStmt = (db: DB, id: string, by: string, reason: string, at: string) =>
  stmt(db, "UPDATE staff_assignments SET ended_at = ?2, ended_by = ?3, end_reason = ?4 WHERE id = ?1 AND ended_at IS NULL", id, at, by, reason);
// Plain forms of the statements above, for changes made on their own (one statement, one definition of the SQL).
export const createAssignment = async (db: DB, a: Omit<Assignment, "ended_at" | "ended_by" | "end_reason">) => (await createAssignmentStmt(db, a).run()).meta.changes ?? 0;
export const endAssignment = async (db: DB, id: string, by: string, reason: string, at: string) => (await endAssignmentStmt(db, id, by, reason, at).run()).meta.changes ?? 0;

// ---------- invitations ----------
export const listInvitations = (db: DB) => all<Invitation>(db, "SELECT * FROM staff_invitations ORDER BY created_at DESC LIMIT 300");
export const getInvitation = (db: DB, id: string) => one<Invitation>(db, "SELECT * FROM staff_invitations WHERE id = ?1", id);
export const invitationByHash = (db: DB, hash: string) => one<Invitation>(db, "SELECT * FROM staff_invitations WHERE token_hash = ?1", hash);
export const createInvitation = (db: DB, i: Invitation) => run(db, `INSERT INTO staff_invitations (id, email, full_name, role, admin_role, department_slug, position, token_hash, status, expires_at, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?10, ?11)`, i.id, i.email, i.full_name, i.role, i.admin_role, i.department_slug, i.position, i.token_hash, i.expires_at, i.created_at, i.created_by);
// Compare-and-set: only a pending invitation changes state, so it can be used, declined, revoked or expired once.
export const moveInvitation = (db: DB, id: string, to: Invitation["status"], f: { by?: string | null; reason?: string | null; userId?: string | null }, at: string) =>
  run(db, "UPDATE staff_invitations SET status = ?2, decided_at = ?3, decided_by = ?4, revoke_reason = ?5, accepted_user_id = ?6 WHERE id = ?1 AND status = 'pending'",
    id, to, at, f.by ?? null, f.reason ?? null, f.userId ?? null);

// Stage E.1: accepting an invitation is ONE D1 batch, which D1 runs as a single SQL transaction. The invitation is
// claimed (pending, not expired) and stamped with the new account's id; every insert after it runs only if that claim
// is the one recorded (WHERE EXISTS … accepted_user_id = this id). If anything fails (the email already has an account,
// a constraint, the database), the whole batch rolls back and the invitation stays pending: never consumed without
// its account. A concurrent second request finds the invitation no longer pending and inserts nothing.
export type Acceptance = { invitationId: string; userId: string; at: string; email: string; fullName: string; role: "admin" | "instructor"; adminRole: string | null;
  staffNo: string | null; verification: string | null; departmentSlug: string | null; position: "head" | "staff" | null; createdBy: string; assignmentId: string;
  auditAccepted: string; auditJoined: string; ipHash: string | null };
export async function acceptInvitationAtomic(db: DB, a: Acceptance): Promise<boolean> {
  const mine = "EXISTS (SELECT 1 FROM staff_invitations WHERE id = ?1 AND status = 'accepted' AND accepted_user_id = ?2)";
  const res = await batch(db, [
    stmt(db, "UPDATE staff_invitations SET status = 'accepted', decided_at = ?3, accepted_user_id = ?2 WHERE id = ?1 AND status = 'pending' AND expires_at > ?3", a.invitationId, a.userId, a.at),
    stmt(db, `INSERT INTO users (id, email, role, status, full_name, created_at, staff_no, verification, admin_role) SELECT ?2, ?3, ?4, 'active', ?5, ?6, ?7, ?8, ?9 WHERE ${mine}`, a.invitationId, a.userId, a.email, a.role, a.fullName, a.at, a.staffNo, a.verification, a.adminRole),
    stmt(db, `INSERT INTO staff_assignments (id, user_id, department_slug, position, reason, created_at, created_by) SELECT ?3, ?2, ?4, ?5, ?6, ?7, ?8 WHERE ?4 IS NOT NULL AND ?5 IS NOT NULL AND ${mine}`, a.invitationId, a.userId, a.assignmentId, a.departmentSlug, a.position, `invitation ${a.invitationId}`, a.at, a.createdBy),
    stmt(db, `INSERT INTO audit_log (id, at, actor_id, action, target_type, target_id, detail, ip_hash) SELECT ?3, ?4, ?2, 'invite.accepted', 'staff_invitation', ?1, ?5, ?6 WHERE ${mine}`, a.invitationId, a.userId, crypto.randomUUID(), a.at, a.auditAccepted, a.ipHash),
    stmt(db, `INSERT INTO audit_log (id, at, actor_id, action, target_type, target_id, detail, ip_hash) SELECT ?3, ?4, ?5, 'staff.joined', 'user', ?2, ?6, NULL WHERE ${mine}`, a.invitationId, a.userId, crypto.randomUUID(), a.at, a.createdBy, a.auditJoined),
  ]);
  return (res[0]?.meta?.changes ?? 0) === 1;
}

// ---------- approval requests ----------
export const getApproval = (db: DB, id: string) => one<ApprovalRequest>(db, "SELECT * FROM approval_requests WHERE id = ?1", id);
export const listApprovals = (db: DB) => all<ApprovalRequest>(db, "SELECT * FROM approval_requests ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 300");
export const createApproval = (db: DB, r: ApprovalRequest) => run(db, `INSERT INTO approval_requests (id, category, target_type, target_id, payload, reason, requested_by, approver, status, expires_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?10, ?10)`, r.id, r.category, r.target_type, r.target_id, r.payload, r.reason, r.requested_by, r.approver, r.expires_at, r.created_at);
// A decision other than approval: nothing will ever execute (execution_status stays not_applicable).
export const decideApproval = (db: DB, id: string, to: "rejected" | "cancelled" | "expired", by: string | null, comment: string | null, at: string) =>
  run(db, "UPDATE approval_requests SET status = ?2, decided_by = ?3, decision_comment = ?4, decided_at = ?5, updated_at = ?5 WHERE id = ?1 AND status = 'pending'", id, to, by, comment, at);
// Approval records the decision and queues the action; it does not say the action happened.
export const approveRequest = (db: DB, id: string, by: string, comment: string | null, at: string) =>
  run(db, "UPDATE approval_requests SET status = 'approved', execution_status = 'awaiting_execution', decided_by = ?2, decision_comment = ?3, decided_at = ?4, updated_at = ?4 WHERE id = ?1 AND status = 'pending'", id, by, comment, at);
// Atomic claim: exactly one caller moves the request to "executing", with a NEW random claim id (the fencing token).
// The first run claims only a freshly approved request; a recovery may also claim a failed one, or one whose earlier run
// was interrupted (still "executing" after staleBefore). Rejected, cancelled and expired requests can never be claimed.
// Reclaiming replaces the claim id, so the earlier run can no longer pass its fence (fenceStmt) and cannot commit.
export const claimExecution = (db: DB, id: string, by: string, at: string, staleBefore: string | null, claimId: string) =>
  run(db, `UPDATE approval_requests SET execution_status = 'executing', execution_claim_id = ?5, execution_claimed_at = ?3, execution_claimed_by = ?2, execution_attempts = execution_attempts + 1, updated_at = ?3 WHERE id = ?1 AND status = 'approved' AND (execution_status = 'awaiting_execution' OR (?4 IS NOT NULL AND (execution_status = 'failed' OR (execution_status = 'executing' AND execution_claimed_at < ?4))))`, id, by, at, staleBefore, claimId);

// ---- fencing (Stage E.2): the statements that make an action commit only for the current claim ----
const OWNS = "EXISTS (SELECT 1 FROM approval_requests WHERE id = ?2 AND status = 'approved' AND execution_status = 'executing' AND execution_claim_id = ?1)";
// First statement of the batch. NOT NULL makes the whole batch roll back when this run no longer owns the claim; the
// primary key makes a claim commit at most once.
export const fenceStmt = (db: DB, claimId: string, approvalId: string, at: string) =>
  stmt(db, `INSERT INTO execution_fences (claim_id, approval_id, owner_check, effect_check, committed_at) SELECT ?1, ?2, CASE WHEN ${OWNS} THEN 'current' ELSE NULL END, 'pending', ?3`, claimId, approvalId, at);
// After the action's statements: rolls the whole batch back unless the intended result is in place (for example the
// payment attempt really moved to "released" by this run). existsSql uses ?2, ?3, … for its own values.
export const effectStmt = (db: DB, claimId: string, existsSql: string, ...binds: (string | number | null)[]) =>
  stmt(db, `UPDATE execution_fences SET effect_check = CASE WHEN EXISTS (${existsSql}) THEN 'confirmed' ELSE NULL END WHERE claim_id = ?1`, claimId, ...binds);
// Stage E.3: the commit-time validation, right after the fence. `check` is a CASE expression from policy-sql.ts that is
// 'validated' only when every rule still holds; otherwise it yields NULL into a NOT NULL column, which fails the
// statement and rolls back the whole batch (a conditional UPDATE that matched no row would not).
export const validateStmt = (db: DB, claimId: string, check: { sql: string; vals: (string | number | null)[] }) =>
  stmt(db, `UPDATE execution_fences SET effect_check = ${check.sql} WHERE claim_id = ?1`, claimId, ...check.vals);
// The completion, inside the same batch, for the claim that just passed its fence.
export const completeStmt = (db: DB, approvalId: string, claimId: string, result: string, at: string) =>
  stmt(db, `UPDATE approval_requests SET execution_status = 'completed', execution_result = ?3, executed_at = ?4, updated_at = ?4 WHERE id = ?1 AND execution_claim_id = ?2 AND execution_status = 'executing'`, approvalId, claimId, result, at);
export const fenceFor = (db: DB, claimId: string) => one<{ claim_id: string; approval_id: string; committed_at: string }>(db, "SELECT * FROM execution_fences WHERE claim_id = ?1", claimId);
export const fencesFor = (db: DB, approvalId: string) => all<{ claim_id: string; committed_at: string }>(db, "SELECT claim_id, committed_at FROM execution_fences WHERE approval_id = ?1 ORDER BY committed_at", approvalId);
// Records a run's outcome other than a committed action (completed without changes, or failed), with its audit entry,
// only while the run still owns the claim: a superseded run can overwrite neither the status nor the audit outcome.
export async function recordOutcome(db: DB, approvalId: string, claimId: string, outcome: "completed" | "failed", result: string, at: string,
  auditRow: { actor_id: string; action: string; detail: unknown; ip_hash: string | null }): Promise<boolean> {
  const res = await batch(db, [
    stmt(db, `INSERT INTO audit_log (id, at, actor_id, action, target_type, target_id, detail, ip_hash) SELECT ?3, ?4, ?5, ?6, 'approval_request', ?2, ?7, ?8 WHERE ${OWNS}`, claimId, approvalId, crypto.randomUUID(), at, auditRow.actor_id, auditRow.action,
      JSON.stringify(auditRow.detail).slice(0, 2000), auditRow.ip_hash),
    stmt(db, `UPDATE approval_requests SET execution_status = ?3, execution_result = ?4, executed_at = CASE WHEN ?3 = 'completed' THEN ?5 ELSE executed_at END, updated_at = ?5 WHERE id = ?2 AND execution_claim_id = ?1 AND execution_status = 'executing' AND status = 'approved'`, claimId, approvalId, outcome, result, at),
  ]);
  return (res[1]?.meta?.changes ?? 0) === 1;
}

export const escalateApproval = (db: DB, id: string, at: string) =>
  run(db, "UPDATE approval_requests SET approver = 'owner', escalated_at = ?2, updated_at = ?2 WHERE id = ?1 AND status = 'pending' AND approver = 'super'", id, at);
export const historyFor = (db: DB, targetId: string) => all<{ at: string; action: string; actor_name: string | null; detail: string | null }>(db,
  "SELECT a.at, a.action, u.full_name AS actor_name, a.detail FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.target_id = ?1 ORDER BY a.at", targetId);
export const accessHistory = (db: DB, userId: string) => all<{ at: string; action: string; actor_name: string | null; detail: string | null }>(db,
  `SELECT a.at, a.action, u.full_name AS actor_name, a.detail FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.target_id = ?1 AND (a.action LIKE 'admin.%' OR a.action LIKE 'user.%' OR a.action LIKE 'owner.%' OR a.action LIKE 'staff.%' OR a.action LIKE 'invite.%' OR a.action LIKE 'auth.%') ORDER BY a.at DESC LIMIT 200`, userId);
