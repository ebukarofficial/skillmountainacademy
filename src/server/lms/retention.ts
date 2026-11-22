// Data retention (Stage 2, audit finding F7). One allow-list of what may ever be deleted automatically, with the age
// that makes a row eligible. Everything else is protected and can never be reached from here: academic records,
// enrolments, payments, orders, instalments, refunds, submissions, grades, attendance, timetables, accounts.
//
// Safety:
//  - only categories in this file, each a fixed SQL statement (no table or column comes from settings or requests);
//  - each run deletes at most BATCH rows per category, oldest first, so a wrong setting cannot empty a table at once;
//  - idempotent (deleting what is already gone deletes nothing) and every run with deletions is written to audit_log;
//  - categories proposed in Stage 2 are OFF until the owner approves them (Admin > Security > retention settings).
//    The purges that already existed before Stage 2 stay on with their current periods.
import { getSetting, putSetting } from "./data/engagement";
import { audit } from "./data/users";

export const BATCH = 500;
export const RETENTION_KEY = "retention";
export const LAST_RUN_KEY = "retention_last_run";
export type LastRun = { at: string; deleted: Record<string, number>; backlog: string[] };

type Category = {
  label: string; group: string; defaultDays: number; minDays: number; defaultOn: boolean; protectedNote?: string;
  sql: string; // ?1 = cut-off ISO time, ?2 = batch size. Must delete only rows older than ?1.
};

export const CATEGORIES = {
  auth_tokens:     { label: "Used or expired sign-in links", group: "Authentication records", defaultDays: 1, minDays: 1, defaultOn: true,
    sql: "DELETE FROM auth_tokens WHERE rowid IN (SELECT rowid FROM auth_tokens WHERE expires_at < ?1 ORDER BY expires_at LIMIT ?2)" },
  auth_sessions:   { label: "Expired sessions", group: "Authentication records", defaultDays: 0, minDays: 0, defaultOn: true,
    sql: "DELETE FROM auth_sessions WHERE rowid IN (SELECT rowid FROM auth_sessions WHERE expires_at < ?1 ORDER BY expires_at LIMIT ?2)" },
  rate_limits:     { label: "Rate-limit counters", group: "Authentication records", defaultDays: 1, minDays: 1, defaultOn: true,
    sql: "DELETE FROM rate_limits WHERE rowid IN (SELECT rowid FROM rate_limits WHERE window_start < CAST(strftime('%s', ?1) AS INTEGER) ORDER BY window_start LIMIT ?2)" },
  assistant_enquiries: { label: "Public admissions assistant questions", group: "Admissions enquiries", defaultDays: 180, minDays: 30, defaultOn: true,
    sql: "DELETE FROM assistant_enquiries WHERE rowid IN (SELECT rowid FROM assistant_enquiries WHERE created_at < ?1 ORDER BY created_at LIMIT ?2)" },
  error_log:       { label: "Technical error records", group: "Operational error logs", defaultDays: 90, minDays: 30, defaultOn: false,
    sql: "DELETE FROM error_log WHERE rowid IN (SELECT rowid FROM error_log WHERE at < ?1 ORDER BY at LIMIT ?2)" },
  notifications:   { label: "Dashboard notifications already read", group: "Communications", defaultDays: 365, minDays: 90, defaultOn: false,
    sql: "DELETE FROM notifications WHERE rowid IN (SELECT rowid FROM notifications WHERE read_at IS NOT NULL AND created_at < ?1 ORDER BY created_at LIMIT ?2)" },
  ai_messages:     { label: "Student AI study-assistant conversations", group: "AI conversations", defaultDays: 365, minDays: 90, defaultOn: false,
    sql: "DELETE FROM ai_messages WHERE rowid IN (SELECT rowid FROM ai_messages WHERE created_at < ?1 ORDER BY created_at LIMIT ?2)" },
  audit_log:       { label: "Security audit log", group: "Security logs", defaultDays: 730, minDays: 365, defaultOn: false,
    sql: "DELETE FROM audit_log WHERE rowid IN (SELECT rowid FROM audit_log WHERE at < ?1 ORDER BY at LIMIT ?2)" },
} satisfies Record<string, Category>;
export type CategoryId = keyof typeof CATEGORIES;

// Kept on purpose, with no automatic deletion (recommendations in docs/SMA_SECURITY_REMEDIATION.md).
export const NOT_AUTOMATED = [
  { table: "messages", group: "Student-instructor conversations", why: "Part of the teaching record; recommend review 2 years after the enrolment ends, by hand." },
  { table: "contact_log", group: "Student and guardian contact records", why: "Evidence of support given; recommend 3 years after the student leaves." },
  { table: "call_bookings", group: "Admissions enquiries", why: "Recommend 2 years; needs owner approval first." },
  { table: "orders, instalments, payments, webhook_events", group: "Financial records", why: "Kept for accounting and legal purposes; never deleted automatically." },
  { table: "enrolments, timetables, class_sessions, assignments, submissions, quizzes, quiz_attempts, lesson_progress, weekly_items", group: "Academic records", why: "The student's academic record; never deleted automatically." },
  { table: "users, registrations", group: "Accounts and applications", why: "Deletion only on a verified request, by hand." },
];

export type Settings = Record<CategoryId, { on: boolean; days: number }>;
export function cleanSettings(v: unknown): Settings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, { on?: unknown; days?: unknown }>;
  const out = {} as Settings;
  for (const [id, c] of Object.entries(CATEGORIES) as [CategoryId, Category][]) {
    const days = Number(o[id]?.days);
    out[id] = { on: typeof o[id]?.on === "boolean" ? (o[id]!.on as boolean) : c.defaultOn, days: Number.isInteger(days) && days >= c.minDays && days <= 3650 ? days : c.defaultDays };
  }
  return out;
}
export const loadSettings = async (db: D1Database) => cleanSettings(await getSetting(db, RETENTION_KEY));
export const saveSettings = (db: D1Database, s: Settings, by: string) => putSetting(db, RETENTION_KEY, s, by, new Date().toISOString());

// One pass. Returns rows deleted per category. Missing tables (older databases) are skipped, not errors.
export async function runRetention(db: D1Database, now = new Date(), batch = BATCH): Promise<Record<string, number>> {
  const settings = await loadSettings(db);
  const done: Record<string, number> = {};
  for (const [id, c] of Object.entries(CATEGORIES) as [CategoryId, Category][]) {
    const s = settings[id];
    if (!s.on) continue;
    const cutoff = new Date(now.getTime() - s.days * 86400_000).toISOString();
    try {
      const r = await db.prepare(c.sql).bind(cutoff, batch).run();
      const n = r.meta?.changes ?? 0;
      if (n) done[id] = n;
    } catch (e) {
      if (!/no such table|no such column/i.test(String((e as Error)?.message ?? e))) throw e;
    }
  }
  if (Object.keys(done).length) await audit(db, { actor_id: null, action: "retention.purge", target_type: "retention", target_id: now.toISOString().slice(0, 10), detail: done });
  // Backlog monitoring (Stage 2B): a category that hit the batch limit probably has more rows waiting. It is flagged in
  // the audit log and in Admin > Security so a growing backlog is visible instead of silently accumulating.
  const backlog = Object.entries(done).filter(([, n]) => n >= batch).map(([id]) => id);
  if (backlog.length) await audit(db, { actor_id: null, action: "retention.backlog", target_type: "retention", target_id: now.toISOString().slice(0, 10), detail: { categories: backlog, batch } });
  await putSetting(db, LAST_RUN_KEY, { at: now.toISOString(), deleted: done, backlog }, "system", now.toISOString()).catch(() => undefined);
  return done;
}
