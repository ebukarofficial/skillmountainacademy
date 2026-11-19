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

// Plain, readable layout. The button colour is the existing brand red (#c8233a, already used in the email template).
export function layout(title: string, body: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#16163a;max-width:560px">
<h2 style="margin:0 0 12px">${esc(title)}</h2>${body}
<p style="margin-top:24px">Skill Mountain Academy<br>Flexible, one-on-one learning.</p></div>`;
}

export const button = (href: string, label: string) =>
  `<p><a href="${esc(href)}" style="display:inline-block;background:#c8233a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold">${esc(label)}</a></p>`;

export const table = (rows: [string, string][]) =>
  `<table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join("")}</table>`;
