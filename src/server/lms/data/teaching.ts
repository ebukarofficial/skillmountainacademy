// Courses, lessons, timetables, class sessions and notifications.
import { all, batch, insert, one, run, stmt, update, type DB } from "./base";

// ---------- courses and lessons ----------
export type Course = { id: string; programme_slug: string; title: string; description: string | null; position: number; created_at: string };
export type Lesson = { id: string; course_id: string; title: string; objectives: string | null; position: number; created_at: string };
export const programmeCourses = (db: DB, slug: string) => all<Course>(db, "SELECT * FROM courses WHERE programme_slug = ?1 ORDER BY position, created_at", slug);
export const programmeLessons = (db: DB, slug: string) => all<Lesson>(db, "SELECT l.* FROM lessons l JOIN courses c ON c.id = l.course_id WHERE c.programme_slug = ?1 ORDER BY c.position, l.position", slug);
export const getCourse = (db: DB, id: string) => one<Course>(db, "SELECT * FROM courses WHERE id = ?1", id);
export const getLesson = (db: DB, id: string) => one<Lesson & { programme_slug: string }>(db, "SELECT l.*, c.programme_slug FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?1", id);
export const createCourse = (db: DB, c: Course) => insert(db, "courses", c);
export const updateCourse = (db: DB, id: string, p: Partial<Course>) => update(db, "courses", id, p);
export const createLesson = (db: DB, l: Lesson) => insert(db, "lessons", l);
export const updateLesson = (db: DB, id: string, p: Partial<Lesson>) => update(db, "lessons", id, p);

// ---------- timetables (the FIXED weekly slot) ----------
export type Timetable = { id: string; enrolment_id: string; weekday: number; start_time: string; duration_min: number; effective_from: string; effective_to: string | null; created_by: string; created_at: string };
export const currentTimetable = (db: DB, enrolmentId: string) => one<Timetable>(db, "SELECT * FROM timetables WHERE enrolment_id = ?1 AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1", enrolmentId);
export const timetableHistory = (db: DB, enrolmentId: string) => all<Timetable>(db, "SELECT * FROM timetables WHERE enrolment_id = ?1 ORDER BY effective_from DESC, created_at DESC", enrolmentId);
// Replaces the weekly slot from `from` (YYYY-MM-DD): closes the old row, adds the new one, and removes FUTURE generated
// sessions of the old slot that have no outcome yet. Past sessions and their records are never touched.
export async function replaceTimetable(db: DB, t: Timetable, dayBefore: string, fromIso: string) {
  await batch(db, [
    stmt(db, "UPDATE timetables SET effective_to = ?2 WHERE enrolment_id = ?1 AND effective_to IS NULL", t.enrolment_id, dayBefore),
    stmt(db, "INSERT INTO timetables (id, enrolment_id, weekday, start_time, duration_min, effective_from, effective_to, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8)",
      t.id, t.enrolment_id, t.weekday, t.start_time, t.duration_min, t.effective_from, t.created_by, t.created_at),
    stmt(db, "DELETE FROM class_sessions WHERE enrolment_id = ?1 AND timetable_id IS NOT NULL AND timetable_id != ?2 AND status = 'scheduled' AND starts_at >= ?3", t.enrolment_id, t.id, fromIso),
  ]);
}

// One statement per Lagos date creates that day's session for every active enrolment whose timetable falls on it.
// INSERT OR IGNORE + UNIQUE(timetable_id, starts_at) makes it safe to run again. Lagos is UTC+1, so subtract an hour.
export function sessionsForDateStmt(db: DB, date: string, weekday: number, now: string, enrolmentId: string | null = null) {
  return stmt(db,
    `INSERT OR IGNORE INTO class_sessions (id, enrolment_id, timetable_id, student_id, instructor_id, starts_at, ends_at, status, created_at)
     SELECT lower(hex(randomblob(16))), e.id, t.id, e.student_id, e.instructor_id,
            strftime('%Y-%m-%dT%H:%M:%fZ', ?1 || ' ' || t.start_time, '-1 hour'),
            strftime('%Y-%m-%dT%H:%M:%fZ', ?1 || ' ' || t.start_time, '-1 hour', '+' || t.duration_min || ' minutes'),
            'scheduled', ?3
     FROM timetables t JOIN enrolments e ON e.id = t.enrolment_id JOIN users s ON s.id = e.student_id
     WHERE e.status = 'active' AND s.status = 'active' AND t.weekday = ?2 AND t.effective_from <= ?1 AND (t.effective_to IS NULL OR t.effective_to >= ?1)
       AND (?4 IS NULL OR e.id = ?4)`, date, weekday, now, enrolmentId);
}
export const runBatch = (db: DB, s: D1PreparedStatement[]) => batch(db, s);

// ---------- class sessions ----------
export type Session = {
  id: string; enrolment_id: string; timetable_id: string | null; student_id: string; instructor_id: string | null; starts_at: string; ends_at: string;
  meet_url: string | null; meet_updated_at: string | null; meet_notified_at: string | null; status: "scheduled" | "completed" | "missed" | "cancelled" | "rescheduled";
  outcome_at: string | null; outcome_by: string | null; notes: string | null; rescheduled_to: string | null; reminded_24h_at: string | null;
  reminded_1h_at: string | null; reminded_15m_at: string | null; link_missing_alert_at: string | null; created_at: string;
};
export type SessionRow = Session & { programme_slug: string; student_name: string; student_email: string; student_photo: string | null; instructor_name: string | null; instructor_email: string | null };
const SESSION_SELECT = `SELECT cs.*, e.programme_slug, s.full_name AS student_name, s.email AS student_email, s.photo_key AS student_photo,
  i.full_name AS instructor_name, i.email AS instructor_email
  FROM class_sessions cs JOIN enrolments e ON e.id = cs.enrolment_id JOIN users s ON s.id = cs.student_id LEFT JOIN users i ON i.id = cs.instructor_id`;
export const getSession = (db: DB, id: string) => one<SessionRow>(db, `${SESSION_SELECT} WHERE cs.id = ?1`, id);
export const createSessionRow = (db: DB, s: Partial<Session> & { id: string }) => insert(db, "class_sessions", s);
export const updateSession = (db: DB, id: string, p: Partial<Session>) => update(db, "class_sessions", id, p);
export function listSessions(db: DB, f: { studentId?: string; instructorId?: string; from: string; to: string; status?: string; limit: number }) {
  return all<SessionRow>(db, `${SESSION_SELECT} WHERE (?1 IS NULL OR cs.student_id = ?1) AND (?2 IS NULL OR cs.instructor_id = ?2)
    AND cs.starts_at >= ?3 AND cs.starts_at < ?4 AND (?5 IS NULL OR cs.status = ?5) ORDER BY cs.starts_at LIMIT ?6`,
    f.studentId ?? null, f.instructorId ?? null, f.from, f.to, f.status ?? null, f.limit);
}
// A new instructor takes over the enrolment's future classes.
export const reassignFutureSessions = (db: DB, enrolmentId: string, instructorId: string | null, fromIso: string) =>
  run(db, "UPDATE class_sessions SET instructor_id = ?2, meet_url = NULL, meet_updated_at = NULL, meet_notified_at = NULL WHERE enrolment_id = ?1 AND status = 'scheduled' AND starts_at >= ?3", enrolmentId, instructorId, fromIso);
// Classes that ended without an outcome (attendance still to record).
export const pendingOutcomes = (db: DB, instructorId: string | null, nowIso: string) => all<SessionRow>(db,
  `${SESSION_SELECT} WHERE cs.status = 'scheduled' AND cs.ends_at <= ?2 AND (?1 IS NULL OR cs.instructor_id = ?1) ORDER BY cs.starts_at LIMIT 200`, instructorId, nowIso);

// Reminder queues for the 5-minute cron.
export const dueFor = (db: DB, col: "reminded_24h_at" | "reminded_1h_at" | "reminded_15m_at", from: string, to: string, limit: number) => all<SessionRow>(db,
  `${SESSION_SELECT} WHERE cs.status = 'scheduled' AND cs.${col} IS NULL AND cs.starts_at > ?1 AND cs.starts_at <= ?2 AND s.status = 'active' ORDER BY cs.starts_at LIMIT ?3`, from, to, limit);
export const missingLinks = (db: DB, from: string, to: string, limit: number) => all<SessionRow>(db,
  `${SESSION_SELECT} WHERE cs.status = 'scheduled' AND cs.meet_url IS NULL AND cs.link_missing_alert_at IS NULL AND cs.instructor_id IS NOT NULL
   AND cs.starts_at > ?1 AND cs.starts_at <= ?2 ORDER BY cs.starts_at LIMIT ?3`, from, to, limit);
export const markSent = (db: DB, ids: string[], col: "reminded_24h_at" | "reminded_1h_at" | "reminded_15m_at" | "link_missing_alert_at", at: string) =>
  ids.length ? batch(db, ids.map((id) => stmt(db, `UPDATE class_sessions SET ${col} = ?2 WHERE id = ?1`, id, at))) : Promise.resolve([]);
export const pendingOutcomesByInstructor = (db: DB, nowIso: string) => all<{ instructor_id: string; email: string; full_name: string; n: number }>(db,
  `SELECT cs.instructor_id, i.email, i.full_name, COUNT(*) AS n FROM class_sessions cs JOIN users i ON i.id = cs.instructor_id
   WHERE cs.status = 'scheduled' AND cs.ends_at <= ?1 GROUP BY cs.instructor_id LIMIT 30`, nowIso);

// ---------- notifications ----------
export type Notification = { id: string; user_id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null; emailed_at: string | null };
export const addNotification = (db: DB, n: Notification) => insert(db, "notifications", n);
export const addNotificationStmt = (db: DB, n: Notification) =>
  stmt(db, "INSERT INTO notifications (id, user_id, kind, title, body, link, created_at, read_at, emailed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8)", n.id, n.user_id, n.kind, n.title, n.body, n.link, n.created_at, n.emailed_at);
export const listNotifications = (db: DB, userId: string, unreadOnly: boolean, limit: number) => all<Notification>(db,
  "SELECT * FROM notifications WHERE user_id = ?1 AND (?2 = 0 OR read_at IS NULL) ORDER BY created_at DESC LIMIT ?3", userId, unreadOnly ? 1 : 0, limit);
export const unreadCount = async (db: DB, userId: string) => (await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?1 AND read_at IS NULL", userId))?.n ?? 0;
export const markRead = (db: DB, userId: string, ids: string[] | "all", at: string) => ids === "all"
  ? run(db, "UPDATE notifications SET read_at = ?2 WHERE user_id = ?1 AND read_at IS NULL", userId, at)
  : batch(db, ids.slice(0, 100).map((id) => stmt(db, "UPDATE notifications SET read_at = ?3 WHERE id = ?1 AND user_id = ?2 AND read_at IS NULL", id, userId, at)));
