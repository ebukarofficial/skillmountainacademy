// Users, sign-in tokens, sessions and the audit log.
import { all, insert, insertStmt, one, run, stmt, update, type DB } from "./base";

export type Role = "student" | "instructor" | "admin";
export type User = {
  id: string; email: string; role: Role; status: "active" | "suspended"; full_name: string; phone: string | null; bio: string | null;
  photo_key: string | null; student_no: string | null; specialization: string | null; qualifications: string | null; links: string | null;
  registration_id: string | null; created_at: string; last_login_at: string | null;
  verification?: string | null; verification_checks?: string | null; highest_qualification?: string | null; experience?: string | null; public_profile?: number;
  staff_no?: string | null; email_prefs?: string | null;
  headline?: string | null; achievements?: string | null; certifications?: string | null; languages?: string | null;
  country_origin?: string | null; country_residence?: string | null; profile_submitted_at?: string | null; verified_at?: string | null;
  meet_link?: string | null; guardian_name?: string | null; guardian_relationship?: string | null; guardian_email?: string | null; guardian_phone?: string | null;
  guardian_contact_ok?: number; guardian_contact_note?: string | null;
  admin_role?: string | null; removed_at?: string | null; removed_by?: string | null; removal_reason?: string | null; mfa_required?: number;
};
// Only approved instructors teach (see lib/admissions.ts). New instructors can sign in before approval, but only to
// complete and submit their profile (the API allows them nothing else). Rejected or suspended candidates cannot sign
// in. If migration 0004 has not run yet the column does not exist (undefined), and instructors work as before.
export const isApproved = (u: Pick<User, "verification">) => u.verification === undefined || u.verification === "approved";
export const canSignIn = (u: Pick<User, "status" | "role" | "verification" | "removed_at">) =>
  u.status === "active" && !u.removed_at && (u.role !== "instructor" || (u.verification !== "rejected" && u.verification !== "suspended"));
export const isVerifiedInstructor = (u: Pick<User, "role" | "verification">) => u.role === "instructor" && u.verification === "approved";

export const getUser = (db: DB, id: string) => one<User>(db, "SELECT * FROM users WHERE id = ?1", id);
export const getUserByEmail = (db: DB, email: string) => one<User>(db, "SELECT * FROM users WHERE email = ?1", email.toLowerCase());
// Columns left undefined are not written, so newer optional columns are only touched when they have a value.
export const createUser = (db: DB, u: User) => insert(db, "users", Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined)) as Record<string, string | number | null>);
export const updateUser = (db: DB, id: string, patch: Partial<User>) => update(db, "users", id, patch);

export function listUsers(db: DB, f: { role?: string; status?: string; q?: string; limit: number; offset: number }) {
  return all<User>(db,
    `SELECT * FROM users WHERE (?1 IS NULL OR role = ?1) AND (?2 IS NULL OR status = ?2)
       AND (?3 IS NULL OR email LIKE ?3 OR full_name LIKE ?3 OR student_no LIKE ?3)
     ORDER BY created_at DESC LIMIT ?4 OFFSET ?5`,
    f.role ?? null, f.status ?? null, f.q ? `%${f.q}%` : null, f.limit, f.offset);
}

// ---- sign-in tokens ----
export const createToken = (db: DB, t: { token_hash: string; user_id: string; expires_at: string; created_at: string }) => insert(db, "auth_tokens", t);
// Marks the token used and returns its user, only if it was unused and unexpired (single use, race-safe).
export async function consumeToken(db: DB, hash: string, now: string): Promise<string | null> {
  const row = await one<{ user_id: string }>(db, "UPDATE auth_tokens SET used_at = ?2 WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2 RETURNING user_id", hash, now);
  return row?.user_id ?? null;
}
export const purgeTokens = (db: DB, before: string) => run(db, "DELETE FROM auth_tokens WHERE expires_at < ?1", before);

// ---- sessions ----
// Stage 2: sessions carry last_activity_at (genuine user activity) and the MFA state. Before migration 0008 those columns
// do not exist; the legacy functions keep sign-in working in that window (idle and MFA checks then cannot apply).
export type SessionRow = {
  token_hash: string; user_id: string; created_at: string; expires_at: string; last_seen_at: string;
  last_activity_at: string | null; mfa_pending: number; mfa_verified_at: string | null; legacy?: boolean;
};
const isSchemaGap = (e: unknown) => /no such column|has no column named/i.test(String((e as Error)?.message ?? e));

export async function createSession(db: DB, s: { token_hash: string; user_id: string; created_at: string; expires_at: string; last_seen_at: string; user_agent: string | null; mfa_pending?: number }) {
  try {
    return await insert(db, "auth_sessions", { ...s, last_activity_at: s.created_at, mfa_pending: s.mfa_pending ?? 0 });
  } catch (e) {
    if (!isSchemaGap(e)) throw e;
    const { mfa_pending: _m, ...legacy } = s; void _m;
    return insert(db, "auth_sessions", legacy);
  }
}
export async function sessionWithUser(db: DB, hash: string): Promise<{ user: User; session: SessionRow } | null> {
  let row: (User & Record<string, unknown>) | null;
  let legacy = false;
  try {
    row = await one<User & Record<string, unknown>>(db,
      `SELECT u.*, s.created_at AS s_created_at, s.expires_at AS s_expires_at, s.last_seen_at AS s_last_seen_at,
              s.last_activity_at AS s_last_activity_at, s.mfa_pending AS s_mfa_pending, s.mfa_verified_at AS s_mfa_verified_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1`, hash);
  } catch (e) {
    if (!isSchemaGap(e)) throw e;
    legacy = true;
    row = await one<User & Record<string, unknown>>(db,
      `SELECT u.*, s.created_at AS s_created_at, s.expires_at AS s_expires_at, s.last_seen_at AS s_last_seen_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1`, hash);
  }
  if (!row) return null;
  const session: SessionRow = {
    token_hash: hash, user_id: row.id, created_at: String(row.s_created_at), expires_at: String(row.s_expires_at), last_seen_at: String(row.s_last_seen_at),
    last_activity_at: (row.s_last_activity_at as string | null) ?? null, mfa_pending: Number(row.s_mfa_pending ?? 0), mfa_verified_at: (row.s_mfa_verified_at as string | null) ?? null, legacy,
  };
  const user = { ...row } as Record<string, unknown>;
  for (const k of Object.keys(user)) if (k.startsWith("s_")) delete user[k];
  return { user: user as User, session };
}
// Kept for callers that only need the user of a live session.
export const sessionUser = async (db: DB, hash: string, now: string) => {
  const r = await sessionWithUser(db, hash);
  return r && r.session.expires_at > now && r.user.status === "active" ? { ...r.user, s_expires_at: r.session.expires_at, s_last_seen_at: r.session.last_seen_at } : null;
};
export const touchSession = (db: DB, hash: string, now: string, expires: string) => run(db, "UPDATE auth_sessions SET last_seen_at = ?2, expires_at = ?3 WHERE token_hash = ?1", hash, now, expires);
// Genuine activity: moves last_activity_at forward only (never back), at most once per throttle window. The idle check
// runs BEFORE this in the request pipeline, so an expired session can never be revived by it.
export const recordActivity = (db: DB, hash: string, at: string, notAfter: string) =>
  run(db, "UPDATE auth_sessions SET last_activity_at = ?2 WHERE token_hash = ?1 AND (last_activity_at IS NULL OR last_activity_at < ?3)", hash, at, notAfter);
export const markSessionMfaVerified = (db: DB, hash: string, at: string) =>
  run(db, "UPDATE auth_sessions SET mfa_pending = 0, mfa_verified_at = ?2 WHERE token_hash = ?1", hash, at);
export const deleteSession = (db: DB, hash: string) => run(db, "DELETE FROM auth_sessions WHERE token_hash = ?1", hash);
export const deleteUserSessions = (db: DB, userId: string) => run(db, "DELETE FROM auth_sessions WHERE user_id = ?1", userId);
export const deleteOtherSessions = (db: DB, userId: string, keepHash: string) => run(db, "DELETE FROM auth_sessions WHERE user_id = ?1 AND token_hash != ?2", userId, keepHash);
export const purgeSessions = (db: DB, before: string) => run(db, "DELETE FROM auth_sessions WHERE expires_at < ?1", before);

// ---- audit log ----
export const audit = (db: DB, e: { actor_id: string | null; action: string; target_type?: string; target_id?: string; detail?: unknown; ip_hash?: string | null }) =>
  insert(db, "audit_log", { id: crypto.randomUUID(), at: new Date().toISOString(), actor_id: e.actor_id, action: e.action, target_type: e.target_type ?? null,
    target_id: e.target_id ?? null, detail: e.detail === undefined ? null : JSON.stringify(e.detail).slice(0, 2000), ip_hash: e.ip_hash ?? null });
// Stage E.2: the same audit row as a statement, so it can commit in one batch with the change it records.
export const auditStmt = (db: DB, e: { actor_id: string | null; action: string; target_type?: string; target_id?: string; detail?: unknown; ip_hash?: string | null }) =>
  insertStmt(db, "audit_log", { id: crypto.randomUUID(), at: new Date().toISOString(), actor_id: e.actor_id, action: e.action, target_type: e.target_type ?? null,
    target_id: e.target_id ?? null, detail: e.detail === undefined ? null : JSON.stringify(e.detail).slice(0, 2000), ip_hash: e.ip_hash ?? null });
export const listAudit = (db: DB, limit: number, offset: number) => all<Record<string, string>>(db,
  "SELECT a.*, u.full_name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.at DESC LIMIT ?1 OFFSET ?2", limit, offset);

export const logError = (db: DB, route: string, message: string) =>
  insert(db, "error_log", { id: crypto.randomUUID(), at: new Date().toISOString(), route, message: message.slice(0, 500) });

// Institutional number sequences (migration 0005). One atomic statement, so two admissions can never share a number.
export const nextSeq = async (db: DB, name: string) =>
  (await one<{ last: number }>(db, "INSERT INTO id_sequences (name, last) VALUES (?1, 1) ON CONFLICT(name) DO UPDATE SET last = last + 1 RETURNING last", name))!.last;

// Email preferences of several users at once (null when the column does not exist yet or nothing was chosen).
// Accounts permanently removed by the owner (Stage 2C): they receive no further email from the platform (no class
// reminders, Meet links or student details) even while teaching is still being reassigned.
export const removedAmong = async (db: DB, ids: string[]): Promise<Set<string>> => {
  try {
    return new Set((await all<{ id: string }>(db, "SELECT id FROM users WHERE removed_at IS NOT NULL AND id IN (SELECT value FROM json_each(?1))", JSON.stringify(ids))).map((r) => r.id));
  } catch { return new Set(); } // before migration 0009
};
export const emailPrefsFor = async (db: DB, ids: string[]) => {
  try {
    return await all<{ id: string; email_prefs: string | null }>(db, "SELECT id, email_prefs FROM users WHERE id IN (SELECT value FROM json_each(?1))", JSON.stringify(ids));
  } catch { return []; }
};
// A new sign-in link replaces any earlier unused ones.
export const revokeTokens = (db: DB, userId: string, at: string) => run(db, "UPDATE auth_tokens SET used_at = ?2 WHERE user_id = ?1 AND used_at IS NULL", userId, at);

// Administrator group (migration 0008). Before the migration the column is missing: nothing is written and the
// administrator keeps today's full access.
export async function setAdminRole(db: DB, userId: string, role: string | null) {
  try { await run(db, "UPDATE users SET admin_role = ?2 WHERE id = ?1", userId, role); }
  catch (e) { if (!/no such column|has no column named/i.test(String((e as Error)?.message ?? e))) throw e; }
}

// MFA re-enrolment flag (migration 0009). Missing column before the migration: nothing happens.
export async function setMfaRequired(db: DB, userId: string, on: boolean) {
  try { await run(db, "UPDATE users SET mfa_required = ?2 WHERE id = ?1", userId, on ? 1 : 0); }
  catch (e) { if (!/no such column|has no column named/i.test(String((e as Error)?.message ?? e))) throw e; }
}

// Stage E.2: statement forms for changes that must commit together with their fence and audit records.
export const setAdminRoleStmt = (db: DB, userId: string, role: string) => stmt(db, "UPDATE users SET admin_role = ?2 WHERE id = ?1", userId, role);
export const deleteUserSessionsStmt = (db: DB, userId: string) => stmt(db, "DELETE FROM auth_sessions WHERE user_id = ?1", userId);
export const reinstateStmt = (db: DB, userId: string) => stmt(db, "UPDATE users SET status = 'active' WHERE id = ?1 AND status = 'suspended' AND removed_at IS NULL", userId);
