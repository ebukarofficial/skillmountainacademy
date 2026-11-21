// Users, sign-in tokens, sessions and the audit log.
import { all, insert, one, run, update, type DB } from "./base";

export type Role = "student" | "instructor" | "admin";
export type User = {
  id: string; email: string; role: Role; status: "active" | "suspended"; full_name: string; phone: string | null; bio: string | null;
  photo_key: string | null; student_no: string | null; specialization: string | null; qualifications: string | null; links: string | null;
  registration_id: string | null; created_at: string; last_login_at: string | null;
  verification?: string | null; verification_checks?: string | null; highest_qualification?: string | null; experience?: string | null; public_profile?: number;
  staff_no?: string | null; email_prefs?: string | null;
  headline?: string | null; achievements?: string | null; certifications?: string | null; languages?: string | null;
  country_origin?: string | null; country_residence?: string | null; profile_submitted_at?: string | null; verified_at?: string | null;
};
// Only approved instructors teach (see lib/admissions.ts). New instructors can sign in before approval, but only to
// complete and submit their profile (the API allows them nothing else). Rejected or suspended candidates cannot sign
// in. If migration 0004 has not run yet the column does not exist (undefined), and instructors work as before.
export const isApproved = (u: Pick<User, "verification">) => u.verification === undefined || u.verification === "approved";
export const canSignIn = (u: Pick<User, "status" | "role" | "verification">) =>
  u.status === "active" && (u.role !== "instructor" || (u.verification !== "rejected" && u.verification !== "suspended"));
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
export const createSession = (db: DB, s: { token_hash: string; user_id: string; created_at: string; expires_at: string; last_seen_at: string; user_agent: string | null }) => insert(db, "auth_sessions", s);
export const sessionUser = (db: DB, hash: string, now: string) => one<User & { s_expires_at: string; s_last_seen_at: string }>(db,
  `SELECT u.*, s.expires_at AS s_expires_at, s.last_seen_at AS s_last_seen_at FROM auth_sessions s JOIN users u ON u.id = s.user_id
   WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND u.status = 'active'`, hash, now);
export const touchSession = (db: DB, hash: string, now: string, expires: string) => run(db, "UPDATE auth_sessions SET last_seen_at = ?2, expires_at = ?3 WHERE token_hash = ?1", hash, now, expires);
export const deleteSession = (db: DB, hash: string) => run(db, "DELETE FROM auth_sessions WHERE token_hash = ?1", hash);
export const deleteUserSessions = (db: DB, userId: string) => run(db, "DELETE FROM auth_sessions WHERE user_id = ?1", userId);
export const purgeSessions = (db: DB, before: string) => run(db, "DELETE FROM auth_sessions WHERE expires_at < ?1", before);

// ---- audit log ----
export const audit = (db: DB, e: { actor_id: string | null; action: string; target_type?: string; target_id?: string; detail?: unknown; ip_hash?: string | null }) =>
  insert(db, "audit_log", { id: crypto.randomUUID(), at: new Date().toISOString(), actor_id: e.actor_id, action: e.action, target_type: e.target_type ?? null,
    target_id: e.target_id ?? null, detail: e.detail === undefined ? null : JSON.stringify(e.detail).slice(0, 2000), ip_hash: e.ip_hash ?? null });
export const listAudit = (db: DB, limit: number, offset: number) => all<Record<string, string>>(db,
  "SELECT a.*, u.full_name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.at DESC LIMIT ?1 OFFSET ?2", limit, offset);

export const logError = (db: DB, route: string, message: string) =>
  insert(db, "error_log", { id: crypto.randomUUID(), at: new Date().toISOString(), route, message: message.slice(0, 500) });

// Institutional number sequences (migration 0005). One atomic statement, so two admissions can never share a number.
export const nextSeq = async (db: DB, name: string) =>
  (await one<{ last: number }>(db, "INSERT INTO id_sequences (name, last) VALUES (?1, 1) ON CONFLICT(name) DO UPDATE SET last = last + 1 RETURNING last", name))!.last;

// Email preferences of several users at once (null when the column does not exist yet or nothing was chosen).
export const emailPrefsFor = async (db: DB, ids: string[]) => {
  try {
    return await all<{ id: string; email_prefs: string | null }>(db, "SELECT id, email_prefs FROM users WHERE id IN (SELECT value FROM json_each(?1))", JSON.stringify(ids));
  } catch { return []; }
};
// A new sign-in link replaces any earlier unused ones.
export const revokeTokens = (db: DB, userId: string, at: string) => run(db, "UPDATE auth_tokens SET used_at = ?2 WHERE user_id = ?1 AND used_at IS NULL", userId, at);
