-- Stage 2C: owner identity binding and audit integrity. Additive only (new table and triggers; no data changed except
-- copying an existing bootstrap record, if one exists, into the new table).

-- The platform owner, fixed at the one-time bootstrap. One row at most (id = 1), so two bootstrap attempts cannot both
-- succeed. The owner is the account with this user_id AND whose email equals both this row and OWNER_EMAIL; changing
-- OWNER_EMAIL therefore cannot make anyone else the owner (the owner console reports the mismatch instead).
CREATE TABLE IF NOT EXISTS owner_record (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  user_id          TEXT NOT NULL REFERENCES users(id),
  email            TEXT NOT NULL,
  bootstrapped_at  TEXT NOT NULL
);

-- A bootstrap completed before this migration (stored in app_settings by Stage 2B) is carried over.
INSERT OR IGNORE INTO owner_record (id, user_id, email, bootstrapped_at)
  SELECT 1, json_extract(value, '$.by'), lower(json_extract(value, '$.email')), json_extract(value, '$.at')
  FROM app_settings WHERE key = 'owner_bootstrap' AND json_extract(value, '$.by') IS NOT NULL;

-- The owner record can be neither changed nor deleted by the application. Transferring ownership is a deliberate,
-- documented database operation (docs/SMA_STAGE_2C_FINAL_SECURITY_GATE.md, section 4).
CREATE TRIGGER IF NOT EXISTS owner_record_no_update BEFORE UPDATE ON owner_record
BEGIN
  SELECT RAISE(ABORT, 'owner_record is fixed after bootstrap');
END;
CREATE TRIGGER IF NOT EXISTS owner_record_no_delete BEFORE DELETE ON owner_record
BEGIN
  SELECT RAISE(ABORT, 'owner_record is fixed after bootstrap');
END;

-- The audit log is append-only: no entry can be changed, and no entry younger than 365 days (the minimum retention
-- period) can be deleted, whatever the application or a retention setting asks for.
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
CREATE TRIGGER IF NOT EXISTS audit_log_min_retention BEFORE DELETE ON audit_log
WHEN OLD.at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-365 days')
BEGIN
  SELECT RAISE(ABORT, 'audit entries younger than 365 days cannot be deleted');
END;
