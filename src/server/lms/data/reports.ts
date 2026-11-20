// Messages, ratings, and the aggregate queries behind admin reports, finance and instructor performance.
// Each report is ONE query (sub-selects), so dashboards stay within the free plan's 50-queries-per-request limit.
import { all, batch, insert, one, run, stmt, type DB } from "./base";

// ---------- messages ----------
export type Message = { id: string; from_id: string; to_id: string; body: string; created_at: string; read_at: string | null };
export const addMessage = (db: DB, m: Message) => insert(db, "messages", m);
export const conversation = (db: DB, a: string, b: string, before: string, limit: number) => all<Message>(db,
  `SELECT * FROM (SELECT * FROM messages WHERE ((from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1)) AND created_at < ?3 ORDER BY created_at DESC LIMIT ?4) ORDER BY created_at`, a, b, before, limit);
export const markConversationRead = (db: DB, me: string, other: string, at: string) => run(db, "UPDATE messages SET read_at = ?3 WHERE to_id = ?1 AND from_id = ?2 AND read_at IS NULL", me, other, at);
export const unreadFrom = async (db: DB, me: string, other: string) => (await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE to_id = ?1 AND from_id = ?2 AND read_at IS NULL", me, other))?.n ?? 0;
// The people a user may message (student <-> their instructors), with unread counts and the last message.
export const contacts = (db: DB, me: string, role: "student" | "instructor") => all<{ id: string; full_name: string; photo_key: string | null; programme_slug: string; unread: number; last_at: string | null; last_body: string | null }>(db,
  `SELECT u.id, u.full_name, u.photo_key, e.programme_slug,
     (SELECT COUNT(*) FROM messages m WHERE m.to_id = ?1 AND m.from_id = u.id AND m.read_at IS NULL) AS unread,
     (SELECT MAX(created_at) FROM messages m WHERE (m.from_id = u.id AND m.to_id = ?1) OR (m.from_id = ?1 AND m.to_id = u.id)) AS last_at,
     (SELECT body FROM messages m WHERE (m.from_id = u.id AND m.to_id = ?1) OR (m.from_id = ?1 AND m.to_id = u.id) ORDER BY created_at DESC LIMIT 1) AS last_body
   FROM enrolments e JOIN users u ON u.id = ${role === "student" ? "e.instructor_id" : "e.student_id"}
   WHERE ${role === "student" ? "e.student_id" : "e.instructor_id"} = ?1 AND e.status IN ('active', 'paused', 'completed') AND u.status = 'active'
   GROUP BY u.id ORDER BY last_at DESC NULLS LAST, u.full_name`, me);
export const totalUnreadMessages = async (db: DB, me: string) => (await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM messages WHERE to_id = ?1 AND read_at IS NULL", me))?.n ?? 0;

// ---------- ratings ----------
export const upsertRating = (db: DB, r: { id: string; student_id: string; instructor_id: string; rating: number; comment: string | null; created_at: string }) =>
  run(db, `INSERT INTO instructor_ratings (id, student_id, instructor_id, rating, comment, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(student_id, instructor_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, created_at = excluded.created_at`, r.id, r.student_id, r.instructor_id, r.rating, r.comment, r.created_at);
export const ratingsFor = (db: DB, instructorId: string, limit: number) => all<{ rating: number; comment: string | null; created_at: string; student_name: string }>(db,
  "SELECT r.rating, r.comment, r.created_at, u.full_name AS student_name FROM instructor_ratings r JOIN users u ON u.id = r.student_id WHERE r.instructor_id = ?1 ORDER BY r.created_at DESC LIMIT ?2", instructorId, limit);

// ---------- instructor performance ----------
export const instructorStats = (db: DB, id: string, since: string) => one<{
  students: number; active_students: number; completed: number; missed: number; cancelled: number; pending_outcomes: number; completed_30d: number;
  avg_rating: number | null; ratings: number; avg_assignment_pct: number | null; avg_quiz_pct: number | null; graded: number; to_grade: number;
}>(db, `SELECT
  (SELECT COUNT(DISTINCT student_id) FROM enrolments WHERE instructor_id = ?1) AS students,
  (SELECT COUNT(DISTINCT student_id) FROM enrolments WHERE instructor_id = ?1 AND status = 'active') AS active_students,
  (SELECT COUNT(*) FROM class_sessions WHERE instructor_id = ?1 AND status = 'completed') AS completed,
  (SELECT COUNT(*) FROM class_sessions WHERE instructor_id = ?1 AND status = 'missed') AS missed,
  (SELECT COUNT(*) FROM class_sessions WHERE instructor_id = ?1 AND status = 'cancelled') AS cancelled,
  (SELECT COUNT(*) FROM class_sessions WHERE instructor_id = ?1 AND status = 'scheduled' AND ends_at <= ?3) AS pending_outcomes,
  (SELECT COUNT(*) FROM class_sessions WHERE instructor_id = ?1 AND status = 'completed' AND starts_at >= ?2) AS completed_30d,
  (SELECT AVG(rating) FROM instructor_ratings WHERE instructor_id = ?1) AS avg_rating,
  (SELECT COUNT(*) FROM instructor_ratings WHERE instructor_id = ?1) AS ratings,
  (SELECT AVG(100.0 * s.score / a.max_score) FROM assignments a JOIN submissions s ON s.assignment_id = a.id WHERE a.instructor_id = ?1 AND s.graded_at IS NOT NULL) AS avg_assignment_pct,
  (SELECT AVG(100.0 * t.score / q.max_score) FROM quizzes q JOIN quiz_attempts t ON t.quiz_id = q.id WHERE q.instructor_id = ?1 AND t.graded_at IS NOT NULL) AS avg_quiz_pct,
  (SELECT COUNT(*) FROM assignments a JOIN submissions s ON s.assignment_id = a.id WHERE a.instructor_id = ?1 AND s.graded_at IS NOT NULL) AS graded,
  (SELECT COUNT(*) FROM assignments a JOIN submissions s ON s.assignment_id = a.id WHERE a.instructor_id = ?1 AND s.graded_at IS NULL) +
  (SELECT COUNT(*) FROM quizzes q JOIN quiz_attempts t ON t.quiz_id = q.id WHERE q.instructor_id = ?1 AND t.submitted_at IS NOT NULL AND t.graded_at IS NULL) AS to_grade`, id, since, new Date().toISOString());
export const instructorsSummary = (db: DB, now: string) => all<{ id: string; full_name: string; email: string; status: string; students: number; completed: number; missed: number; pending_outcomes: number; avg_rating: number | null }>(db,
  `SELECT u.id, u.full_name, u.email, u.status,
     (SELECT COUNT(DISTINCT student_id) FROM enrolments e WHERE e.instructor_id = u.id AND e.status = 'active') AS students,
     (SELECT COUNT(*) FROM class_sessions c WHERE c.instructor_id = u.id AND c.status = 'completed') AS completed,
     (SELECT COUNT(*) FROM class_sessions c WHERE c.instructor_id = u.id AND c.status = 'missed') AS missed,
     (SELECT COUNT(*) FROM class_sessions c WHERE c.instructor_id = u.id AND c.status = 'scheduled' AND c.ends_at <= ?1) AS pending_outcomes,
     (SELECT AVG(rating) FROM instructor_ratings r WHERE r.instructor_id = u.id) AS avg_rating
   FROM users u WHERE u.role = 'instructor' ORDER BY u.full_name LIMIT 200`, now);

// ---------- admin overview and academics ----------
export const overviewStats = (db: DB, now: string, since30: string) => one<Record<string, number>>(db, `SELECT
  (SELECT COUNT(*) FROM users WHERE role = 'student') AS students,
  (SELECT COUNT(DISTINCT e.student_id) FROM enrolments e JOIN users u ON u.id = e.student_id WHERE e.status = 'active' AND u.status = 'active') AS active_students,
  (SELECT COUNT(*) FROM users WHERE role = 'instructor') AS instructors,
  (SELECT COUNT(DISTINCT e.instructor_id) FROM enrolments e JOIN users u ON u.id = e.instructor_id WHERE e.status = 'active' AND u.status = 'active') AS active_instructors,
  (SELECT COUNT(*) FROM enrolments) AS enrolments,
  (SELECT COUNT(*) FROM enrolments WHERE status = 'active') AS ongoing,
  (SELECT COUNT(*) FROM enrolments WHERE status = 'completed') AS completed,
  (SELECT COUNT(*) FROM courses) AS courses,
  (SELECT COUNT(*) FROM enrolments WHERE status = 'active' AND instructor_id IS NULL) AS awaiting_instructor,
  (SELECT COUNT(*) FROM enrolments e WHERE e.status = 'active' AND NOT EXISTS (SELECT 1 FROM timetables t WHERE t.enrolment_id = e.id AND t.effective_to IS NULL)) AS awaiting_timetable,
  (SELECT COUNT(*) FROM orders WHERE status = 'pending' AND created_at >= ?2) AS unpaid_registrations_30d,
  (SELECT COUNT(*) FROM orders WHERE status IN ('paid', 'part_paid') AND created_at >= ?2) AS paid_registrations_30d,
  (SELECT COUNT(*) FROM class_sessions WHERE status = 'scheduled' AND ends_at <= ?1) AS pending_outcomes`, now, since30);

export const academicStats = (db: DB, since: string, now: string) => one<Record<string, number | null>>(db, `SELECT
  (SELECT COUNT(*) FROM assignments WHERE due_at < ?2) AS assignments_due,
  (SELECT COUNT(*) FROM assignments a JOIN submissions s ON s.assignment_id = a.id WHERE a.due_at < ?2) AS assignments_submitted,
  (SELECT AVG(100.0 * s.score / a.max_score) FROM assignments a JOIN submissions s ON s.assignment_id = a.id WHERE s.graded_at IS NOT NULL) AS avg_assignment_pct,
  (SELECT AVG(100.0 * t.score / q.max_score) FROM quizzes q JOIN quiz_attempts t ON t.quiz_id = q.id WHERE q.kind = 'quiz' AND t.graded_at IS NOT NULL) AS avg_quiz_pct,
  (SELECT AVG(100.0 * t.score / q.max_score) FROM quizzes q JOIN quiz_attempts t ON t.quiz_id = q.id WHERE q.kind = 'assessment' AND t.graded_at IS NOT NULL) AS avg_assessment_pct,
  (SELECT COUNT(*) FROM lesson_progress) AS lessons_completed,
  (SELECT COUNT(*) FROM class_sessions WHERE status = 'completed' AND starts_at >= ?1) AS sessions_completed_30d,
  (SELECT COUNT(*) FROM class_sessions WHERE status = 'missed' AND starts_at >= ?1) AS sessions_missed_30d,
  (SELECT COUNT(*) FROM class_sessions WHERE status = 'cancelled' AND starts_at >= ?1) AS sessions_cancelled_30d,
  (SELECT COUNT(*) FROM enrolments WHERE status = 'completed') AS programmes_completed`, since, now);

// Active enrolments with warning signs, in one query.
export const attentionList = (db: DB, now: string, since21: string) => all<{ enrolment_id: string; student_id: string; student_name: string; programme_slug: string; instructor_name: string | null;
  overdue: number; missed: number; assignment_pct: number | null; assessment_pct: number | null; last_class: string | null }>(db,
  `SELECT * FROM (SELECT e.id AS enrolment_id, e.student_id, s.full_name AS student_name, e.programme_slug, i.full_name AS instructor_name,
     (SELECT COUNT(*) FROM assignments a LEFT JOIN submissions sb ON sb.assignment_id = a.id WHERE a.enrolment_id = e.id AND sb.id IS NULL AND a.due_at < ?1) AS overdue,
     (SELECT COUNT(*) FROM class_sessions c WHERE c.enrolment_id = e.id AND c.status = 'missed') AS missed,
     (SELECT AVG(100.0 * sb.score / a.max_score) FROM assignments a JOIN submissions sb ON sb.assignment_id = a.id WHERE a.enrolment_id = e.id AND sb.graded_at IS NOT NULL) AS assignment_pct,
     (SELECT AVG(100.0 * t.score / q.max_score) FROM quizzes q JOIN quiz_attempts t ON t.quiz_id = q.id WHERE q.enrolment_id = e.id AND q.kind = 'assessment' AND t.graded_at IS NOT NULL) AS assessment_pct,
     (SELECT MAX(starts_at) FROM class_sessions c WHERE c.enrolment_id = e.id AND c.status = 'completed') AS last_class
   FROM enrolments e JOIN users s ON s.id = e.student_id LEFT JOIN users i ON i.id = e.instructor_id WHERE e.status = 'active')
   WHERE overdue > 0 OR missed >= 2 OR assignment_pct < 50 OR assessment_pct < 50 OR (last_class IS NOT NULL AND last_class < ?2)
   ORDER BY overdue DESC, missed DESC LIMIT 100`, now, since21);

// ---------- finance ----------
export const financeStats = (db: DB, now: string, stale: string) => one<Record<string, number | null>>(db, `SELECT
  (SELECT COALESCE(SUM(amount_kobo), 0) FROM payments WHERE status = 'success') AS revenue_kobo,
  (SELECT COUNT(*) FROM payments WHERE status = 'success') AS payments,
  (SELECT COALESCE(SUM(i.amount_kobo), 0) FROM instalments i JOIN orders o ON o.id = i.order_id WHERE i.status != 'paid' AND o.status IN ('part_paid')) AS outstanding_kobo,
  (SELECT COALESCE(SUM(i.amount_kobo), 0) FROM instalments i JOIN orders o ON o.id = i.order_id WHERE i.status = 'overdue') AS overdue_kobo,
  (SELECT COUNT(*) FROM orders WHERE plan = 'full' AND status = 'paid') AS one_time_paid,
  (SELECT COUNT(*) FROM orders WHERE plan = 'parts' AND status IN ('paid', 'part_paid')) AS instalment_orders,
  (SELECT COUNT(*) FROM orders WHERE status = 'pending' AND created_at < ?2) AS unpaid_checkouts,
  (SELECT COUNT(*) FROM orders WHERE status = 'pending' AND method = 'bank') AS awaiting_bank_confirmation`, now, stale);
export const revenueByMonth = (db: DB, since: string) => all<{ month: string; kobo: number; n: number }>(db,
  "SELECT substr(paid_at, 1, 7) AS month, SUM(amount_kobo) AS kobo, COUNT(*) AS n FROM payments WHERE status = 'success' AND paid_at >= ?1 GROUP BY month ORDER BY month", since);
export const paymentHistory = (db: DB, f: { email?: string; orderIds?: string[]; limit: number; offset: number }) => all<{ id: string; provider: string; provider_ref: string; amount_kobo: number; paid_at: string; reference: string; programme_slug: string; plan: string; seq: number | null; first_name: string; surname: string | null; email: string }>(db,
  `SELECT p.id, p.provider, p.provider_ref, p.amount_kobo, p.paid_at, o.reference, o.programme_slug, o.plan, i.seq, r.first_name, r.surname, r.email
   FROM payments p JOIN orders o ON o.id = p.order_id JOIN registrations r ON r.id = o.registration_id LEFT JOIN instalments i ON i.id = p.instalment_id
   WHERE p.status = 'success' AND (?1 IS NULL OR r.email = ?1) AND (?2 IS NULL OR o.id IN (SELECT value FROM json_each(?2)))
   ORDER BY p.paid_at DESC LIMIT ?3 OFFSET ?4`, f.email ?? null, f.orderIds ? JSON.stringify(f.orderIds) : null, f.limit, f.offset);
export const ordersList = (db: DB, f: { status?: string; q?: string; limit: number; offset: number }) => all<{ id: string; reference: string; created_at: string; programme_slug: string; plan: string; method: string; total_kobo: number; status: string;
  paid_kobo: number; first_name: string; surname: string | null; email: string; phone: string | null; account_id: string | null }>(db,
  `SELECT o.id, o.reference, o.created_at, o.programme_slug, o.plan, o.method, o.total_kobo, o.status,
     (SELECT COALESCE(SUM(amount_kobo), 0) FROM payments p WHERE p.order_id = o.id AND p.status = 'success') AS paid_kobo,
     r.first_name, r.surname, r.email, r.phone, (SELECT id FROM users u WHERE u.email = r.email) AS account_id
   FROM orders o JOIN registrations r ON r.id = o.registration_id
   WHERE (?1 IS NULL OR o.status = ?1) AND (?2 IS NULL OR r.email LIKE ?2 OR o.reference LIKE ?2 OR r.first_name LIKE ?2 OR r.surname LIKE ?2)
   ORDER BY o.created_at DESC LIMIT ?3 OFFSET ?4`, f.status ?? null, f.q ? `%${f.q}%` : null, f.limit, f.offset);
// A student's orders: by enrolment link or by the email they registered with.
export const studentOrders = (db: DB, userId: string, email: string) => all<{ id: string; reference: string; programme_slug: string; plan: string; method: string; total_kobo: number; status: string; created_at: string }>(db,
  `SELECT DISTINCT o.id, o.reference, o.programme_slug, o.plan, o.method, o.total_kobo, o.status, o.created_at FROM orders o JOIN registrations r ON r.id = o.registration_id
   WHERE (r.email = ?2 OR o.id IN (SELECT order_id FROM enrolments WHERE student_id = ?1 AND order_id IS NOT NULL)) AND o.status != 'cancelled' ORDER BY o.created_at DESC`, userId, email);
export const orderInstalments = (db: DB, orderIds: string[]) => orderIds.length ? all<{ id: string; order_id: string; seq: number; amount_kobo: number; due_date: string; status: string; paid_at: string | null; reference: string }>(db,
  "SELECT id, order_id, seq, amount_kobo, due_date, status, paid_at, reference FROM instalments WHERE order_id IN (SELECT value FROM json_each(?1)) ORDER BY order_id, seq", JSON.stringify(orderIds)) : Promise.resolve([]);
// Admin records a confirmed bank transfer for one part (same atomic update as a Paystack payment).
export const recordManualPayment = (db: DB, p: { id: string; orderId: string; instalmentId: string; ref: string; amountKobo: number; paidAt: string }) => batch(db, [
  stmt(db, "INSERT INTO payments (id, order_id, instalment_id, provider, provider_ref, amount_kobo, currency, status, paid_at, created_at) VALUES (?1, ?2, ?3, 'bank', ?4, ?5, 'NGN', 'success', ?6, ?6)", p.id, p.orderId, p.instalmentId, p.ref, p.amountKobo, p.paidAt),
  stmt(db, "UPDATE instalments SET status = 'paid', paid_at = ?2 WHERE id = ?1 AND status != 'paid'", p.instalmentId, p.paidAt),
  stmt(db, "UPDATE orders SET status = CASE WHEN (SELECT COUNT(*) FROM instalments WHERE order_id = ?1 AND status != 'paid') = 0 THEN 'paid' ELSE 'part_paid' END WHERE id = ?1", p.orderId),
]);

// ---------- platform health ----------
export const platformStats = (db: DB, since7: string, since1: string) => one<Record<string, number>>(db, `SELECT
  (SELECT COUNT(*) FROM users WHERE last_login_at >= ?1) AS users_active_7d,
  (SELECT COUNT(*) FROM audit_log WHERE action = 'auth.login' AND at >= ?1) AS sign_ins_7d,
  (SELECT COUNT(*) FROM error_log WHERE at >= ?2) AS errors_24h,
  (SELECT COUNT(*) FROM error_log WHERE at >= ?1) AS errors_7d,
  (SELECT COUNT(*) FROM users WHERE status = 'suspended') AS suspended_accounts,
  (SELECT COUNT(*) FROM messages WHERE created_at >= ?1) AS messages_7d,
  (SELECT COUNT(*) FROM submissions WHERE submitted_at >= ?1) AS submissions_7d,
  (SELECT COUNT(*) FROM ai_messages WHERE role = 'user' AND created_at >= ?1) AS ai_questions_7d,
  (SELECT COUNT(*) FROM audit_log WHERE action LIKE 'user.%' AND at >= ?1) AS admin_user_changes_7d`, since7, since1);
export const recentErrors = (db: DB, limit: number) => all<{ at: string; route: string; message: string }>(db, "SELECT at, route, message FROM error_log ORDER BY at DESC LIMIT ?1", limit);
