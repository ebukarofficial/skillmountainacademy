// Admissions desk: call requests and the admissions assistant's enquiry log (migration 0007).
import { all, one, run, type DB } from "./base";

export type CallBooking = {
  id: string; name: string; email: string; phone: string; programme: string | null; preferred_date: string; preferred_time: string;
  timezone: string; reason: string; status: "new" | "assigned" | "contacted" | "closed"; assigned_to: string | null; notes: string | null;
  ip_hash: string | null; created_at: string; updated_at: string;
};
export type AssistantEnquiry = {
  id: string; conversation_id: string; question: string; answer: string | null; programme: string | null; answered: number;
  needs_followup: number; handled_at: string | null; ip_hash: string | null; created_at: string;
};

export const createBooking = (db: DB, b: CallBooking) =>
  run(db, `INSERT INTO call_bookings (id, name, email, phone, programme, preferred_date, preferred_time, timezone, reason, status, assigned_to, notes, ip_hash, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
    b.id, b.name, b.email, b.phone, b.programme, b.preferred_date, b.preferred_time, b.timezone, b.reason, b.status, b.assigned_to, b.notes, b.ip_hash, b.created_at, b.updated_at);

export const listBookings = (db: DB, status: string | null, limit = 200) =>
  all<CallBooking & { assignee_name: string | null }>(db, `SELECT b.*, u.full_name AS assignee_name FROM call_bookings b LEFT JOIN users u ON u.id = b.assigned_to
    WHERE (?1 IS NULL OR b.status = ?1) ORDER BY CASE b.status WHEN 'new' THEN 0 WHEN 'assigned' THEN 1 WHEN 'contacted' THEN 2 ELSE 3 END, b.created_at DESC LIMIT ?2`, status, limit);

export const getBooking = (db: DB, id: string) => one<CallBooking>(db, "SELECT * FROM call_bookings WHERE id = ?1", id);

export const updateBooking = (db: DB, id: string, p: { status?: string; assigned_to?: string | null; notes?: string | null }, at: string) =>
  run(db, `UPDATE call_bookings SET status = COALESCE(?2, status), assigned_to = CASE WHEN ?3 = 1 THEN ?4 ELSE assigned_to END,
    notes = CASE WHEN ?5 = 1 THEN ?6 ELSE notes END, updated_at = ?7 WHERE id = ?1`,
    id, p.status ?? null, p.assigned_to !== undefined ? 1 : 0, p.assigned_to ?? null, p.notes !== undefined ? 1 : 0, p.notes ?? null, at);

export const logEnquiry = (db: DB, e: AssistantEnquiry) =>
  run(db, `INSERT INTO assistant_enquiries (id, conversation_id, question, answer, programme, answered, needs_followup, handled_at, ip_hash, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    e.id, e.conversation_id, e.question, e.answer, e.programme, e.answered, e.needs_followup, e.handled_at, e.ip_hash, e.created_at);

export const listEnquiries = (db: DB, onlyFollowup: boolean, limit = 300) =>
  all<AssistantEnquiry>(db, `SELECT * FROM assistant_enquiries WHERE (?1 = 0 OR (needs_followup = 1 AND handled_at IS NULL)) ORDER BY created_at DESC LIMIT ?2`, onlyFollowup ? 1 : 0, limit);

export const enquiryStats = (db: DB, since: string) =>
  one<{ total: number; unanswered: number; followups_open: number; conversations: number }>(db, `SELECT COUNT(*) AS total,
    SUM(CASE WHEN answered = 0 THEN 1 ELSE 0 END) AS unanswered,
    SUM(CASE WHEN needs_followup = 1 AND handled_at IS NULL THEN 1 ELSE 0 END) AS followups_open,
    COUNT(DISTINCT conversation_id) AS conversations FROM assistant_enquiries WHERE created_at >= ?1`, since);

export const markEnquiryHandled = (db: DB, id: string, at: string) => run(db, "UPDATE assistant_enquiries SET handled_at = ?2 WHERE id = ?1", id, at);

// Retention: enquiries older than the cut-off are deleted.
export const purgeEnquiries = (db: DB, before: string) => run(db, "DELETE FROM assistant_enquiries WHERE created_at < ?1", before);
