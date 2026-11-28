// Institutional structure (Expansion Stage E, migration 0015). SQL only; rules are in src/server/lms/institution.ts.
import { all, one, run, type DB } from "./base";

export type Department = { slug: string; name: string; purpose: string | null; status: "active" | "archived"; created_at: string; created_by: string | null; updated_at: string; updated_by: string | null };
export type Assignment = { id: string; user_id: string; department_slug: string; position: "head" | "staff"; reason: string | null; created_at: string; created_by: string | null;
  ended_at: string | null; ended_by: string | null; end_reason: string | null };
export type Invitation = { id: string; email: string; full_name: string; role: "admin" | "instructor"; admin_role: string | null; department_slug: string | null; position: "head" | "staff" | null;
  token_hash: string; status: "pending" | "accepted" | "declined" | "revoked" | "expired"; expires_at: string; created_at: string; created_by: string; decided_at: string | null;
  decided_by: string | null; revoke_reason: string | null; accepted_user_id: string | null };
export type ApprovalRequest = { id: string; category: string; target_type: string; target_id: string; payload: string; reason: string; requested_by: string; approver: "owner" | "super";
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired"; expires_at: string; decided_by: string | null; decided_at: string | null; decision_comment: string | null;
  executed_at: string | null; execution_result: string | null; escalated_at: string | null; created_at: string; updated_at: string };

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
export const createAssignment = (db: DB, a: Omit<Assignment, "ended_at" | "ended_by" | "end_reason">) =>
  run(db, "INSERT INTO staff_assignments (id, user_id, department_slug, position, reason, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    a.id, a.user_id, a.department_slug, a.position, a.reason, a.created_at, a.created_by);
export const endAssignment = (db: DB, id: string, by: string, reason: string, at: string) =>
  run(db, "UPDATE staff_assignments SET ended_at = ?2, ended_by = ?3, end_reason = ?4 WHERE id = ?1 AND ended_at IS NULL", id, at, by, reason);

// ---------- invitations ----------
export const listInvitations = (db: DB) => all<Invitation>(db, "SELECT * FROM staff_invitations ORDER BY created_at DESC LIMIT 300");
export const getInvitation = (db: DB, id: string) => one<Invitation>(db, "SELECT * FROM staff_invitations WHERE id = ?1", id);
export const invitationByHash = (db: DB, hash: string) => one<Invitation>(db, "SELECT * FROM staff_invitations WHERE token_hash = ?1", hash);
export const createInvitation = (db: DB, i: Invitation) => run(db, `INSERT INTO staff_invitations (id, email, full_name, role, admin_role, department_slug, position, token_hash, status, expires_at, created_at, created_by)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?10, ?11)`, i.id, i.email, i.full_name, i.role, i.admin_role, i.department_slug, i.position, i.token_hash, i.expires_at, i.created_at, i.created_by);
// Compare-and-set: only a pending invitation changes state, so it can be used, declined, revoked or expired once.
export const moveInvitation = (db: DB, id: string, to: Invitation["status"], f: { by?: string | null; reason?: string | null; userId?: string | null }, at: string) =>
  run(db, "UPDATE staff_invitations SET status = ?2, decided_at = ?3, decided_by = ?4, revoke_reason = ?5, accepted_user_id = ?6 WHERE id = ?1 AND status = 'pending'",
    id, to, at, f.by ?? null, f.reason ?? null, f.userId ?? null);

// ---------- approval requests ----------
export const getApproval = (db: DB, id: string) => one<ApprovalRequest>(db, "SELECT * FROM approval_requests WHERE id = ?1", id);
export const listApprovals = (db: DB) => all<ApprovalRequest>(db, "SELECT * FROM approval_requests ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 300");
export const createApproval = (db: DB, r: ApprovalRequest) => run(db, `INSERT INTO approval_requests (id, category, target_type, target_id, payload, reason, requested_by, approver, status, expires_at, created_at, updated_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?10, ?10)`, r.id, r.category, r.target_type, r.target_id, r.payload, r.reason, r.requested_by, r.approver, r.expires_at, r.created_at);
export const decideApproval = (db: DB, id: string, to: "approved" | "rejected" | "cancelled" | "expired", by: string | null, comment: string | null, at: string) =>
  run(db, "UPDATE approval_requests SET status = ?2, decided_by = ?3, decision_comment = ?4, decided_at = ?5, updated_at = ?5 WHERE id = ?1 AND status = 'pending'", id, to, by, comment, at);
export const recordExecution = (db: DB, id: string, executed: boolean, result: string, at: string) =>
  run(db, "UPDATE approval_requests SET executed_at = ?2, execution_result = ?3, updated_at = ?4 WHERE id = ?1", id, executed ? at : null, result, at);
export const escalateApproval = (db: DB, id: string, at: string) =>
  run(db, "UPDATE approval_requests SET approver = 'owner', escalated_at = ?2, updated_at = ?2 WHERE id = ?1 AND status = 'pending' AND approver = 'super'", id, at);
export const historyFor = (db: DB, targetId: string) => all<{ at: string; action: string; actor_name: string | null; detail: string | null }>(db,
  "SELECT a.at, a.action, u.full_name AS actor_name, a.detail FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.target_id = ?1 ORDER BY a.at", targetId);
export const accessHistory = (db: DB, userId: string) => all<{ at: string; action: string; actor_name: string | null; detail: string | null }>(db,
  `SELECT a.at, a.action, u.full_name AS actor_name, a.detail FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
   WHERE a.target_id = ?1 AND (a.action LIKE 'admin.%' OR a.action LIKE 'user.%' OR a.action LIKE 'owner.%' OR a.action LIKE 'staff.%' OR a.action LIKE 'invite.%' OR a.action LIKE 'auth.%')
   ORDER BY a.at DESC LIMIT 200`, userId);
