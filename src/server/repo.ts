// Repository layer: the ONLY place that talks to D1. Routes call these functions, so the database can be moved
// later by rewriting this one file. Every query is a prepared statement with bound values.
import { ApiError, notConfigured } from "./http";

export type RegistrationRow = {
  id: string; created_at: string; role: "learner" | "parent" | "child" | "group_member"; lead_id: string | null;
  programme_slug: string; first_name: string; middle_name: string | null; surname: string | null; email: string;
  phone: string | null; country: string | null; city: string | null; adult: string | null; education: string | null;
  english: string | null; computer_literate: string | null; background: string | null; background_detail: string | null;
  why: string | null; goals: string | null; industry: string | null; guardian_name: string | null; guardian_phone: string | null;
  terms: string | null; ip_hash: string | null;
};
export type OrderRow = {
  id: string; reference: string; created_at: string; registration_id: string; programme_slug: string; plan: "full" | "parts";
  method: "paystack" | "bank"; total_kobo: number; regular_kobo: number; hold_id: string | null; group_size: number;
  display_currency: string; fx_rate: number | null; fx_at: string | null; status: "pending" | "part_paid" | "paid" | "cancelled";
};
export type InstalmentRow = {
  id: string; order_id: string; seq: number; amount_kobo: number; due_date: string; reference: string;
  status: "due" | "paid" | "overdue"; reminder_sent_at: string | null; link_sent_at: string | null; paid_at: string | null;
};
export type HoldRow = {
  id: string; visitor_hash: string; ip_hash: string | null; programme_slug: string; started_at: string; expires_at: string; cooldown_until: string;
};
export type EnquiryRow = {
  id: string; created_at: string; parent_name: string; email: string; phone: string; child_age: number;
  programme_interest: string; message: string | null; ip_hash: string | null;
};

const REG_COLS: (keyof RegistrationRow)[] = [
  "id", "created_at", "role", "lead_id", "programme_slug", "first_name", "middle_name", "surname", "email", "phone", "country", "city",
  "adult", "education", "english", "computer_literate", "background", "background_detail", "why", "goals", "industry",
  "guardian_name", "guardian_phone", "terms", "ip_hash",
];
const ORDER_COLS: (keyof OrderRow)[] = [
  "id", "reference", "created_at", "registration_id", "programme_slug", "plan", "method", "total_kobo", "regular_kobo", "hold_id",
  "group_size", "display_currency", "fx_rate", "fx_at", "status",
];
const INST_COLS: (keyof InstalmentRow)[] = ["id", "order_id", "seq", "amount_kobo", "due_date", "reference", "status", "reminder_sent_at", "link_sent_at", "paid_at"];

const insert = (table: string, cols: string[]) => `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")})`;

// Turns "no such table" (migrations not applied yet) into a clear 503 instead of a crash.
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/no such table/i.test(msg)) throw notConfigured("The database");
    throw e;
  }
}

export class Repo {
  db: D1Database;
  constructor(db: D1Database | undefined) {
    if (!db) throw notConfigured("The database");
    this.db = db;
  }

  // ---------- rate limits ----------
  // Fixed window: returns true while the key is within `limit` hits per `windowSec`. One write per call.
  async hit(key: string, limit: number, windowSec: number): Promise<boolean> {
    const start = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
    const row = await guard(() => this.db.prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = ?2 THEN count + 1 ELSE 1 END, window_start = ?2
       RETURNING count`).bind(key, start).first<{ count: number }>());
    return (row?.count ?? 1) <= limit;
  }
  async limitOrThrow(key: string, limit: number, windowSec: number): Promise<void> {
    if (!(await this.hit(key, limit, windowSec))) throw new ApiError(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");
  }

  // ---------- registrations, orders, instalments: written together in one atomic batch ----------
  async createRegistration(b: { people: RegistrationRow[]; order: OrderRow; instalments: InstalmentRow[] }): Promise<void> {
    const stmts = [
      ...b.people.map((r) => this.db.prepare(insert("registrations", REG_COLS)).bind(...REG_COLS.map((c) => r[c] ?? null))),
      this.db.prepare(insert("orders", ORDER_COLS)).bind(...ORDER_COLS.map((c) => b.order[c] ?? null)),
      ...b.instalments.map((i) => this.db.prepare(insert("instalments", INST_COLS)).bind(...INST_COLS.map((c) => i[c] ?? null))),
    ];
    await guard(() => this.db.batch(stmts));
  }

  getOrderByReference(ref: string) {
    return guard(() => this.db.prepare("SELECT * FROM orders WHERE reference = ?1").bind(ref).first<OrderRow>());
  }
  getOrder(id: string) {
    return guard(() => this.db.prepare("SELECT * FROM orders WHERE id = ?1").bind(id).first<OrderRow>());
  }
  getRegistration(id: string) {
    return guard(() => this.db.prepare("SELECT * FROM registrations WHERE id = ?1").bind(id).first<RegistrationRow>());
  }
  async groupMembers(leadId: string) {
    const r = await guard(() => this.db.prepare("SELECT * FROM registrations WHERE lead_id = ?1 AND role = 'group_member'").bind(leadId).all<RegistrationRow>());
    return r.results;
  }
  getInstalmentByReference(ref: string) {
    return guard(() => this.db.prepare("SELECT * FROM instalments WHERE reference = ?1").bind(ref).first<InstalmentRow>());
  }
  getInstalment(id: string) {
    return guard(() => this.db.prepare("SELECT * FROM instalments WHERE id = ?1").bind(id).first<InstalmentRow>());
  }
  async instalments(orderId: string) {
    const r = await guard(() => this.db.prepare("SELECT * FROM instalments WHERE order_id = ?1 ORDER BY seq").bind(orderId).all<InstalmentRow>());
    return r.results;
  }

  // ---------- payments (idempotent) ----------
  // Records a successful payment exactly once. Returns false if this provider reference was already processed.
  // The payment row, the instalment status and the order status change together in one batch.
  async recordPayment(p: { id: string; orderId: string; instalmentId: string; providerRef: string; amountKobo: number; currency: string; paidAt: string; eventId: string }): Promise<boolean> {
    const res = await guard(() => this.db.batch([
      this.db.prepare("INSERT INTO webhook_events (id, received_at) VALUES (?1, ?2) ON CONFLICT(id) DO NOTHING").bind(p.eventId, p.paidAt),
      this.db.prepare(`INSERT INTO payments (id, order_id, instalment_id, provider, provider_ref, amount_kobo, currency, status, paid_at, created_at)
        VALUES (?1, ?2, ?3, 'paystack', ?4, ?5, ?6, 'success', ?7, ?7) ON CONFLICT(provider_ref) DO NOTHING`)
        .bind(p.id, p.orderId, p.instalmentId, p.providerRef, p.amountKobo, p.currency, p.paidAt),
      this.db.prepare("UPDATE instalments SET status = 'paid', paid_at = ?2 WHERE id = ?1 AND status != 'paid'").bind(p.instalmentId, p.paidAt),
      this.db.prepare(`UPDATE orders SET status = CASE
          WHEN (SELECT COUNT(*) FROM instalments WHERE order_id = ?1 AND status != 'paid') = 0 THEN 'paid' ELSE 'part_paid' END
        WHERE id = ?1`).bind(p.orderId),
    ]));
    return (res[1].meta.changes ?? 0) > 0;
  }

  // ---------- instalment schedule (cron) ----------
  // Parts 2 and 3 of online (Paystack) orders that need a payment link (due today or earlier, link not sent yet)
  // or a reminder (due in 3 days, reminder not sent yet). One query with the learner's contact details.
  // Bank-transfer orders are confirmed by hand in the Google Sheet, so they are left out.
  async instalmentsToNotify(today: string, reminderDay: string, limit: number) {
    const r = await guard(() => this.db.prepare(
      `SELECT i.*, o.reference AS order_reference, o.programme_slug, r.email, r.first_name
       FROM instalments i JOIN orders o ON o.id = i.order_id JOIN registrations r ON r.id = o.registration_id
       WHERE i.status IN ('due', 'overdue') AND i.seq > 1 AND o.method = 'paystack' AND o.status != 'cancelled' AND o.status != 'pending'
         AND ((i.due_date <= ?1 AND i.link_sent_at IS NULL) OR (i.due_date = ?2 AND i.reminder_sent_at IS NULL))
       ORDER BY i.due_date LIMIT ?3`).bind(today, reminderDay, limit).all<InstalmentRow & { order_reference: string; programme_slug: string; email: string; first_name: string }>());
    return r.results;
  }
  // Parts more than 14 days late (for the owner's daily digest).
  async longOverdue(beforeDate: string) {
    const r = await guard(() => this.db.prepare(
      `SELECT i.reference, i.amount_kobo, i.due_date, r.email, r.first_name, o.programme_slug
       FROM instalments i JOIN orders o ON o.id = i.order_id JOIN registrations r ON r.id = o.registration_id
       WHERE i.status = 'overdue' AND i.due_date < ?1 ORDER BY i.due_date LIMIT 100`).bind(beforeDate)
      .all<{ reference: string; amount_kobo: number; due_date: string; email: string; first_name: string; programme_slug: string }>());
    return r.results;
  }
  async markOverdue(beforeDate: string): Promise<number> {
    const r = await guard(() => this.db.prepare("UPDATE instalments SET status = 'overdue' WHERE status = 'due' AND seq > 1 AND due_date < ?1").bind(beforeDate).run());
    return r.meta.changes ?? 0;
  }
  setInstalmentSent(id: string, field: "reminder_sent_at" | "link_sent_at", at: string) {
    const sql = field === "reminder_sent_at" ? "UPDATE instalments SET reminder_sent_at = ?2 WHERE id = ?1" : "UPDATE instalments SET link_sent_at = ?2 WHERE id = ?1";
    return guard(() => this.db.prepare(sql).bind(id, at).run());
  }
  cleanupRateLimits(beforeEpoch: number) {
    return guard(() => this.db.prepare("DELETE FROM rate_limits WHERE window_start < ?1").bind(beforeEpoch).run());
  }

  // ---------- holds ----------
  getHold(visitorHash: string, slug: string) {
    return guard(() => this.db.prepare("SELECT * FROM holds WHERE visitor_hash = ?1 AND programme_slug = ?2").bind(visitorHash, slug).first<HoldRow>());
  }
  getHoldById(id: string) {
    return guard(() => this.db.prepare("SELECT * FROM holds WHERE id = ?1").bind(id).first<HoldRow>());
  }
  // The latest hold for this network address and programme, so clearing cookies does not restart an offer.
  latestHoldForIp(ipHash: string, slug: string) {
    return guard(() => this.db.prepare("SELECT * FROM holds WHERE ip_hash = ?1 AND programme_slug = ?2 ORDER BY started_at DESC LIMIT 1").bind(ipHash, slug).first<HoldRow>());
  }
  // Starts a hold, or restarts one whose 7-day cooldown has passed.
  async upsertHold(h: HoldRow): Promise<void> {
    await guard(() => this.db.prepare(
      `INSERT INTO holds (id, visitor_hash, ip_hash, programme_slug, started_at, expires_at, cooldown_until) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(visitor_hash, programme_slug) DO UPDATE SET id = excluded.id, ip_hash = excluded.ip_hash, started_at = excluded.started_at,
         expires_at = excluded.expires_at, cooldown_until = excluded.cooldown_until WHERE holds.cooldown_until <= excluded.started_at`)
      .bind(h.id, h.visitor_hash, h.ip_hash, h.programme_slug, h.started_at, h.expires_at, h.cooldown_until).run());
  }

  // ---------- children's enquiries ----------
  createEnquiry(e: EnquiryRow) {
    const cols = Object.keys(e) as (keyof EnquiryRow)[];
    return guard(() => this.db.prepare(insert("children_enquiries", cols)).bind(...cols.map((c) => e[c] ?? null)).run());
  }

  // Health check used by GET /api/status: are the tables there?
  async tablesReady(): Promise<boolean> {
    try {
      await this.db.prepare("SELECT 1 FROM orders LIMIT 1").first();
      return true;
    } catch {
      return false;
    }
  }
}
