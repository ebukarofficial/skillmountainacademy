-- Institutional identifiers and notification priority. Safe on live data: adds a table, columns and indexes only.
--   Students:    SMA/26/000001  (year of admission, then a sequence per year)
--   Instructors: SMA/FAC/000001 (given when approved)
--   Admins:      SMA/ADM/000001
-- Existing student numbers (format SMA26-XXXXX) are kept unchanged, so nothing already sent to a student changes.

CREATE TABLE id_sequences (
  name TEXT PRIMARY KEY,          -- e.g. 'STU:26', 'FAC', 'ADM'
  last INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE users ADD COLUMN staff_no TEXT;
ALTER TABLE users ADD COLUMN email_prefs TEXT;   -- JSON {reminders: bool, updates: bool}; null = all on

-- Numbers already issued to existing staff, oldest first.
UPDATE users SET staff_no = 'SMA/ADM/' || printf('%06d', (SELECT COUNT(*) FROM users u2 WHERE u2.role = 'admin'
  AND (u2.created_at < users.created_at OR (u2.created_at = users.created_at AND u2.id <= users.id)))) WHERE role = 'admin';
UPDATE users SET staff_no = 'SMA/FAC/' || printf('%06d', (SELECT COUNT(*) FROM users u2 WHERE u2.role = 'instructor' AND u2.verification = 'approved'
  AND (u2.created_at < users.created_at OR (u2.created_at = users.created_at AND u2.id <= users.id)))) WHERE role = 'instructor' AND verification = 'approved';
INSERT INTO id_sequences (name, last) VALUES
  ('ADM', (SELECT COUNT(*) FROM users WHERE role = 'admin')),
  ('FAC', (SELECT COUNT(*) FROM users WHERE role = 'instructor' AND verification = 'approved'));

-- No two people can ever hold the same number.
CREATE UNIQUE INDEX users_student_no ON users(student_no) WHERE student_no IS NOT NULL;
CREATE UNIQUE INDEX users_staff_no ON users(staff_no) WHERE staff_no IS NOT NULL;

-- 'urgent' notices (class starting, payment overdue, link changed) are shown first.
ALTER TABLE notifications ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
