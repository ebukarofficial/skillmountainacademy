// Owner controls (migration 0009): bootstrap state, permanent removals and removal requests.
import { all, one, run, type DB } from "./base";
import { getSetting, putSetting } from "./engagement";

export const BOOTSTRAP_KEY = "owner_bootstrap";
export type Bootstrap = { at: string; by: string; email: string };
export const getBootstrap = (db: DB) => getSetting<Bootstrap>(db, BOOTSTRAP_KEY);
export const isBootstrapped = async (db: DB) => !!(await getBootstrap(db));
export const saveBootstrap = (db: DB, b: Bootstrap) => putSetting(db, BOOTSTRAP_KEY, b, b.by, b.at);

// Permanent removal: closes the account for good (cannot sign in, every session and link revoked, MFA removed). Records
// that mention the person stay, for academic, financial and legal reasons. Idempotent.
export async function removeAccount(db: DB, userId: string, by: string, reason: string, at: string): Promise<boolean> {
  const r = await one<{ id: string }>(db,
    "UPDATE users SET status = 'suspended', removed_at = ?2, removed_by = ?3, removal_reason = ?4 WHERE id = ?1 AND removed_at IS NULL RETURNING id", userId, at, by, reason);
  if (!r) return false;
  await db.batch([
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?1").bind(userId),
    db.prepare("UPDATE auth_tokens SET used_at = ?2 WHERE user_id = ?1 AND used_at IS NULL").bind(userId, at),
    db.prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM mfa_factors WHERE user_id = ?1").bind(userId),
  ]);
  return true;
}
export const activeTeaching = async (db: DB, userId: string) =>
  (await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM enrolments WHERE instructor_id = ?1 AND status IN ('active', 'paused')", userId))?.n ?? 0;

export type RemovalRequest = { id: string; user_id: string; requested_by: string; reason: string; status: "pending" | "approved" | "rejected";
  decided_by: string | null; decided_at: string | null; decision_note: string | null; created_at: string;
  user_name?: string; user_email?: string; user_role?: string; requester_name?: string };
export const createRemovalRequest = (db: DB, r: { id: string; user_id: string; requested_by: string; reason: string; created_at: string }) =>
  run(db, "INSERT INTO staff_removal_requests (id, user_id, requested_by, reason, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", r.id, r.user_id, r.requested_by, r.reason, r.created_at);
export const pendingRequestFor = (db: DB, userId: string) =>
  one<RemovalRequest>(db, "SELECT * FROM staff_removal_requests WHERE user_id = ?1 AND status = 'pending'", userId);
export const getRemovalRequest = (db: DB, id: string) => one<RemovalRequest>(db, "SELECT * FROM staff_removal_requests WHERE id = ?1", id);
export const listRemovalRequests = (db: DB, status?: string) => all<RemovalRequest>(db,
  `SELECT r.*, u.full_name AS user_name, u.email AS user_email, u.role AS user_role, q.full_name AS requester_name
   FROM staff_removal_requests r JOIN users u ON u.id = r.user_id JOIN users q ON q.id = r.requested_by
   ${status ? "WHERE r.status = ?1" : ""} ORDER BY r.created_at DESC LIMIT 200`, ...(status ? [status] : []));
// Decides a PENDING request only (atomic: a request cannot be decided twice).
export const decideRemovalRequest = async (db: DB, id: string, status: "approved" | "rejected", by: string, note: string | null, at: string) =>
  !!(await one<{ id: string }>(db, "UPDATE staff_removal_requests SET status = ?2, decided_by = ?3, decision_note = ?4, decided_at = ?5 WHERE id = ?1 AND status = 'pending' RETURNING id", id, status, by, note, at));

export const listStaff = (db: DB) => all<{ id: string; email: string; full_name: string; role: string; status: string; admin_role: string | null; staff_no: string | null;
  last_login_at: string | null; removed_at: string | null; removal_reason: string | null; mfa: string | null }>(db,
  `SELECT u.id, u.email, u.full_name, u.role, u.status, u.admin_role, u.staff_no, u.last_login_at, u.removed_at, u.removal_reason, f.status AS mfa
   FROM users u LEFT JOIN mfa_factors f ON f.user_id = u.id WHERE u.role IN ('admin', 'instructor') ORDER BY u.role, u.full_name LIMIT 500`);

export const auditSearch = (db: DB, f: { actor?: string; action?: string; target?: string; limit: number; offset: number }) => all<Record<string, string>>(db,
  `SELECT a.*, u.full_name AS actor_name, u.email AS actor_email FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
   WHERE (?1 IS NULL OR a.actor_id = ?1 OR u.email = ?1) AND (?2 IS NULL OR a.action LIKE ?2 || '%') AND (?3 IS NULL OR a.target_id = ?3)
   ORDER BY a.at DESC LIMIT ?4 OFFSET ?5`, f.actor ?? null, f.action ?? null, f.target ?? null, f.limit, f.offset);
