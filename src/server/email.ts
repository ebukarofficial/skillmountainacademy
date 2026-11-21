// Emails through Resend (https://resend.com/docs/api-reference/emails/send-email).
// Without RESEND_API_KEY nothing is sent and the caller carries on: the data is already saved in D1.
import type { AppEnv } from "./env";

export const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type Mail = { to: string | string[]; subject: string; html: string; replyTo?: string };

export async function sendEmail(env: AppEnv, m: Mail): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.warn("email skipped: RESEND_API_KEY is not set", m.subject);
    return false;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM || "Skill Mountain Academy <admission@skillmountainacademy.com>",
        to: Array.isArray(m.to) ? m.to : [m.to],
        subject: m.subject,
        html: m.html,
        reply_to: m.replyTo || env.ADMIN_EMAIL || "admission@skillmountainacademy.com",
      }),
    });
    if (!r.ok) console.error("resend error", r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error("resend failed", e);
    return false;
  }
}

// Official correspondence layout. Colours are the existing brand tokens only: ink #16163a, indigo #1e0e6f,
// red #c8233a, cream #fcf9db, paper #fffdf0 and white.
export function layout(title: string, body: string): string {
  return `<div style="background:#fcf9db;padding:24px 12px"><div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#16163a;max-width:560px;margin:0 auto;background:#fffdf0;border-radius:12px;overflow:hidden">
<div style="background:#1e0e6f;color:#ffffff;padding:18px 28px;font-size:13px;letter-spacing:3px;font-weight:bold">SKILL MOUNTAIN ACADEMY</div>
<div style="padding:28px">
<h2 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:24px">${esc(title)}</h2>${body}
</div>
<div style="border-top:1px solid #fcf9db;padding:18px 28px;font-size:13px;color:#16163a;opacity:.7">Skill Mountain Academy · For those made for more.<br>admission@skillmountainacademy.com · skillmountainacademy.com</div>
</div></div>`;
}

export const button = (href: string, label: string) =>
  `<p style="margin:22px 0"><a href="${esc(href)}" style="display:inline-block;background:#1e0e6f;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:bold">${esc(label)}</a></p>`;

export const table = (rows: [string, string][]) =>
  `<table style="border-collapse:collapse;width:100%;margin:12px 0">${rows.map(([k, v]) => `<tr><td style="padding:8px 16px 8px 0;border-bottom:1px solid #fcf9db;opacity:.75">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #fcf9db"><b>${esc(v)}</b></td></tr>`).join("")}</table>`;
