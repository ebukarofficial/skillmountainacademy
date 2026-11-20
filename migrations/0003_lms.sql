-- Skill Mountain Academy learning platform (LMS). Apply with: npm run db:migrate
-- Roles: student, instructor, admin. Every table that holds private data is reached only through the
-- Worker's permission checks (src/server/lms/*), never directly from the browser.
-- Times: ISO 8601 UTC strings. Timetable times are Africa/Lagos wall-clock (UTC+1, no daylight saving).

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  role           TEXT NOT NULL CHECK (role IN ('student', 'instructor', 'admin')),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  full_name      TEXT NOT NULL,
  phone          TEXT,
  bio            TEXT,
  photo_key      TEXT,                -- R2 object key
  student_no     TEXT UNIQUE,         -- students only, e.g. SMA26-7KQ2M
  specialization TEXT,                -- instructors
  qualifications TEXT,                -- instructors: JSON array of strings
  links          TEXT,                -- instructors: JSON object {linkedin, portfolio, ...}
  registration_id TEXT,               -- the website registration this account came from, if any
  created_at     TEXT NOT NULL,
  last_login_at  TEXT
);

-- One-time sign-in links. Only a SHA-256 hash of the token is stored.
CREATE TABLE auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX auth_tokens_user ON auth_tokens(user_id);

-- Signed-in sessions (cookie holds the token; only its hash is stored).
CREATE TABLE auth_sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail      TEXT,
  ip_hash     TEXT
);
CREATE INDEX audit_log_at ON audit_log(at);

-- Courses inside a programme, and lessons inside a course.
CREATE TABLE courses (
  id             TEXT PRIMARY KEY,
  programme_slug TEXT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX courses_programme ON courses(programme_slug, position);
CREATE TABLE lessons (
  id         TEXT PRIMARY KEY,
  course_id  TEXT NOT NULL REFERENCES courses(id),
  title      TEXT NOT NULL,
  objectives TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX lessons_course ON lessons(course_id, position);

-- A student on a programme, with their assigned instructor.
CREATE TABLE enrolments (
  id             TEXT PRIMARY KEY,
  student_id     TEXT NOT NULL REFERENCES users(id),
  programme_slug TEXT NOT NULL,
  instructor_id  TEXT REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'withdrawn')),
  order_id       TEXT,                -- orders.id from the website checkout, if any
  started_at     TEXT NOT NULL,
  completed_at   TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE (student_id, programme_slug)
);
CREATE INDEX enrolments_instructor ON enrolments(instructor_id);

-- The FIXED weekly timetable. Never changed by session actions. An admin change closes the old row
-- (effective_to) and adds a new one, so history is kept.
CREATE TABLE timetables (
  id             TEXT PRIMARY KEY,
  enrolment_id   TEXT NOT NULL REFERENCES enrolments(id),
  weekday        INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday
  start_time     TEXT NOT NULL,                                       -- HH:MM Lagos time
  duration_min   INTEGER NOT NULL CHECK (duration_min BETWEEN 45 AND 60),
  effective_from TEXT NOT NULL,                                       -- YYYY-MM-DD
  effective_to   TEXT,                                                -- YYYY-MM-DD, NULL = current
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX timetables_enrolment ON timetables(enrolment_id);

-- Individual class records generated from the timetable (or added by an admin).
CREATE TABLE class_sessions (
  id               TEXT PRIMARY KEY,
  enrolment_id     TEXT NOT NULL REFERENCES enrolments(id),
  timetable_id     TEXT REFERENCES timetables(id),
  student_id       TEXT NOT NULL REFERENCES users(id),
  instructor_id    TEXT REFERENCES users(id),
  starts_at        TEXT NOT NULL,
  ends_at          TEXT NOT NULL,
  meet_url         TEXT,
  meet_updated_at  TEXT,
  meet_notified_at TEXT,
  status           TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'missed', 'cancelled', 'rescheduled')),
  outcome_at       TEXT,
  outcome_by       TEXT,
  notes            TEXT,
  rescheduled_to   TEXT,
  reminded_24h_at  TEXT,
  reminded_1h_at   TEXT,
  reminded_15m_at  TEXT,
  link_missing_alert_at TEXT,
  created_at       TEXT NOT NULL,
  UNIQUE (timetable_id, starts_at)
);
CREATE INDEX class_sessions_student ON class_sessions(student_id, starts_at);
CREATE INDEX class_sessions_instructor ON class_sessions(instructor_id, starts_at);
CREATE INDEX class_sessions_due ON class_sessions(status, starts_at);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  created_at TEXT NOT NULL,
  read_at    TEXT,
  emailed_at TEXT
);
CREATE INDEX notifications_user ON notifications(user_id, created_at);

-- Learning materials. text_content feeds the AI assistant's search (resource_chunks).
CREATE TABLE resources (
  id             TEXT PRIMARY KEY,
  programme_slug TEXT NOT NULL,
  course_id      TEXT REFERENCES courses(id),
  title          TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('document', 'video', 'link', 'exercise')),
  url            TEXT,
  file_key       TEXT,
  file_name      TEXT,
  text_content   TEXT,
  approved       INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX resources_programme ON resources(programme_slug);

CREATE TABLE assignments (
  id             TEXT PRIMARY KEY,
  student_id     TEXT NOT NULL REFERENCES users(id),
  instructor_id  TEXT NOT NULL REFERENCES users(id),
  enrolment_id   TEXT NOT NULL REFERENCES enrolments(id),
  title          TEXT NOT NULL,
  description    TEXT,
  due_at         TEXT NOT NULL,
  max_score      INTEGER NOT NULL DEFAULT 100,
  created_at     TEXT NOT NULL
);
CREATE INDEX assignments_student ON assignments(student_id, due_at);
CREATE TABLE submissions (
  id            TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL UNIQUE REFERENCES assignments(id),
  student_id    TEXT NOT NULL REFERENCES users(id),
  text          TEXT,
  file_key      TEXT,
  file_name     TEXT,
  submitted_at  TEXT NOT NULL,
  score         INTEGER,
  feedback      TEXT,
  graded_at     TEXT,
  graded_by     TEXT
);

-- Quizzes (auto-marked multiple choice) and assessments (marked by the instructor).
CREATE TABLE quizzes (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL REFERENCES users(id),
  instructor_id TEXT NOT NULL REFERENCES users(id),
  enrolment_id  TEXT NOT NULL REFERENCES enrolments(id),
  kind          TEXT NOT NULL CHECK (kind IN ('quiz', 'assessment')),
  title         TEXT NOT NULL,
  instructions  TEXT,
  duration_min  INTEGER,
  due_at        TEXT NOT NULL,
  questions     TEXT NOT NULL,       -- JSON; correct answers are never sent to the student
  max_score     INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX quizzes_student ON quizzes(student_id, due_at);
CREATE TABLE quiz_attempts (
  id           TEXT PRIMARY KEY,
  quiz_id      TEXT NOT NULL UNIQUE REFERENCES quizzes(id),
  student_id   TEXT NOT NULL REFERENCES users(id),
  started_at   TEXT NOT NULL,
  submitted_at TEXT,
  answers      TEXT,
  score        INTEGER,
  feedback     TEXT,
  graded_at    TEXT,
  graded_by    TEXT
);

CREATE TABLE lesson_progress (
  student_id   TEXT NOT NULL REFERENCES users(id),
  lesson_id    TEXT NOT NULL REFERENCES lessons(id),
  completed_at TEXT NOT NULL,
  PRIMARY KEY (student_id, lesson_id)
);

-- Student <-> instructor messages (only between a student and an instructor assigned to them).
CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL REFERENCES users(id),
  to_id      TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at    TEXT
);
CREATE INDEX messages_to ON messages(to_id, created_at);
CREATE INDEX messages_pair ON messages(from_id, to_id, created_at);

CREATE TABLE instructor_ratings (
  id            TEXT PRIMARY KEY,
  student_id    TEXT NOT NULL REFERENCES users(id),
  instructor_id TEXT NOT NULL REFERENCES users(id),
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (student_id, instructor_id)
);

-- AI assistant history and searchable chunks of approved materials.
CREATE TABLE ai_messages (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ai_messages_student ON ai_messages(student_id, created_at);
CREATE VIRTUAL TABLE resource_chunks USING fts5(resource_id UNINDEXED, programme_slug UNINDEXED, title, body);

-- Errors caught by the Worker, for the admin dashboard.
CREATE TABLE error_log (
  id      TEXT PRIMARY KEY,
  at      TEXT NOT NULL,
  route   TEXT,
  message TEXT
);
CREATE INDEX error_log_at ON error_log(at);
