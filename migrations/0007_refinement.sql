-- 0007: AI Automation programme row, plus the tables for the final refinement brief (added below).
-- Safe on a live database: only inserts and new tables/columns; existing records are untouched.
INSERT INTO programmes (slug, name, price_kobo, was_kobo, timed_price_kobo, group_price_kobo, training_months, internship_months, level, updated_at)
VALUES ('ai-automation', 'AI Automation', 30000000, NULL, NULL, NULL, 1, 1, 'Beginner to intermediate', datetime('now'))
ON CONFLICT(slug) DO UPDATE SET name = excluded.name, price_kobo = excluded.price_kobo, training_months = excluded.training_months,
  internship_months = excluded.internship_months, level = excluded.level, updated_at = excluded.updated_at;

-- Book a call: requests from the website, handled in the admin Admissions workspace.
CREATE TABLE IF NOT EXISTS call_bookings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  programme TEXT,                 -- programme slug, or NULL for "not sure yet"
  preferred_date TEXT NOT NULL,   -- YYYY-MM-DD in the applicant's time zone
  preferred_time TEXT NOT NULL,   -- HH:MM in the applicant's time zone
  timezone TEXT NOT NULL,         -- IANA name, e.g. Europe/London
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',   -- new | assigned | contacted | closed
  assigned_to TEXT REFERENCES users(id),
  notes TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_call_bookings_status ON call_bookings(status, created_at);

-- On-site admissions assistant: one row per question, for authorised administrators only.
-- Deleted automatically after 180 days (see the daily cron); never shown to other visitors.
CREATE TABLE IF NOT EXISTS assistant_enquiries (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,   -- random reference created in the visitor's browser
  question TEXT NOT NULL,
  answer TEXT,
  programme TEXT,                  -- programme slug the question concerns, when known
  answered INTEGER NOT NULL DEFAULT 1,
  needs_followup INTEGER NOT NULL DEFAULT 0,
  handled_at TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistant_enquiries_created ON assistant_enquiries(created_at);
CREATE INDEX IF NOT EXISTS idx_assistant_enquiries_followup ON assistant_enquiries(needs_followup, handled_at);

-- Attendance detail recorded with a class outcome: on_time or late (attended), excused (missed with a reason).
ALTER TABLE class_sessions ADD COLUMN attendance_detail TEXT;
-- An instructor's own Google Meet room, applied to their scheduled classes on request.
ALTER TABLE users ADD COLUMN meet_link TEXT;

-- Weekly study checklist. A row exists only once something has happened: a student ticked a study item, or an instructor
-- set a task (item_key 'task:<id>'). Items backed by records (lesson completed, assignment submitted, test taken, AI revision)
-- are worked out from those records and are never stored as ticked without them.
CREATE TABLE IF NOT EXISTS weekly_items (
  id                TEXT PRIMARY KEY,
  enrolment_id      TEXT NOT NULL REFERENCES enrolments(id),
  student_id        TEXT NOT NULL REFERENCES users(id),
  week_start        TEXT NOT NULL,            -- Monday, YYYY-MM-DD, Lagos time
  item_key          TEXT NOT NULL,
  title             TEXT,                     -- instructor tasks only
  detail            TEXT,
  assigned_by       TEXT REFERENCES users(id),
  completed_at      TEXT,
  completion_note   TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (enrolment_id, week_start, item_key)
);
CREATE INDEX IF NOT EXISTS weekly_items_student ON weekly_items(student_id, week_start);

-- Settings the Academy can change without a deploy (e.g. engagement alert thresholds). Values are JSON.
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- Guardian details on the student account. A guardian is contacted only when contact has been authorised.
ALTER TABLE users ADD COLUMN guardian_name TEXT;
ALTER TABLE users ADD COLUMN guardian_relationship TEXT;
ALTER TABLE users ADD COLUMN guardian_email TEXT;
ALTER TABLE users ADD COLUMN guardian_phone TEXT;
ALTER TABLE users ADD COLUMN guardian_contact_ok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN guardian_contact_note TEXT;   -- who authorised it and how (e.g. "Signed admission form, 3 Oct 2026")

-- Every email, call or attempt made to a student or guardian by the Academy.
CREATE TABLE IF NOT EXISTS contact_log (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES users(id),
  target      TEXT NOT NULL CHECK (target IN ('student', 'guardian')),
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'call', 'sms', 'whatsapp', 'in_person')),
  outcome     TEXT NOT NULL CHECK (outcome IN ('sent', 'reached', 'no_answer', 'left_message', 'wrong_number', 'failed')),
  subject     TEXT,
  summary     TEXT,
  by_user     TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contact_log_student ON contact_log(student_id, created_at);
