// The one scheduled job (wrangler.jsonc: every 5 minutes).
//  - every run: class reminders and missing-Meet-link alerts (src/server/lms/schedule.ts)
//  - 05:00 and 17:00 UTC (06:00 / 18:00 Lagos): exchange rates
//  - 05:00 UTC: instalments, next 14 days of class sessions, clean-up
// Work per run is capped so the job stays inside the Workers Free plan limits (50 external requests and 50 D1 queries per run).
import { PROGRAMMES } from "../../lib/config.ts";
import { lagosDate, money } from "../../lib/pricing.ts";
import type { AppEnv } from "./env";
import { button, letter, notice, sendEmail, table } from "./email";
import { Repo } from "./repo";
import { refreshRates } from "./routes/geo";
import { payLink } from "./routes/payments";
import { runLmsSchedule } from "./lms/schedule";

export const MAX_NOTICES_PER_RUN = 20;

export async function runSchedule(env: AppEnv, now = new Date(), _cron = "*/5 * * * *") {
  void _cron;
  const out = { rates: false, overdue: 0, links: 0, reminders: 0, lms: null as unknown };
  const firstSlot = now.getUTCMinutes() < 5;
  if (env.DB) out.lms = await runLmsSchedule(env, now, firstSlot && now.getUTCHours() === 5).catch((e) => { console.error("lms schedule", e); return null; });
  if (firstSlot && (now.getUTCHours() === 5 || now.getUTCHours() === 17)) out.rates = !!(await refreshRates(env));
  const morning = firstSlot && now.getUTCHours() === 5;
  if (!morning || !env.DB) return out;
  const repo = new Repo(env.DB);
  try {
    await repo.cleanupRateLimits(Math.floor(now.getTime() / 1000) - 86400);
    const today = lagosDate(now);
    out.overdue = await repo.markOverdue(today);
    const canLink = !!env.PAYSTACK_SECRET_KEY;
    const rows = await repo.instalmentsToNotify(today, lagosDate(now, 3), MAX_NOTICES_PER_RUN);
    const at = now.toISOString();
    for (const i of rows) {
      const name = PROGRAMMES.find((p) => p.slug === i.programme_slug)?.name ?? i.programme_slug;
      const link = canLink ? await payLink(env, i.reference) : null;
      const isLink = i.due_date <= today;
      const facts = table([["Programme", name], ["Part", `${i.seq} of 3`], ["Amount", money(i.amount_kobo / 100, "NGN")], ["Due", i.due_date], ["Reference", i.order_reference]]);
      const sent = await sendEmail(env, {
        to: i.email,
        subject: isLink ? `Payment link: ${name}, part ${i.seq}` : `Reminder: ${name}, part ${i.seq} is due in 3 days`,
        html: letter(isLink ? "Your next payment is due" : "Payment reminder", `Dear ${i.first_name}`, `<p>${isLink ? "Your next part is due. Pay securely with Paystack:" : "A friendly reminder that your next part is due in 3 days."}</p>${facts}
          ${link ? button(link, `Pay part ${i.seq} now`) : "<p>Reply to this email and we will send your payment details.</p>"}
          <p>Live-session access is paused if a payment is more than 2 weeks late.</p>`, "payment"),
      });
      if (!sent) continue; // try again on the next run
      await repo.setInstalmentSent(i.id, isLink ? "link_sent_at" : "reminder_sent_at", at);
      if (isLink) out.links++; else out.reminders++;
    }
    const late = await repo.longOverdue(lagosDate(now, -14));
    if (late.length) {
      await sendEmail(env, {
        to: env.ADMIN_EMAIL || "admission@skillmountainacademy.com",
        subject: `${late.length} instalment(s) more than 2 weeks late`,
        html: notice("Payments more than 2 weeks late", `<p>Live-session access should be paused for these learners until they pay.</p>${table(late.map((l) => [`${l.first_name} <${l.email}>`, `${l.programme_slug} · ${money(l.amount_kobo / 100, "NGN")} · due ${l.due_date} · ${l.reference}`]))}`, "payment"),
      });
    }
  } catch (e) {
    console.error("schedule failed", e);
  }
  return out;
}
