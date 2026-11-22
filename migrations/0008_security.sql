-- Stage 2 security remediation (22 Nov 2026). ADDITIVE ONLY: new columns and new tables. Nothing is dropped, renamed or
-- rewritten, and no existing row is changed. Safe to apply before or after deploying the matching code.

-- Sessions: the time of the last GENUINE user activity (clicks, typing, touches, deliberate scrolling) reported by the
-- dashboard. Background requests never update it. Used for the idle timeout (students: 10 minutes).
ALTER TABLE auth_sessions ADD COLUMN last_activity_at TEXT;
-- Administrator second factor: 1 while a session has passed the email link but not yet the authenticator code.
ALTER TABLE auth_sessions ADD COLUMN mfa_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auth_sessions ADD COLUMN mfa_verified_at TEXT;

-- Administrator permission group. NULL = an existing administrator who has not been assigned a group yet: they keep the
-- full access they have today until the owner assigns one (no automatic promotion, no automatic loss of access).
ALTER TABLE users ADD COLUMN admin_role TEXT
  CHECK (admin_role IS NULL OR admin_role IN ('super', 'admissions', 'finance', 'academic', 'faculty', 'support', 'reporting'));

-- Authenticator-app (TOTP) factor. The shared secret is stored ENCRYPTED (AES-GCM with the MFA_ENCRYPTION_KEY secret),
-- never in plain text. last_step stops the same 30-second code being used twice.
CREATE TABLE IF NOT EXISTS mfa_factors (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  secret_enc  TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  created_at  TEXT NOT NULL,
  enabled_at  TEXT,
  last_step   INTEGER
);

-- One-time recovery codes: only a hash is stored; used_at makes each code single use.
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  code_hash   TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user ON mfa_recovery_codes(user_id);
