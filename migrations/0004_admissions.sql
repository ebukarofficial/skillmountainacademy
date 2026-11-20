-- Admissions, programme capacity and instructor verification.
-- Safe on a live database: it only adds tables and columns. Every programme starts OPEN with capacity
-- limits OFF, so registration keeps working exactly as before until an admin changes a setting.

-- One row per programme: how admissions are decided, and the capacity settings (admins only).
CREATE TABLE programme_admissions (
  programme_slug       TEXT PRIMARY KEY,
  mode                 TEXT NOT NULL DEFAULT 'open' CHECK (mode IN ('open', 'scheduled', 'closed')),
  enforce_capacity     INTEGER NOT NULL DEFAULT 0,   -- 1 = stop new registrations when the programme is full
  default_instructor_cap INTEGER NOT NULL DEFAULT 30, -- students per instructor when an assignment has no own figure
  reserved             INTEGER NOT NULL DEFAULT 0,   -- places held back by the admin (for example, agreed sponsorships)
  listed               INTEGER NOT NULL DEFAULT 1,   -- 0 = hidden from the programme listings (the page still exists)
  updated_at           TEXT,
  updated_by           TEXT
);
INSERT INTO programme_admissions (programme_slug) VALUES
  ('graphics'), ('uiux'), ('webdev'), ('marketing'), ('cybersecurity'), ('cloud'), ('devops'), ('cloud-devops');

-- Admission periods. programme_slug NULL = applies to every programme. Used when a programme's mode is 'scheduled'.
CREATE TABLE admission_periods (
  id             TEXT PRIMARY KEY,
  programme_slug TEXT,
  label          TEXT,
  opens_at       TEXT NOT NULL,   -- ISO time
  closes_at      TEXT NOT NULL,   -- ISO time
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  cancelled_at   TEXT
);
CREATE INDEX admission_periods_window ON admission_periods(opens_at, closes_at);

-- Which programmes an instructor teaches, and how many students they can take on for it.
CREATE TABLE instructor_programmes (
  instructor_id  TEXT NOT NULL REFERENCES users(id),
  programme_slug TEXT NOT NULL,
  max_students   INTEGER,         -- NULL = the programme's default_instructor_cap
  created_at     TEXT NOT NULL,
  PRIMARY KEY (instructor_id, programme_slug)
);
CREATE INDEX instructor_programmes_slug ON instructor_programmes(programme_slug);

-- Instructor verification. Values: application_received, under_review, assessment_pending, interview_pending,
-- approved, rejected, suspended. Only 'approved' instructors can sign in and be assigned students.
ALTER TABLE users ADD COLUMN verification TEXT;
ALTER TABLE users ADD COLUMN verification_checks TEXT;   -- JSON: {identity, credentials, portfolio, technical, teaching, interview, references}
ALTER TABLE users ADD COLUMN highest_qualification TEXT;
ALTER TABLE users ADD COLUMN experience TEXT;
ALTER TABLE users ADD COLUMN public_profile INTEGER NOT NULL DEFAULT 0;  -- 1 = shown on the public Faculty page

-- Instructors added before this change were already teaching, so they count as approved.
UPDATE users SET verification = 'approved' WHERE role = 'instructor';
