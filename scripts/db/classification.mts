// Backup classification of every table in the Academy database (Stage 3A).
//
// Every table is backed up in full; the class says how its loss would hurt and how it must be treated. Financial,
// academic, identity and security records are NEVER disposable, even where the application could regenerate something
// similar. A test fails when a migration adds a table that is not classified here.
//
//   identity        who people are: accounts, applicants, staff/registration numbers
//   academic        teaching records: enrolments, timetables, classes and attendance, work, grades, progress, content
//   financial       money: orders, instalments, payments, payment events, price holds
//   admissions      applications, admission periods, enquiries, call bookings
//   communications  messages, notifications, assistant conversations, contact history
//   security        audit log, owner record, two-step sign-in, removal requests, platform settings
//   reference       data the migrations themselves create (programme catalogue, migration history)
//   disposable      short-lived operational rows that are safe to lose: sign-in links, sessions, rate-limit counters,
//                   technical error records (still backed up; after a restore, sessions are cleared, see the runbook)
export type DataClass = "identity" | "academic" | "financial" | "admissions" | "communications" | "security" | "reference" | "disposable";
export type TableClass = { class: DataClass; seeded?: boolean; note?: string };

export const CLASSIFICATION: Record<string, TableClass> = {
  users: { class: "identity", note: "students, instructors, administrators; removed staff stay as records" },
  registrations: { class: "identity", note: "applicants and learners as registered" },
  id_sequences: { class: "identity", seeded: true, note: "last issued registration/staff numbers: losing it could reissue numbers" },
  instructor_programmes: { class: "identity", note: "which programmes each instructor may teach" },
  enrolments: { class: "academic" },
  timetables: { class: "academic" },
  class_sessions: { class: "academic", note: "classes and ATTENDANCE (status completed/missed)" },
  assignments: { class: "academic" },
  submissions: { class: "academic", note: "student work and GRADES (score, graded_at)" },
  quizzes: { class: "academic" },
  quiz_attempts: { class: "academic", note: "assessment history" },
  lesson_progress: { class: "academic" },
  weekly_items: { class: "academic" },
  courses: { class: "academic" },
  lessons: { class: "academic" },
  resources: { class: "academic" },
  resource_chunks: { class: "academic", note: "full-text search index of resources (FTS5)" },
  instructor_ratings: { class: "academic" },
  orders: { class: "financial" },
  instalments: { class: "financial" },
  payments: { class: "financial" },
  webhook_events: { class: "financial", note: "payment-provider events already processed (prevents double crediting)" },
  holds: { class: "financial", note: "timed price holds" },
  programme_admissions: { class: "admissions", seeded: true },
  admission_periods: { class: "admissions" },
  call_bookings: { class: "admissions" },
  assistant_enquiries: { class: "admissions" },
  children_enquiries: { class: "admissions" },
  messages: { class: "communications" },
  notifications: { class: "communications" },
  ai_messages: { class: "communications" },
  contact_log: { class: "communications" },
  audit_log: { class: "security" },
  owner_record: { class: "security" },
  mfa_factors: { class: "security", note: "secrets encrypted with MFA_ENCRYPTION_KEY (not in the backup): restore needs the same key" },
  mfa_recovery_codes: { class: "security", note: "hashed recovery codes" },
  staff_removal_requests: { class: "security" },
  app_settings: { class: "security", note: "platform settings incl. owner policy, retention, used recovery tokens" },
  programmes: { class: "reference", seeded: true },
  schools: { class: "reference", seeded: true },
  programme_drafts: { class: "reference", seeded: true, note: "unpublished catalogue edits; never public" },
  d1_migrations: { class: "reference", note: "migration history: required to know the schema version" },
  auth_tokens: { class: "disposable" },
  auth_sessions: { class: "disposable" },
  rate_limits: { class: "disposable" },
  error_log: { class: "disposable" },
};

// Rows that are genuinely the Academy's records (not created by migrations, not disposable).
export const isInstitutional = (table: string) => {
  const c = CLASSIFICATION[table];
  return !!c && c.class !== "reference" && c.class !== "disposable" && !c.seeded;
};
