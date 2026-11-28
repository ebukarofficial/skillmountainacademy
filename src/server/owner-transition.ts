// Owner login-email transition (Institutional Dashboard stage). Moves the EXISTING owner account to a new email address,
// keeping its internal user id, its owner_record row (user_id unchanged), its authenticator, its group and every
// historical record. It never creates an account and never creates a second owner.
//
// It follows the documented D1 owner procedure (docs/SMA_STAGE_2C_FINAL_SECURITY_GATE.md, section 4): owner_record is
// protected by the owner_record_no_update trigger, so the trigger is dropped, the record's email changed, and the
// trigger re-created. Every change is guarded: nothing happens unless owner_record still holds the OLD address and no
// account already uses the NEW address. Re-running it after an interruption completes it; running it twice is a no-op.
// The owner's sessions and unused sign-in links end, so the next sign-in must use the new address (with the same
// authenticator). OWNER_EMAIL must be changed to the new address at the same time; until both agree, nobody is owner.
//
// Pure module (no imports): used by scripts/owner/transition-email.mts and by the tests.
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
export function ownerEmailTransitionSql(fromRaw: string, toRaw: string, nowIso: string): string[] {
  const from = fromRaw.trim().toLowerCase(), to = toRaw.trim().toLowerCase();
  if (!EMAIL.test(from) || !EMAIL.test(to)) throw new Error("Both addresses must be plain email addresses.");
  if (from === to) throw new Error("The new address is the same as the current one.");
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(nowIso)) throw new Error("Invalid timestamp.");
  // Validated above to contain no quote characters, so they are safe as SQL literals in a --file run.
  const F = `'${from}'`, T = `'${to}'`, N = `'${nowIso}'`;
  const ownerId = `(SELECT user_id FROM owner_record WHERE id = 1)`;
  return [
    "DROP TRIGGER IF EXISTS owner_record_no_update;",
    `UPDATE users SET email = ${T} WHERE id = (SELECT user_id FROM owner_record WHERE id = 1 AND lower(email) = ${F}) AND lower(email) = ${F} AND NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = ${T});`,
    `UPDATE owner_record SET email = ${T} WHERE id = 1 AND lower(email) = ${F} AND EXISTS (SELECT 1 FROM users u WHERE u.id = owner_record.user_id AND lower(u.email) = ${T});`,
    "CREATE TRIGGER IF NOT EXISTS owner_record_no_update BEFORE UPDATE ON owner_record BEGIN SELECT RAISE(ABORT, 'owner_record is fixed after bootstrap'); END;",
    `INSERT INTO audit_log (id, at, actor_id, action, target_type, target_id, detail) SELECT lower(hex(randomblob(16))), ${N}, NULL, 'owner.email_transition', 'user', user_id, '{"from":"${from}","to":"${to}","via":"scripts/owner/transition-email.mts"}' FROM owner_record WHERE id = 1 AND lower(email) = ${T} AND NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'owner.email_transition' AND detail LIKE '%"to":"${to}"%');`,
    `DELETE FROM auth_sessions WHERE user_id = ${ownerId} AND EXISTS (SELECT 1 FROM audit_log WHERE action = 'owner.email_transition' AND at = ${N} AND detail LIKE '%"to":"${to}"%');`,
    `UPDATE auth_tokens SET used_at = ${N} WHERE used_at IS NULL AND user_id = ${ownerId} AND EXISTS (SELECT 1 FROM audit_log WHERE action = 'owner.email_transition' AND at = ${N} AND detail LIKE '%"to":"${to}"%');`,
  ];
}
