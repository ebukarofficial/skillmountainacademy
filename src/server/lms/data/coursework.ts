// Resources, assignments, submissions, quizzes, attempts, lesson progress and progress statistics.
import { all, insert, one, run, update, type DB } from "./base";

export type Resource = { id: string; programme_slug: string; course_id: string | null; title: string; kind: "document" | "video" | "link" | "exercise"; url: string | null;
  file_key: string | null; file_name: string | null; text_content: string | null; approved: number; created_by: string; created_at: string };
export const getResource = (db: DB, id: string) => one<Resource>(db, "SELECT * FROM resources WHERE id = ?1", id);
export const createResource = (db: DB, r: Resource) => insert(db, "resources", r);
export const updateResource = (db: DB, id: string, p: Partial<Resource>) => update(db, "resources", id, p);
export const deleteResource = (db: DB, id: string) => run(db, "DELETE FROM resources WHERE id = ?1", id);
export const listResources = (db: DB, slugs: string[], approvedOnly: boolean) => slugs.length
  ? all<Resource>(db, `SELECT * FROM resources WHERE programme_slug IN (SELECT value FROM json_each(?1)) AND (?2 = 0 OR approved = 1) ORDER BY programme_slug, created_at DESC LIMIT 300`, JSON.stringify(slugs), approvedOnly ? 1 : 0)
  : Promise.resolve([] as Resource[]);

export type Assignment = { id: string; student_id: string; instructor_id: string; enrolment_id: string; title: string; description: string | null; due_at: string; max_score: number; created_at: string };
export type Submission = { id: string; assignment_id: string; student_id: string; text: string | null; file_key: string | null; file_name: string | null; submitted_at: string;
  score: number | null; feedback: string | null; graded_at: string | null; graded_by: string | null };
export type AssignmentRow = Assignment & { programme_slug: string; sub_id: string | null; sub_text: string | null; sub_file_name: string | null; submitted_at: string | null;
  score: number | null; feedback: string | null; graded_at: string | null; student_name: string };
const ASSIGNMENT_SELECT = `SELECT a.*, e.programme_slug, s.id AS sub_id, s.text AS sub_text, s.file_name AS sub_file_name, s.submitted_at, s.score, s.feedback, s.graded_at, u.full_name AS student_name FROM assignments a JOIN enrolments e ON e.id = a.enrolment_id JOIN users u ON u.id = a.student_id LEFT JOIN submissions s ON s.assignment_id = a.id`;
export const createAssignment = (db: DB, a: Assignment) => insert(db, "assignments", a);
export const getAssignment = (db: DB, id: string) => one<AssignmentRow>(db, `${ASSIGNMENT_SELECT} WHERE a.id = ?1`, id);
export const listAssignments = (db: DB, f: { studentId?: string; instructorId?: string; from?: string; to?: string; limit: number }) => all<AssignmentRow>(db,
  `${ASSIGNMENT_SELECT} WHERE (?1 IS NULL OR a.student_id = ?1) AND (?2 IS NULL OR a.instructor_id = ?2) AND (?3 IS NULL OR a.due_at >= ?3) AND (?4 IS NULL OR a.due_at < ?4)
   ORDER BY a.due_at LIMIT ?5`, f.studentId ?? null, f.instructorId ?? null, f.from ?? null, f.to ?? null, f.limit);
export const getSubmission = (db: DB, assignmentId: string) => one<Submission>(db, "SELECT * FROM submissions WHERE assignment_id = ?1", assignmentId);
// Creates or replaces the submission (only while it is not graded).
export async function upsertSubmission(db: DB, s: { assignment_id: string; student_id: string; text?: string | null; file_key?: string | null; file_name?: string | null; submitted_at: string }) {
  const cur = await getSubmission(db, s.assignment_id);
  if (!cur) return insert(db, "submissions", { id: crypto.randomUUID(), score: null, feedback: null, graded_at: null, graded_by: null, text: null, file_key: null, file_name: null, ...s });
  return run(db, `UPDATE submissions SET text = COALESCE(?2, text), file_key = COALESCE(?3, file_key), file_name = COALESCE(?4, file_name), submitted_at = ?5 WHERE assignment_id = ?1 AND graded_at IS NULL`,
    s.assignment_id, s.text === undefined ? null : s.text, s.file_key ?? null, s.file_name ?? null, s.submitted_at);
}
export const gradeSubmission = (db: DB, assignmentId: string, score: number, feedback: string | null, by: string, at: string) =>
  run(db, "UPDATE submissions SET score = ?2, feedback = ?3, graded_by = ?4, graded_at = ?5 WHERE assignment_id = ?1", assignmentId, score, feedback, by, at);

export type Question = { type: "mcq"; prompt: string; options: string[]; answer: number; points: number } | { type: "text"; prompt: string; points: number };
export type Quiz = { id: string; student_id: string; instructor_id: string; enrolment_id: string; kind: "quiz" | "assessment"; title: string; instructions: string | null;
  duration_min: number | null; due_at: string; questions: string; max_score: number; created_at: string };
export type Attempt = { id: string; quiz_id: string; student_id: string; started_at: string; submitted_at: string | null; answers: string | null; score: number | null; feedback: string | null; graded_at: string | null; graded_by: string | null };
export type QuizRow = Quiz & { programme_slug: string; student_name: string; att_id: string | null; started_at: string | null; submitted_at: string | null; answers: string | null; score: number | null; feedback: string | null; graded_at: string | null };
const QUIZ_SELECT = `SELECT q.*, e.programme_slug, u.full_name AS student_name, t.id AS att_id, t.started_at, t.submitted_at, t.answers, t.score, t.feedback, t.graded_at FROM quizzes q JOIN enrolments e ON e.id = q.enrolment_id JOIN users u ON u.id = q.student_id LEFT JOIN quiz_attempts t ON t.quiz_id = q.id`;
export const createQuiz = (db: DB, q: Quiz) => insert(db, "quizzes", q);
export const getQuiz = (db: DB, id: string) => one<QuizRow>(db, `${QUIZ_SELECT} WHERE q.id = ?1`, id);
export const listQuizzes = (db: DB, f: { studentId?: string; instructorId?: string; limit: number }) => all<QuizRow>(db,
  `${QUIZ_SELECT} WHERE (?1 IS NULL OR q.student_id = ?1) AND (?2 IS NULL OR q.instructor_id = ?2) ORDER BY q.due_at DESC LIMIT ?3`, f.studentId ?? null, f.instructorId ?? null, f.limit);
export const startAttempt = (db: DB, a: Attempt) => run(db, "INSERT OR IGNORE INTO quiz_attempts (id, quiz_id, student_id, started_at) VALUES (?1, ?2, ?3, ?4)", a.id, a.quiz_id, a.student_id, a.started_at);
export const getAttempt = (db: DB, quizId: string) => one<Attempt>(db, "SELECT * FROM quiz_attempts WHERE quiz_id = ?1", quizId);
export const submitAttempt = (db: DB, quizId: string, p: { answers: string; score: number | null; submitted_at: string; graded_at: string | null }) =>
  run(db, "UPDATE quiz_attempts SET answers = ?2, score = ?3, submitted_at = ?4, graded_at = ?5 WHERE quiz_id = ?1 AND submitted_at IS NULL", quizId, p.answers, p.score, p.submitted_at, p.graded_at);
export const gradeAttempt = (db: DB, quizId: string, score: number, feedback: string | null, by: string, at: string) =>
  run(db, "UPDATE quiz_attempts SET score = ?2, feedback = ?3, graded_by = ?4, graded_at = ?5 WHERE quiz_id = ?1 AND submitted_at IS NOT NULL", quizId, score, feedback, by, at);

export const completeLesson = (db: DB, studentId: string, lessonId: string, at: string) => run(db, "INSERT OR IGNORE INTO lesson_progress (student_id, lesson_id, completed_at) VALUES (?1, ?2, ?3)", studentId, lessonId, at);
export const uncompleteLesson = (db: DB, studentId: string, lessonId: string) => run(db, "DELETE FROM lesson_progress WHERE student_id = ?1 AND lesson_id = ?2", studentId, lessonId);
export const completedLessons = (db: DB, studentId: string) => all<{ lesson_id: string; completed_at: string }>(db, "SELECT lesson_id, completed_at FROM lesson_progress WHERE student_id = ?1", studentId);

// One query: the numbers behind a student's progress on one enrolment.
export const progressStats = (db: DB, studentId: string, enrolmentId: string, slug: string, now: string) => one<{
  lessons_total: number; lessons_done: number; assignments_total: number; assignments_submitted: number; assignments_overdue: number; assignment_pct: number | null;
  quizzes_total: number; quizzes_done: number; quiz_pct: number | null; assessment_pct: number | null; assessments_missed: number; attended: number; missed: number; cancelled: number; last_class: string | null;
}>(db, `SELECT (SELECT COUNT(*) FROM lessons l JOIN courses c ON c.id = l.course_id WHERE c.programme_slug = ?3) AS lessons_total, (SELECT COUNT(*) FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id JOIN courses c ON c.id = l.course_id WHERE p.student_id = ?1 AND c.programme_slug = ?3) AS lessons_done, (SELECT COUNT(*) FROM assignments WHERE enrolment_id = ?2) AS assignments_total, (SELECT COUNT(*) FROM assignments a JOIN submissions s ON s.assignment_id = a.id WHERE a.enrolment_id = ?2) AS assignments_submitted, (SELECT COUNT(*) FROM assignments a LEFT JOIN submissions s ON s.assignment_id = a.id WHERE a.enrolment_id = ?2 AND s.id IS NULL AND a.due_at < ?4) AS assignments_overdue, (SELECT AVG(100.0 * s.score / a.max_score) FROM assignments a JOIN submissions s ON s.assignment_id = a.id WHERE a.enrolment_id = ?2 AND s.graded_at IS NOT NULL) AS assignment_pct, (SELECT COUNT(*) FROM quizzes WHERE enrolment_id = ?2) AS quizzes_total, (SELECT COUNT(*) FROM quizzes q JOIN quiz_attempts t ON t.quiz_id = q.id WHERE q.enrolment_id = ?2 AND t.submitted_at IS NOT NULL) AS quizzes_done, (SELECT AVG(100.0 * t.score / q.max_score) FROM quizzes q JOIN quiz_attempts t ON t.quiz_id = q.id WHERE q.enrolment_id = ?2 AND q.kind = 'quiz' AND t.graded_at IS NOT NULL) AS quiz_pct, (SELECT AVG(100.0 * t.score / q.max_score) FROM quizzes q JOIN quiz_attempts t ON t.quiz_id = q.id WHERE q.enrolment_id = ?2 AND q.kind = 'assessment' AND t.graded_at IS NOT NULL) AS assessment_pct, (SELECT COUNT(*) FROM quizzes q LEFT JOIN quiz_attempts t ON t.quiz_id = q.id AND t.submitted_at IS NOT NULL WHERE q.enrolment_id = ?2 AND q.kind = 'assessment' AND q.due_at < ?4 AND t.id IS NULL) AS assessments_missed, (SELECT COUNT(*) FROM class_sessions WHERE enrolment_id = ?2 AND status = 'completed') AS attended, (SELECT COUNT(*) FROM class_sessions WHERE enrolment_id = ?2 AND status = 'missed') AS missed, (SELECT COUNT(*) FROM class_sessions WHERE enrolment_id = ?2 AND status = 'cancelled') AS cancelled, (SELECT MAX(starts_at) FROM class_sessions WHERE enrolment_id = ?2 AND status = 'completed') AS last_class`, studentId, enrolmentId, slug, now);
