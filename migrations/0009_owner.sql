-- Stage 2B (22 Nov 2026): owner controls, permanent removal approvals, MFA re-enrolment. ADDITIVE ONLY.
-- The owner is identified by the OWNER_EMAIL variable (wrangler.jsonc), not by anything stored here, so no row can be
-- edited to make someone the owner. Bootstrap completion is recorded in app_settings (key 'owner_bootstrap').

-- Permanent removal: the account can never sign in again; its records (payments, enrolments, grades, attendance,
-- messages, audit) are kept for institutional, financial and legal reasons.
ALTER TABLE users ADD COLUMN removed_at TEXT;
ALTER TABLE users ADD COLUMN removed_by TEXT;
ALTER TABLE users ADD COLUMN removal_reason TEXT;

-- After an MFA reset the administrator must enrol again before using administration, even when MFA is not yet required
-- for everyone.
ALTER TABLE users ADD COLUMN mfa_required INTEGER NOT NULL DEFAULT 0;

-- A Super Administrator asks; only the owner approves or rejects.
CREATE TABLE IF NOT EXISTS staff_removal_requests (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  requested_by  TEXT NOT NULL REFERENCES users(id),
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by    TEXT REFERENCES users(id),
  decided_at    TEXT,
  decision_note TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_removal_requests_status ON staff_removal_requests(status, created_at);
