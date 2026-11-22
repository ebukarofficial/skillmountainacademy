// Administrator second factor (migration 0008). Secrets are stored encrypted; recovery codes as hashes only.
import { all, one, run, type DB } from "./base";

export type Factor = { user_id: string; secret_enc: string; status: "pending" | "active"; created_at: string; enabled_at: string | null; last_step: number | null };

// Returns null before migration 0008 as well, so sign-in keeps working for everyone in that window.
export async function getFactor(db: DB, userId: string): Promise<Factor | null> {
  try { return await one<Factor>(db, "SELECT * FROM mfa_factors WHERE user_id = ?1", userId); }
  catch (e) { if (/no such table/i.test(String((e as Error)?.message ?? e))) return null; throw e; }
}
export const activeFactor = async (db: DB, userId: string) => { const f = await getFactor(db, userId); return f?.status === "active" ? f : null; };

// A new pending secret replaces an earlier pending one, but never an active factor.
export const savePendingFactor = (db: DB, userId: string, secretEnc: string, at: string) => run(db,
  `INSERT INTO mfa_factors (user_id, secret_enc, status, created_at) VALUES (?1, ?2, 'pending', ?3)
   ON CONFLICT(user_id) DO UPDATE SET secret_enc = excluded.secret_enc, created_at = excluded.created_at, last_step = NULL WHERE mfa_factors.status = 'pending'`,
  userId, secretEnc, at);
export const activateFactor = (db: DB, userId: string, step: number, at: string) =>
  run(db, "UPDATE mfa_factors SET status = 'active', enabled_at = ?2, last_step = ?3 WHERE user_id = ?1 AND status = 'pending'", userId, at, step);
// Atomic: succeeds only if this step is newer than the last one used, so two requests cannot both use one code.
export const claimStep = async (db: DB, userId: string, step: number) =>
  !!(await one<{ user_id: string }>(db, "UPDATE mfa_factors SET last_step = ?2 WHERE user_id = ?1 AND (last_step IS NULL OR last_step < ?2) RETURNING user_id", userId, step));
export const deleteFactor = (db: DB, userId: string) => db.batch([
  db.prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?1").bind(userId),
  db.prepare("DELETE FROM mfa_factors WHERE user_id = ?1").bind(userId),
]);

export const replaceRecoveryCodes = (db: DB, userId: string, hashes: string[], at: string) => db.batch([
  db.prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?1").bind(userId),
  ...hashes.map((h) => db.prepare("INSERT INTO mfa_recovery_codes (id, user_id, code_hash, created_at) VALUES (?1, ?2, ?3, ?4)").bind(crypto.randomUUID(), userId, h, at)),
]);
// Atomic single use.
export const useRecoveryCode = async (db: DB, userId: string, hash: string, at: string) =>
  !!(await one<{ id: string }>(db, "UPDATE mfa_recovery_codes SET used_at = ?3 WHERE user_id = ?1 AND code_hash = ?2 AND used_at IS NULL RETURNING id", userId, hash, at));
export const recoveryLeft = async (db: DB, userId: string) =>
  (await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM mfa_recovery_codes WHERE user_id = ?1 AND used_at IS NULL", userId))?.n ?? 0;
export const factorsForUsers = async (db: DB, ids: string[]) => {
  try { return await all<{ user_id: string; status: string }>(db, "SELECT user_id, status FROM mfa_factors WHERE user_id IN (SELECT value FROM json_each(?1))", JSON.stringify(ids)); }
  catch { return []; }
};
