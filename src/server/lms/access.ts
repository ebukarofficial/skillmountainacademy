// Who may see what. Every handler that loads a record by id checks it here before answering.
import type { User } from "./data/users";
import type { Enrolment } from "./data/enrolments";
import { teaches } from "./data/enrolments";
import { forbidden } from "./api";

export function canSeeEnrolment(u: User, e: Enrolment) {
  return u.role === "admin" || (u.role === "student" && e.student_id === u.id) || (u.role === "instructor" && e.instructor_id === u.id);
}
export function assertEnrolment(u: User, e: Enrolment) { if (!canSeeEnrolment(u, e)) throw forbidden(); }
export function assertSessionAccess(u: User, s: { student_id: string; instructor_id: string | null }) {
  if (u.role === "admin" || (u.role === "student" && s.student_id === u.id) || (u.role === "instructor" && s.instructor_id === u.id)) return;
  throw forbidden();
}
// May this user see this student's academic record?
export async function assertStudentAccess(db: D1Database, u: User, studentId: string) {
  if (u.role === "admin" || (u.role === "student" && u.id === studentId)) return;
  if (u.role === "instructor" && (await teaches(db, u.id, studentId))) return;
  throw forbidden();
}
