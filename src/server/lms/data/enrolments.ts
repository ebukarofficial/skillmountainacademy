// Enrolments (a student on a programme, with an instructor).
import { all, insert, one, run, update, type DB } from "./base";

export type Enrolment = {
  id: string; student_id: string; programme_slug: string; instructor_id: string | null; status: "active" | "paused" | "completed" | "withdrawn";
  order_id: string | null; started_at: string; completed_at: string | null; created_at: string;
  // Durations recorded when the enrolment started (migration 0011); null on an older database or an older record.
  training_months?: number | null; internship_months?: number | null;
};
export const getEnrolment = (db: DB, id: string) => one<Enrolment>(db, "SELECT * FROM enrolments WHERE id = ?1", id);
export const findEnrolment = (db: DB, studentId: string, slug: string) => one<Enrolment>(db, "SELECT * FROM enrolments WHERE student_id = ?1 AND programme_slug = ?2", studentId, slug);
export const createEnrolment = (db: DB, e: Enrolment) => insert(db, "enrolments", e);
export const updateEnrolment = (db: DB, id: string, patch: Partial<Enrolment>) => update(db, "enrolments", id, patch);
export const studentEnrolments = (db: DB, studentId: string) => all<Enrolment>(db, "SELECT * FROM enrolments WHERE student_id = ?1 ORDER BY created_at", studentId);
export const instructorEnrolments = (db: DB, instructorId: string) => all<Enrolment & { full_name: string; email: string; photo_key: string | null; student_no: string | null }>(db,
  `SELECT e.*, u.full_name, u.email, u.photo_key, u.student_no FROM enrolments e JOIN users u ON u.id = e.student_id WHERE e.instructor_id = ?1 AND u.status = 'active' ORDER BY e.programme_slug, u.full_name`, instructorId);
export const listEnrolments = (db: DB, f: { programme?: string; instructorId?: string; status?: string; limit: number; offset: number }) => all<Enrolment & { student_name: string; student_email: string; instructor_name: string | null }>(db,
  `SELECT e.*, s.full_name AS student_name, s.email AS student_email, i.full_name AS instructor_name FROM enrolments e JOIN users s ON s.id = e.student_id LEFT JOIN users i ON i.id = e.instructor_id WHERE (?1 IS NULL OR e.programme_slug = ?1) AND (?2 IS NULL OR e.instructor_id = ?2) AND (?3 IS NULL OR e.status = ?3) ORDER BY e.created_at DESC LIMIT ?4 OFFSET ?5`, f.programme ?? null, f.instructorId ?? null, f.status ?? null, f.limit, f.offset);
// Is this instructor assigned to this student (on any active or paused enrolment)?
export const teaches = async (db: DB, instructorId: string, studentId: string) =>
  !!(await one(db, "SELECT 1 AS x FROM enrolments WHERE instructor_id = ?1 AND student_id = ?2 AND status IN ('active', 'paused', 'completed') LIMIT 1", instructorId, studentId));
export const setEnrolmentOrder = (db: DB, id: string, orderId: string) => run(db, "UPDATE enrolments SET order_id = ?2 WHERE id = ?1 AND order_id IS NULL", id, orderId);
