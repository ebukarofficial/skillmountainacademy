// Emails through Resend (https://resend.com/docs/api-reference/emails/send-email).
// Without RESEND_API_KEY nothing is sent and the caller carries on: the data is already saved in D1.
import type { AppEnv } from "./env";

// Undo escaping, so text that a caller already escaped is not escaped twice.
const unesc = (v: string) => v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type Mail = { to: string | string[]; subject: string; html: string; replyTo?: string };

// Plain-text copy of an HTML email. Mail servers score HTML-only messages as more likely to be spam, so including one
// helps the email pass filtering (and arrive) sooner.
export function plainText(html: string): string {
  return unesc(html
    .replace(/<(style|title|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<div style="display:none[\s\S]*?<\/div>/i, "")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, t: string) => { const label = t.replace(/<[^>]+>/g, "").trim(); return !label ? "" : !href.startsWith("mailto:") && label !== href ? `${label}: ${href}` : label; })
    .replace(/<\/(p|h1|h2|h3|tr|li|div)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/td>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " "))
    .replace(/\u2011/g, "-")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Sends one email and reports exactly what happened, so a failure can be shown to the Academy instead of vanishing.
export async function deliver(env: AppEnv, m: Mail): Promise<{ ok: boolean; reason: string }> {
  if (!env.RESEND_API_KEY) {
    console.warn("email skipped: RESEND_API_KEY is not set", m.subject);
    return { ok: false, reason: "RESEND_API_KEY is not set on the Worker (Settings > Variables and Secrets)." };
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
        text: plainText(m.html),
        reply_to: m.replyTo || env.ADMIN_EMAIL || "admission@skillmountainacademy.com",
      }),
    });
    if (r.ok) return { ok: true, reason: "accepted by Resend" };
    const t = (await r.text()).slice(0, 400);
    console.error("resend error", r.status, t);
    return { ok: false, reason: `Resend refused the email (HTTP ${r.status}): ${t}` };
  } catch (e) {
    console.error("resend failed", e);
    return { ok: false, reason: `Could not reach Resend: ${String((e as Error)?.message ?? e)}` };
  }
}

// Hook for recording failures (the learning platform points this at its error log, shown under Admin > Platform).
let failureLog: ((subject: string, reason: string) => Promise<unknown>) | null = null;
export const onEmailFailure = (f: typeof failureLog) => { failureLog = f; };

export async function sendEmail(env: AppEnv, m: Mail): Promise<boolean> {
  const r = await deliver(env, m);
  if (!r.ok && failureLog) await failureLog(m.subject, r.reason).catch(() => undefined);
  return r.ok;
}

// Official correspondence layout: logo header, a hero with the student photo on the right, the message, and a branded
// footer with social links. Built with tables and inline styles so it holds up in Gmail, Outlook and Apple Mail.
// Images are served from the live site (public/email/). Colours are the existing brand tokens only:
// ink #16163a, indigo #1e0e6f, navy #14296b, plum #5b2270, red #c8233a, orange #f7892b, cream #fcf9db, paper #fffdf0, white.
const SITE = "https://skillmountainacademy.com";
const IMG = `${SITE}/email`;
const V = "2"; // bump when an email image changes, so mail clients fetch the new copy
const SANS = "Montserrat,'Segoe UI',Arial,Helvetica,sans-serif";
const BODY = "Arial,Helvetica,sans-serif";
const GRADIENT = "background-color:#c8233a;background-image:linear-gradient(100deg,#c8233a,#f7892b)";
const SOCIALS: [string, string, string][] = [
  ["facebook", "Facebook", "https://www.facebook.com/skillmountainacademy"],
  ["instagram", "Instagram", "https://www.instagram.com/skillmountainacademy"],
  ["linkedin", "LinkedIn", "https://www.linkedin.com/company/skill-mountain-academy/"],
  ["x", "X", "https://x.com/skillmountain_"],
  ["tiktok", "TikTok", "https://www.tiktok.com/@skillmountainacademy"],
  ["whatsapp", "WhatsApp", "https://wa.me/2347061000472"],
];

// Each kind of email has its own card: label, hero colour, picture and line under the headline.
export type EmailKind = "admission" | "login" | "instructor" | "admin" | "enquiry" | "notification" | "reminder" | "payment" | "graduation";
const KINDS: Record<EmailKind, { label: string; bg: string; img: string; alt: string; line: string }> = {
  admission: { label: "Admissions", bg: "#1e0e6f", img: "hero-student.jpg", alt: "A Skill Mountain Academy student", line: "For those made for more. One-on-one, live, online." },
  login: { label: "Student sign-in", bg: "#14296b", img: "hero-login.png", alt: "", line: "Your secure, single-use link to your learning space." },
  instructor: { label: "Faculty", bg: "#5b2270", img: "hero-faculty.png", alt: "", line: "Your teaching workspace: schedule, students and marking." },
  admin: { label: "Staff workspace", bg: "#16163a", img: "hero-staff.png", alt: "", line: "Administration of Skill Mountain Academy." },
  enquiry: { label: "Enquiries", bg: "#1e0e6f", img: "hero-enquiry.png", alt: "", line: "Thank you for writing to Skill Mountain Academy." },
  notification: { label: "Notification", bg: "#14296b", img: "hero-notification.png", alt: "", line: "An update from your learning space." },
  reminder: { label: "Class reminder", bg: "#5b2270", img: "hero-reminder.png", alt: "", line: "Times are shown in Lagos time (WAT)." },
  payment: { label: "Payments", bg: "#1e0e6f", img: "hero-payment.png", alt: "", line: "Payments are processed in naira (₦)." },
  graduation: { label: "Graduation", bg: "#5b2270", img: "hero-graduation.png", alt: "", line: "Congratulations from everyone at the Academy." },
};

export type LayoutOptions = {
  headline?: string; // large line in the hero; defaults to the greeting
  kind?: EmailKind; // which card design to use (default: admission)
  line?: string; // replaces the line under the headline
};

export function layout(title: string, body: string, opts: LayoutOptions = {}): string {
  const k = KINDS[opts.kind ?? "admission"];
  const headline = esc(unesc(opts.headline ?? title)).replace(/-/g, "\u2011");
  const greeting = opts.headline ? `<p style="margin:0 0 14px;font-family:${SANS};font-size:18px;font-weight:bold;color:#16163a">${esc(unesc(title))},</p>` : "";
  const icons = SOCIALS.map(([f, n, u]) => `<a href="${u}" style="display:inline-block;margin:0 5px;text-decoration:none"><img src="${IMG}/${f}.png?v=${V}" width="32" height="32" alt="${n}" style="display:block;border:0;width:32px;height:32px"></a>`).join("");
  const year = new Date().getFullYear();
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${headline}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&display=swap');
body{margin:0;padding:0;background:#fcf9db}
a{color:#1e0e6f}
@media (max-width:620px){
  .sma-wrap{width:100%!important}
  .sma-pad{padding-left:22px!important;padding-right:22px!important}
  .sma-hero-text{display:block!important;width:100%!important;padding:30px 22px 26px!important}
  .sma-hero-img{display:block!important;width:100%!important;text-align:center!important}
  .sma-hero-img img{width:260px!important;height:300px!important;margin:0 auto!important}
  .sma-h1{font-size:26px!important}
}
</style></head>
<body style="margin:0;padding:0;background:#fcf9db">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#fcf9db">${headline} · Skill Mountain Academy</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fcf9db"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" class="sma-wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
  <tr><td style="height:6px;line-height:6px;font-size:0;${GRADIENT}">&nbsp;</td></tr>
  <tr><td class="sma-pad" style="background:${k.bg};padding:22px 36px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td><a href="${SITE}/" style="text-decoration:none"><img src="${IMG}/logo-white.png?v=${V}" width="150" alt="Skill Mountain Academy" style="display:block;border:0;width:150px;height:auto"></a></td>
      <td align="right" style="font-family:${BODY};font-size:12px;color:#ffffff;opacity:.75"><a href="${SITE}/" style="color:#ffffff;text-decoration:none">skillmountainacademy.com</a></td>
    </tr></table>
  </td></tr>
  <tr><td style="background:${k.bg}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="sma-hero-text" width="340" valign="middle" style="width:340px;padding:30px 16px 30px 36px">
        <p style="margin:0 0 10px;font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:2.5px;text-transform:uppercase;color:#f7892b">${esc(k.label)}</p>
        <h1 class="sma-h1" style="margin:0;font-family:${SANS};font-size:30px;line-height:1.2;font-weight:bold;color:#ffffff">${headline}</h1>
        <p style="margin:14px 0 0;font-family:${BODY};font-size:14px;line-height:1.5;color:#ffffff;opacity:.75">${esc(opts.line ?? k.line)}</p>
      </td>
      <td class="sma-hero-img" width="260" valign="bottom" align="right" style="width:260px;font-size:0;line-height:0">
        <img src="${IMG}/${k.img}?v=${V}" width="260" height="300" alt="${esc(k.alt)}" style="display:block;border:0;width:260px;height:300px">
      </td>
    </tr></table>
  </td></tr>
  <tr><td class="sma-pad" style="padding:32px 36px 36px;font-family:${BODY};font-size:16px;line-height:1.65;color:#16163a">
    ${greeting}${body}
  </td></tr>
  <tr><td style="height:4px;line-height:4px;font-size:0;${GRADIENT}">&nbsp;</td></tr>
  <tr><td class="sma-pad" align="center" style="background:#16163a;padding:30px 36px 32px;font-family:${BODY};color:#ffffff">
    <a href="${SITE}/" style="text-decoration:none"><img src="${IMG}/logo-white.png?v=${V}" width="120" alt="Skill Mountain Academy" style="display:block;border:0;width:120px;height:auto;margin:0 auto 18px"></a>
    <div style="margin:0 0 20px">${icons}</div>
    <p style="margin:0 0 8px;font-size:13px"><a href="${SITE}/programmes/" style="color:#ffffff;text-decoration:none">Programmes</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${SITE}/admissions/" style="color:#ffffff;text-decoration:none">Admissions</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${SITE}/learning-experience/" style="color:#ffffff;text-decoration:none">The Learning Experience</a></p>
    <p style="margin:0 0 16px;font-size:13px;opacity:.8"><a href="mailto:admission@skillmountainacademy.com" style="color:#f7892b;text-decoration:none">admission@skillmountainacademy.com</a></p>
    <p style="margin:0;font-size:11px;line-height:1.6;opacity:.55">Skill Mountain Academy · Learning online worldwide<br>You are receiving this email because of your application, admission or account with Skill Mountain Academy.<br>© Skill Mountain Academy ${year}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// A letter to a learner or parent: the hero carries the headline, the greeting opens the message.
export const letter = (headline: string, greeting: string, body: string, kind: EmailKind = "admission") => layout(greeting, body, { headline, kind });
// An internal notice to the Academy's staff, in the staff card unless a more specific kind fits (enquiry, payment).
export const notice = (title: string, body: string, kind: EmailKind = "admin") => layout("Hello", body, { headline: title, kind, line: "For the Academy team." });

export const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0"><tr><td style="border-radius:10px;${GRADIENT}"><a href="${esc(href)}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px">${esc(label)}</a></td></tr></table>`;

export const table = (rows: [string, string][]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;margin:16px 0;background:#fffdf0;border-radius:10px">${rows.map(([k, v], i) => `<tr><td style="padding:11px 16px;${i ? "border-top:1px solid #fcf9db;" : ""}font-size:14px;color:#16163a;opacity:.7">${esc(k)}</td><td style="padding:11px 16px;${i ? "border-top:1px solid #fcf9db;" : ""}font-size:14px;color:#16163a"><b>${esc(v)}</b></td></tr>`).join("")}</table>`;
