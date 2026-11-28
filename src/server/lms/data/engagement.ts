// Weekly checklist, engagement settings, guardian contact and the contact log (migration 0007).
import { all, insert, one, run, type DB } from "./base";
import type { Enrolment } from "./enrolments";

// ---------- settings ----------
export const getSetting = async <T>(db: DB, key: string): Promise<T | null> => {
  try {
    const r = await one<{ value: string }>(db, "SELECT value FROM app_settings WHERE key = ?1", key);
    return r ? (JSON.parse(r.value) as T) : null;
  } catch {
    return null; // before migration 0007 the table is missing: callers use their defaults
  }
};
export const putSetting = (db: DB, key: string, value: unknown, by: string, at: string) =>
  run(db, "INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    key, JSON.stringify(value), at, by);

// ---------- weekly checklist ----------
export type WeeklyRow = { id: string; enrolment_id: string; student_id: string; week_start: string; item_key: string; title: string | null; detail: string | null;
  assigned_by: string | null; completed_at: string | null; completion_note: string | null; created_at: string; assigned_by_name?: string | null };

export const weeklyRows = (db: DB, enrolmentId: string, weekStart: string) => all<WeeklyRow>(db,
  `SELECT w.*, u.full_name AS assigned_by_name FROM weekly_items w LEFT JOIN users u ON u.id = w.assigned_by WHERE w.enrolment_id = ?1 AND w.week_start = ?2 ORDER BY w.created_at`, enrolmentId, weekStart);
export const getWeeklyRow = (db: DB, enrolmentId: string, weekStart: string, key: string) =>
  one<WeeklyRow>(db, "SELECT * FROM weekly_items WHERE enrolment_id = ?1 AND week_start = ?2 AND item_key = ?3", enrolmentId, weekStart, key);
export const tickWeekly = (db: DB, r: { id: string; enrolment: Enrolment; weekStart: string; key: string; at: string; note: string | null }) => run(db,
  `INSERT INTO weekly_items (id, enrolment_id, student_id, week_start, item_key, completed_at, completion_note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?6) ON CONFLICT(enrolment_id, week_start, item_key) DO UPDATE SET completed_at = excluded.completed_at, completion_note = COALESCE(excluded.completion_note, weekly_items.completion_note)`,
  r.id, r.enrolment.id, r.enrolment.student_id, r.weekStart, r.key, r.at, r.note);
export const untickWeekly = (db: DB, enrolmentId: string, weekStart: string, key: string) =>
  run(db, "UPDATE weekly_items SET completed_at = NULL WHERE enrolment_id = ?1 AND week_start = ?2 AND item_key = ?3", enrolmentId, weekStart, key);
export const addWeeklyTask = (db: DB, r: WeeklyRow) => insert(db, "weekly_items", r);
export const deleteWeeklyTask = (db: DB, enrolmentId: string, key: string) =>
  run(db, "DELETE FROM weekly_items WHERE enrolment_id = ?1 AND item_key = ?2 AND completed_at IS NULL", enrolmentId, key);

// Evidence from records for one enrolment inside [from, to): the items a student cannot tick by hand.
export const weeklyEvidence = (db: DB, e: Enrolment, from: string, to: string) => one<{
  lessons: number; submissions: number; assignments_due: number; tests: number; tests_due: number; ai_questions: number; classes: number;
}>(db, `SELECT (SELECT COUNT(*) FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id JOIN courses c ON c.id = l.course_id WHERE p.student_id = ?1 AND c.programme_slug = ?3 AND p.completed_at >= ?4 AND p.completed_at < ?5) AS lessons, (SELECT COUNT(*) FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE a.enrolment_id = ?2 AND s.submitted_at >= ?4 AND s.submitted_at < ?5) AS submissions, (SELECT COUNT(*) FROM assignments WHERE enrolment_id = ?2 AND due_at >= ?4 AND due_at < ?5) AS assignments_due, (SELECT COUNT(*) FROM quiz_attempts t JOIN quizzes q ON q.id = t.quiz_id WHERE q.enrolment_id = ?2 AND q.kind = 'quiz' AND t.submitted_at >= ?4 AND t.submitted_at < ?5) AS tests, (SELECT COUNT(*) FROM quizzes WHERE enrolment_id = ?2 AND kind = 'quiz' AND due_at >= ?4 AND due_at < ?5) AS tests_due, (SELECT COUNT(*) FROM ai_messages WHERE student_id = ?1 AND role = 'user' AND created_at >= ?4 AND created_at < ?5) AS ai_questions, (SELECT COUNT(*) FROM class_sessions WHERE enrolment_id = ?2 AND status = 'completed' AND starts_at >= ?4 AND starts_at < ?5) AS classes`,
  e.student_id, e.id, e.programme_slug, from, to);

// ---------- guardian and contact log ----------
export type ContactRow = { id: string; student_id: string; target: "student" | "guardian"; channel: string; outcome: string; subject: string | null; summary: string | null;
  by_user: string; created_at: string; by_name?: string | null };
export const logContact = (db: DB, r: ContactRow) => insert(db, "contact_log", r);
export const contactLog = (db: DB, studentId: string, limit = 100) => all<ContactRow>(db,
  "SELECT l.*, u.full_name AS by_name FROM contact_log l LEFT JOIN users u ON u.id = l.by_user WHERE l.student_id = ?1 ORDER BY l.created_at DESC LIMIT ?2", studentId, limit);
export const lastContacts = (db: DB) => all<{ student_id: string; last_at: string }>(db, "SELECT student_id, MAX(created_at) AS last_at FROM contact_log GROUP BY student_id");

// Active enrolments for monitoring, with the student's details.
export const activeEnrolmentsForMonitoring = (db: DB, limit: number) => all<Enrolment & { full_name: string; email: string; photo_key: string | null; student_no: string | null; instructor_name: string | null }>(db,
  `SELECT e.*, s.full_name, s.email, s.photo_key, s.student_no, i.full_name AS instructor_name FROM enrolments e JOIN users s ON s.id = e.student_id LEFT JOIN users i ON i.id = e.instructor_id WHERE e.status IN ('active', 'paused') ORDER BY s.full_name LIMIT ?1`, limit);
