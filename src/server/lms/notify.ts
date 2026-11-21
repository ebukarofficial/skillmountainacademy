// In-app notifications, optionally also by email (Resend). Email failures never block the in-app notice.
// Priority and email category come from the notice's kind, so every caller is consistent:
//   urgent:     class starting soon, link changed, class moved or cancelled, attendance or link overdue, payments
//   reminders:  class reminders (a student or instructor may turn these emails off; the in-app notice stays)
//   updates:    new materials and announcements (may be turned off too)
//   everything else (assignments, grades, messages, timetable, instructor assigned) is always emailed.
import type { AppEnv } from "../env";
import { siteUrl } from "../env";
import { button, esc, layout, sendEmail } from "../email";
import { addNotificationStmt, runBatch } from "./data/teaching";
import { emailPrefsFor } from "./data/users";
import { parseJsonCol } from "./api";
import { categoryOf, priorityOf } from "../../../lib/notify-rules.ts";

export type Recipient = { id: string; email: string; name: string };
export type Notice = { kind: string; title: string; body: string; link?: string };

export async function notify(env: AppEnv, db: D1Database, to: Recipient[], n: Notice, email = true): Promise<number> {
  if (!to.length) return 0;
  const now = new Date().toISOString();
  const priority = priorityOf(n.kind);
  const cat = categoryOf(n.kind);
  let sent = 0;
  const emailed: Record<string, string | null> = {};
  if (email) {
    const prefs = cat === "essential" ? [] : await emailPrefsFor(db, to.map((r) => r.id));
    for (const r of to) {
      const pref = parseJsonCol<{ reminders?: boolean; updates?: boolean }>(prefs.find((p) => p.id === r.id)?.email_prefs ?? null, {});
      if (cat !== "essential" && pref[cat] === false) { emailed[r.id] = null; continue; }
      const link = n.link ? (n.link.startsWith("http") ? n.link : `${siteUrl(env)}${n.link}`) : null;
      const ok = await sendEmail(env, { to: r.email, subject: n.title, html: layout(`Dear ${esc(r.name.split(" ")[0] || "student")}`, `<p>${esc(n.body).replace(/\n/g, "<br>")}</p>${link ? button(link, link.includes("meet.google.com") ? "Join on Google Meet" : "Open in your learning space") : ""}`) });
      emailed[r.id] = ok ? now : null;
      if (ok) sent++;
    }
  }
  const rows = to.map((r) => ({ id: crypto.randomUUID(), user_id: r.id, kind: n.kind, title: n.title, body: n.body, link: n.link ?? null, created_at: now, read_at: null, emailed_at: emailed[r.id] ?? null, priority }));
  try {
    await runBatch(db, rows.map((x) => addNotificationStmt(db, x)));
  } catch (e) {
    // Before migration 0005 the priority column does not exist: store the notice without it.
    if (!/priority/i.test(String((e as Error)?.message ?? e))) throw e;
    await runBatch(db, rows.map((x) => addNotificationStmt(db, x, false)));
  }
  return sent;
}
