// Owner login-email transition (Institutional Dashboard stage; made atomic in the hardening pass).
// Moves the EXISTING owner account to a new email address, keeping its internal user id, its owner_record row
// (user_id and bootstrapped_at unchanged), its authenticator, its group and every historical record. It never creates
// an account, never creates a second owner and never takes over an account that already uses the new address.
//
// It follows the documented D1 owner procedure (docs/SMA_STAGE_2C_FINAL_SECURITY_GATE.md, section 4): owner_record is
// protected by the owner_record_no_update trigger, so the trigger is dropped, the record's email changed and the
// trigger re-created. ALL statements below must run as ONE D1 batch, which D1 executes as a single SQL transaction
// (SQLite DDL is transactional, so the trigger drop is rolled back too):
//   1. drop the trigger            2. move the account's email     3. move owner_record's email
//   4. re-create the trigger       5. write the audit event = THE GUARD (below)
//   6. end the owner's sessions    7. cancel unused sign-in links
// The audit insert has no FROM clause, so it always runs; its NOT NULL `at` value is present only when every expected
// result holds (record and account both on the new address, same account, an active administrator, trigger back in
// place, no other account on the new address) AND this very batch moved the record (changes() = 1: the last data change
// before the guard, the owner_record update, touched one row; a repeated run moves nothing and is refused). Otherwise the insert fails and D1 rolls the WHOLE batch back: the
// database is unchanged and the trigger is still there. A failure in any other statement rolls back the same way.
//
// Pure module (no imports): used by scripts/owner/transition-email.mts and by the tests.
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
export const TRANSITION_GUARD_ERROR = /NOT NULL constraint failed: audit_log\.at/;

export function ownerEmailTransitionSql(fromRaw: string, toRaw: string, nowIso: string): string[] {
  const from = fromRaw.trim().toLowerCase(), to = toRaw.trim().toLowerCase();
  if (!EMAIL.test(from) || !EMAIL.test(to)) throw new Error("Both addresses must be plain email addresses.");
  if (from === to) throw new Error("The new address is the same as the current one.");
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(nowIso)) throw new Error("Invalid timestamp.");
  // Validated above to contain no quote characters, so they are safe as SQL literals.
  const F = `'${from}'`, T = `'${to}'`, N = `'${nowIso}'`;
  const ownerId = "(SELECT user_id FROM owner_record WHERE id = 1)";
  const done = `EXISTS (SELECT 1 FROM owner_record r JOIN users u ON u.id = r.user_id WHERE r.id = 1 AND lower(r.email) = ${T} AND lower(u.email) = ${T}
      AND u.role = 'admin' AND u.status = 'active' AND u.removed_at IS NULL)
    AND (SELECT COUNT(*) FROM users WHERE lower(email) = ${T}) = 1
    AND EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'owner_record_no_update' AND tbl_name = 'owner_record')
    AND changes() = 1`;
  return [
    "DROP TRIGGER IF EXISTS owner_record_no_update",
    `UPDATE users SET email = ${T} WHERE id = (SELECT user_id FROM owner_record WHERE id = 1 AND lower(email) = ${F}) AND lower(email) = ${F} AND NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = ${T})`,
    `UPDATE owner_record SET email = ${T} WHERE id = 1 AND lower(email) = ${F} AND EXISTS (SELECT 1 FROM users u WHERE u.id = owner_record.user_id AND lower(u.email) = ${T})`,
    "CREATE TRIGGER IF NOT EXISTS owner_record_no_update BEFORE UPDATE ON owner_record BEGIN SELECT RAISE(ABORT, 'owner_record is fixed after bootstrap'); END",
    `INSERT INTO audit_log (id, at, actor_id, action, target_type, target_id, detail) SELECT lower(hex(randomblob(16))), CASE WHEN ${done} THEN ${N} END, NULL, 'owner.email_transition', 'user', ${ownerId}, '{"from":"${from}","to":"${to}","via":"scripts/owner/transition-email.mts"}'`,
    `DELETE FROM auth_sessions WHERE user_id = ${ownerId}`,
    `UPDATE auth_tokens SET used_at = ${N} WHERE used_at IS NULL AND user_id = ${ownerId}`,
  ];
}
