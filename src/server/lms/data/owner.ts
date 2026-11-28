// Owner controls (migration 0009): bootstrap state, permanent removals and removal requests.
import { all, one, run, type DB } from "./base";
import { getSetting, putSetting } from "./engagement";

// ---- the owner (Stage 2C) ----
// The owner is decided on the server from two things that must agree: the OWNER_EMAIL setting and, once the one-time
// bootstrap has run, the account recorded in owner_record (migration 0010; one row, cannot be changed or deleted by the
// application). So:
//   - before bootstrap: the active, not-removed administrator account whose email is OWNER_EMAIL ("pending");
//   - after bootstrap: only the recorded account, and only while its email still equals OWNER_EMAIL ("bootstrapped").
//     Pointing OWNER_EMAIL at someone else makes NOBODY the owner ("mismatch"); it never creates a replacement.
//   - if the record has disappeared although the audit log shows a bootstrap happened: nobody ("record_missing"),
//     and the bootstrap cannot be run again.
export type OwnerRecord = { user_id: string; email: string; bootstrapped_at: string };
export type OwnerStateName = "unconfigured" | "pending" | "bootstrapped" | "mismatch" | "record_missing" | "no_account" | "migration_required";
export type OwnerState = { state: OwnerStateName; ownerId: string | null; record: OwnerRecord | null };
export const ownerEmailOf = (env: { OWNER_EMAIL?: string }) => (env.OWNER_EMAIL || "").trim().toLowerCase();

export async function getOwnerRecord(db: DB): Promise<OwnerRecord | null | "missing_table"> {
  try { return (await db.prepare("SELECT user_id, email, bootstrapped_at FROM owner_record WHERE id = 1").first<OwnerRecord>()) ?? null; }
  catch (e) { if (/no such table/i.test(String((e as Error)?.message ?? e))) return "missing_table"; throw e; }
}
type OwnerUser = { id: string; email: string; role: string; status: string; removed_at?: string | null };
const usable = (u: OwnerUser | null | undefined, email: string): u is OwnerUser =>
  !!u && u.email.toLowerCase() === email && u.role === "admin" && u.status === "active" && !u.removed_at;

export async function resolveOwner(db: DB, env: { OWNER_EMAIL?: string }): Promise<OwnerState> {
  const email = ownerEmailOf(env);
  const rec = await getOwnerRecord(db);
  if (rec === "missing_table") return { state: "migration_required", ownerId: null, record: null };
  if (!email) return { state: "unconfigured", ownerId: null, record: rec };
  if (rec) {
    if (rec.email.toLowerCase() !== email) return { state: "mismatch", ownerId: null, record: rec };
    const u = await one<OwnerUser>(db, "SELECT id, email, role, status, removed_at FROM users WHERE id = ?1", rec.user_id);
    return usable(u, email) ? { state: "bootstrapped", ownerId: u.id, record: rec } : { state: "no_account", ownerId: null, record: rec };
  }
  if (await one(db, "SELECT 1 AS x FROM audit_log WHERE action = 'owner.bootstrap' LIMIT 1")) return { state: "record_missing", ownerId: null, record: null };
  const u = await one<OwnerUser>(db, "SELECT id, email, role, status, removed_at FROM users WHERE lower(email) = ?1", email);
  return usable(u, email) ? { state: "pending", ownerId: u.id, record: null } : { state: "no_account", ownerId: null, record: null };
}
// Group assignment is possible once a bootstrap has been recorded (even if the owner is later unavailable, the Super
// Administrators the owner appointed keep working).
export const isBootstrapped = async (db: DB) => { const r = await getOwnerRecord(db); return !!r && r !== "missing_table"; };
// Atomic: owner_record holds one row at most, so a second (or simultaneous) bootstrap fails here.
export async function recordBootstrap(db: DB, userId: string, email: string, at: string): Promise<boolean> {
  try { await db.prepare("INSERT INTO owner_record (id, user_id, email, bootstrapped_at) VALUES (1, ?1, ?2, ?3)").bind(userId, email.toLowerCase(), at).run(); return true; }
  catch (e) { if (/UNIQUE|PRIMARY KEY|constraint/i.test(String((e as Error)?.message ?? e))) return false; throw e; }
}

// Owner policy for administrators who still have no group (legacy accounts). Off by default; see Stage 2C section 5.
export const OWNER_POLICY_KEY = "owner_policy";
export type OwnerPolicy = { restrictUnassigned: boolean };
export const getOwnerPolicy = async (db: DB): Promise<OwnerPolicy> => ({ restrictUnassigned: !!(await getSetting<OwnerPolicy>(db, OWNER_POLICY_KEY).catch(() => null))?.restrictUnassigned });
export const saveOwnerPolicy = (db: DB, p: OwnerPolicy, by: string, at: string) => putSetting(db, OWNER_POLICY_KEY, p, by, at);
export const unassignedAdmins = (db: DB, ownerId: string | null) => all<{ id: string; email: string; full_name: string; last_login_at: string | null; status: string }>(db,
  "SELECT id, email, full_name, last_login_at, status FROM users WHERE role = 'admin' AND admin_role IS NULL AND removed_at IS NULL AND (?1 IS NULL OR id <> ?1) ORDER BY full_name", ownerId);

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
// The teaching a removed instructor still holds, so the owner can reassign it (Academics > Enrolments).
export const teachingToReassign = (db: DB, userId: string) => all<{ id: string; programme: string; status: string; student_name: string; future_classes: number }>(db,
  `SELECT e.id, e.programme_slug AS programme, e.status, s.full_name AS student_name, (SELECT COUNT(*) FROM class_sessions c WHERE c.enrolment_id = e.id AND c.starts_at > ?2 AND c.status = 'scheduled') AS future_classes FROM enrolments e JOIN users s ON s.id = e.student_id WHERE e.instructor_id = ?1 AND e.status IN ('active', 'paused') ORDER BY s.full_name`, userId, new Date().toISOString());

export type RemovalRequest = { id: string; user_id: string; requested_by: string; reason: string; status: "pending" | "approved" | "rejected";
  decided_by: string | null; decided_at: string | null; decision_note: string | null; created_at: string;
  user_name?: string; user_email?: string; user_role?: string; requester_name?: string };
export const createRemovalRequest = (db: DB, r: { id: string; user_id: string; requested_by: string; reason: string; created_at: string }) =>
  run(db, "INSERT INTO staff_removal_requests (id, user_id, requested_by, reason, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", r.id, r.user_id, r.requested_by, r.reason, r.created_at);
export const pendingRequestFor = (db: DB, userId: string) =>
  one<RemovalRequest>(db, "SELECT * FROM staff_removal_requests WHERE user_id = ?1 AND status = 'pending'", userId);
export const getRemovalRequest = (db: DB, id: string) => one<RemovalRequest>(db, "SELECT * FROM staff_removal_requests WHERE id = ?1", id);
export const listRemovalRequests = (db: DB, status?: string) => all<RemovalRequest>(db,
  `SELECT r.*, u.full_name AS user_name, u.email AS user_email, u.role AS user_role, q.full_name AS requester_name FROM staff_removal_requests r JOIN users u ON u.id = r.user_id JOIN users q ON q.id = r.requested_by ${status ? "WHERE r.status = ?1" : ""} ORDER BY r.created_at DESC LIMIT 200`, ...(status ? [status] : []));
// Decides a PENDING request only (atomic: a request cannot be decided twice).
export const decideRemovalRequest = async (db: DB, id: string, status: "approved" | "rejected", by: string, note: string | null, at: string) =>
  !!(await one<{ id: string }>(db, "UPDATE staff_removal_requests SET status = ?2, decided_by = ?3, decision_note = ?4, decided_at = ?5 WHERE id = ?1 AND status = 'pending' RETURNING id", id, status, by, note, at));

export const listStaff = (db: DB) => all<{ id: string; email: string; full_name: string; role: string; status: string; admin_role: string | null; staff_no: string | null;
  last_login_at: string | null; removed_at: string | null; removal_reason: string | null; mfa: string | null }>(db,
  `SELECT u.id, u.email, u.full_name, u.role, u.status, u.admin_role, u.staff_no, u.last_login_at, u.removed_at, u.removal_reason, f.status AS mfa FROM users u LEFT JOIN mfa_factors f ON f.user_id = u.id WHERE u.role IN ('admin', 'instructor') ORDER BY u.role, u.full_name LIMIT 500`);

export const auditSearch = (db: DB, f: { actor?: string; action?: string; target?: string; limit: number; offset: number }) => all<Record<string, string>>(db,
  `SELECT a.*, u.full_name AS actor_name, u.email AS actor_email FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE (?1 IS NULL OR a.actor_id = ?1 OR u.email = ?1) AND (?2 IS NULL OR a.action LIKE ?2 || '%') AND (?3 IS NULL OR a.target_id = ?3) ORDER BY a.at DESC LIMIT ?4 OFFSET ?5`, f.actor ?? null, f.action ?? null, f.target ?? null, f.limit, f.offset);
