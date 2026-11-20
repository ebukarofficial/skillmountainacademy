// In-app notifications, optionally also by email (Resend). Email failures never block the in-app notice.
import type { AppEnv } from "../env";
import { siteUrl } from "../env";
import { button, esc, layout, sendEmail } from "../email";
import { addNotificationStmt, runBatch } from "./data/teaching";

export type Recipient = { id: string; email: string; name: string };
export type Notice = { kind: string; title: string; body: string; link?: string };

export async function notify(env: AppEnv, db: D1Database, to: Recipient[], n: Notice, email = true): Promise<number> {
  if (!to.length) return 0;
  const now = new Date().toISOString();
  let sent = 0;
  const emailed: Record<string, string | null> = {};
  if (email) {
    for (const r of to) {
      const ok = await sendEmail(env, { to: r.email, subject: n.title, html: layout(`Hi ${r.name.split(" ")[0]}`, `<p>${esc(n.body).replace(/\n/g, "<br>")}</p>${n.link ? button(n.link.startsWith("http") ? n.link : `${siteUrl(env)}${n.link}`, n.link.includes("meet.google.com") ? "Join on Google Meet" : "Open my dashboard") : ""}`) });
      emailed[r.id] = ok ? now : null;
      if (ok) sent++;
    }
  }
  await runBatch(db, to.map((r) => addNotificationStmt(db, { id: crypto.randomUUID(), user_id: r.id, kind: n.kind, title: n.title, body: n.body, link: n.link ?? null, created_at: now, read_at: null, emailed_at: emailed[r.id] ?? null })));
  return sent;
}
