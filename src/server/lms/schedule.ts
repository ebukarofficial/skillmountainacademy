// Learning-platform jobs, run by the 5-minute cron.
//  Every run: reminders 24 h, 1 h and 15 min before each class (student and instructor), and a "Meet link missing"
//  alert to the instructor. The platform never invents a Meet link: without one, the reminder says it is pending.
//  Daily (06:00 Lagos): create the next 14 days of classes from the timetables; nudge instructors about attendance
//  still to record; clean up expired sign-in links and sessions.
// Capped per run to stay inside the Workers Free plan limits (50 external requests, 50 D1 queries).
import type { AppEnv } from "../env";
import { findProgramme } from "../../../lib/config.ts";
import { purgeSessions, purgeTokens } from "./data/users";
import { dueFor, markSent, missingLinks, pendingOutcomesByInstructor, type SessionRow } from "./data/teaching";
import { notify, type Recipient } from "./notify";
import { generateSessions } from "./routes/teaching";
import { lagosDate, lagosText } from "./time";

export const MAX_EMAILS_PER_RUN = 24;
const H = 3600_000;
const prog = (s: string) => findProgramme(s)?.name ?? s;

export async function runLmsSchedule(env: AppEnv, now: Date, daily: boolean) {
  const db = env.DB!;
  const out: Record<string, number> = { created: 0, r24: 0, r1: 0, r15: 0, missing: 0, emails: 0 };
  const t = now.getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  let budget = MAX_EMAILS_PER_RUN;

  if (daily) {
    out.created = await generateSessions(db, lagosDate(now), 14);
    const pending = await pendingOutcomesByInstructor(db, iso(t));
    for (const p of pending.slice(0, 5)) {
      out.emails += await notify(env, db, [{ id: p.instructor_id, email: p.email, name: p.full_name }], { kind: "attendance.pending", title: `Attendance to record: ${p.n} class${p.n === 1 ? "" : "es"}`, body: `Please record the outcome (completed, missed or cancelled) of ${p.n} past class${p.n === 1 ? "" : "es"}.`, link: "/app/" });
      budget -= 1;
    }
    await purgeTokens(db, iso(t - 86400_000));
    await purgeSessions(db, iso(t));
  }

  const people = (s: SessionRow): Recipient[] => [
    { id: s.student_id, email: s.student_email, name: s.student_name },
    ...(s.instructor_id && s.instructor_email ? [{ id: s.instructor_id, email: s.instructor_email, name: s.instructor_name ?? "" }] : []),
  ];
  const wave = async (col: "reminded_24h_at" | "reminded_1h_at" | "reminded_15m_at", from: number, to: number, key: string, text: (s: SessionRow) => { title: string; body: string; link: string }) => {
    const per = 2;
    if (budget < per) return;
    const rows = await dueFor(db, col, iso(from), iso(to), Math.floor(budget / per));
    for (const s of rows) {
      const n = text(s);
      out.emails += await notify(env, db, people(s), { kind: `reminder.${key}`, ...n });
      budget -= per;
    }
    await markSent(db, rows.map((r) => r.id), col, iso(t));
    out[key] = rows.length;
  };

  // Closest first, so the most urgent reminders always go out.
  await wave("reminded_15m_at", t - 5 * 60_000, t + 15 * 60_000, "r15", (s) => ({
    title: `Starting soon: ${prog(s.programme_slug)}`,
    body: s.meet_url ? `Your class starts at ${lagosText(s.starts_at)}. Join from your dashboard.` : `Your class starts at ${lagosText(s.starts_at)}. The Google Meet link has not been added yet; your instructor has been asked to add it.`,
    link: "/app/",
  }));
  await wave("reminded_1h_at", t + 15 * 60_000, t + H, "r1", (s) => ({
    title: `In 1 hour: ${prog(s.programme_slug)}`,
    body: s.meet_url ? `Your class is at ${lagosText(s.starts_at)}. The Google Meet link is on your dashboard.` : `Your class is at ${lagosText(s.starts_at)}. The Google Meet link is still pending.`,
    link: "/app/",
  }));
  await wave("reminded_24h_at", t + H, t + 24 * H, "r24", (s) => ({ title: `Tomorrow: ${prog(s.programme_slug)}`, body: `Reminder: your one-on-one class is on ${lagosText(s.starts_at)}.`, link: "/app/" }));

  // Instructor alert: class within 24 hours and no Meet link yet.
  if (budget > 0) {
    const rows = await missingLinks(db, iso(t), iso(t + 24 * H), budget);
    for (const s of rows) {
      out.emails += await notify(env, db, [{ id: s.instructor_id!, email: s.instructor_email!, name: s.instructor_name ?? "" }], { kind: "meet.missing", title: `Add the Meet link: ${s.student_name}`, body: `Your class with ${s.student_name} (${prog(s.programme_slug)}) on ${lagosText(s.starts_at)} has no Google Meet link yet. Create one in Google Meet and add it on your dashboard.`, link: "/app/" });
    }
    await markSent(db, rows.map((r) => r.id), "link_missing_alert_at", iso(t));
    out.missing = rows.length;
  }
  return out;
}
