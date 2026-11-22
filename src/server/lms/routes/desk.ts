// Admissions desk (owner brief, 21 Nov 2026):
//   POST /api/bookings                      Book a call (public, Turnstile): saved, emailed to Admissions, confirmed to the applicant
//   POST /api/assistant/ask                 On-site admissions assistant (public): answers from approved institutional data only
//   GET  /api/app/admin/bookings            Call requests (admin)
//   PATCH /api/app/admin/bookings/:id       Assign, record contact, close (admin)
//   GET  /api/app/admin/enquiries           Assistant questions and follow-ups (admin)
//   POST /api/app/admin/enquiries/:id/handled
import { BUSINESS, FAQ_GROUPS, PAY_PLAN, PROGRAMMES, duration, findProgramme } from "../../../../lib/config.ts";
import { STANDARDS } from "../../../../lib/institution.ts";
import { ApiError, clientIp, nowIso } from "../../http";
import { Repo } from "../../repo";
import { verifyTurnstile } from "../../turnstile";
import { Checker } from "../../validate";
import { esc, letter, notice, sendEmail, table } from "../../email";
import { ok, publicRoute, route } from "../api";
import { createBooking, enquiryStats, getBooking, listBookings, listEnquiries, logEnquiry, markEnquiryHandled, updateBooking, type CallBooking } from "../data/desk";
import { getUser, listUsers } from "../data/users";
import { notify } from "../notify";
import { runModel, type ChatMessage } from "../ai-client";
import { publicAdmissions } from "../admissions";

const STATUSES = ["new", "assigned", "contacted", "closed"] as const;
const adminsOf = async (db: D1Database) => (await listUsers(db, { role: "admin", status: "active", limit: 50, offset: 0 })).map((a) => ({ id: a.id, email: a.email, name: a.full_name }));

// ---------- Book a call ----------
publicRoute("POST", "/api/bookings", async (c) => {
  const b = await c.body<Record<string, unknown>>();
  if (b.website) return ok({}); // honeypot
  const ch = new Checker();
  const name = ch.req(b.name, "Your name", 120);
  const email = ch.email(b.email);
  const phone = ch.phone(b.phone, "Phone number") as string;
  const prog = b.programme ? findProgramme(String(b.programme)) : undefined;
  if (b.programme && !prog) ch.errors.push("Please choose a programme from the list.");
  const date = String(b.preferredDate ?? "");
  const time = String(b.preferredTime ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) ch.errors.push("Please choose a preferred date.");
  else if (Date.parse(date) < Date.now() - 36 * 3600_000) ch.errors.push("Please choose a date from today onwards.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) ch.errors.push("Please choose a preferred time.");
  const timezone = String(b.timezone ?? "").slice(0, 60);
  try { new Intl.DateTimeFormat("en-GB", { timeZone: timezone }); } catch { ch.errors.push("Please choose your time zone."); }
  const reason = ch.req(b.reason, "Reason for the call", 1000);
  ch.done();
  await verifyTurnstile(c.env, b.turnstileToken, clientIp(c.req));
  await new Repo(c.db).limitOrThrow(`book:${c.ipHash}`, 4, 3600);
  const at = nowIso();
  const row: CallBooking = { id: crypto.randomUUID(), name, email, phone, programme: prog?.slug ?? null, preferred_date: date, preferred_time: time, timezone,
    reason, status: "new", assigned_to: null, notes: null, ip_hash: c.ipHash, created_at: at, updated_at: at };
  await createBooking(c.db, row);
  const when = `${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} at ${time} (${timezone.replace(/_/g, " ")})`;
  c.exec.waitUntil((async () => {
    const rows: [string, string][] = [["Name", name], ["Email", email], ["Phone", phone], ["Programme", prog?.name ?? "Not sure yet"], ["Preferred time", when], ["Reason", reason]];
    await sendEmail(c.env, { to: c.env.ADMIN_EMAIL || BUSINESS.email, replyTo: email, subject: `Call request: ${name}`, html: notice("New call request", `${table(rows)}<p>Assign it in Admin &gt; Admissions &gt; Call requests.</p>`, "enquiry") });
    await sendEmail(c.env, { to: email, subject: "Your call request with Skill Mountain Academy", html: letter("Call request received", `Dear ${esc(name.split(" ")[0])}`,
      `<p>Thank you. We have received your request for a call with Admissions.</p>${table([["Preferred time", when], ["Programme", prog?.name ?? "Not decided yet"]])}<p>A member of the Admissions team will contact you at that time, or write to arrange a time that suits you both. We do not call automatically.</p>`, "enquiry") });
    await notify(c.env, c.db, await adminsOf(c.db), { kind: "booking.new", title: `Call request: ${name}`, body: `${prog?.name ?? "General enquiry"} · ${when}`, link: "/app/?tab=admissions" }, false);
  })().catch(() => undefined));
  return ok({ id: row.id });
});

route("GET", "/api/app/admin/bookings", ["admin"], async (c) => {
  const st = c.url.searchParams.get("status");
  const list = await listBookings(c.db, st && (STATUSES as readonly string[]).includes(st) ? st : null);
  const staff = await adminsOf(c.db);
  return ok({ bookings: list.map((b) => ({ id: b.id, name: b.name, email: b.email, phone: b.phone, programme: b.programme ? findProgramme(b.programme)?.name ?? b.programme : null,
    preferredDate: b.preferred_date, preferredTime: b.preferred_time, timezone: b.timezone, reason: b.reason, status: b.status, assignedTo: b.assigned_to, assigneeName: b.assignee_name,
    notes: b.notes, createdAt: b.created_at, updatedAt: b.updated_at })), staff: staff.map((s) => ({ id: s.id, name: s.name })) });
});

route("PATCH", "/api/app/admin/bookings/:id", ["admin"], async (c) => {
  const bk = await getBooking(c.db, c.params.id);
  if (!bk) throw new ApiError(404, "not_found", "Call request not found.");
  const b = await c.body<{ status?: string; assignedTo?: string | null; notes?: string | null }>();
  const p: { status?: string; assigned_to?: string | null; notes?: string | null } = {};
  if (b.status !== undefined) { if (!(STATUSES as readonly string[]).includes(b.status)) throw new ApiError(400, "invalid", "Unknown status."); p.status = b.status; }
  if (b.assignedTo !== undefined) {
    if (b.assignedTo) { const u = await getUser(c.db, b.assignedTo); if (!u || u.role !== "admin" || u.status !== "active") throw new ApiError(400, "invalid", "Choose an active member of staff."); }
    p.assigned_to = b.assignedTo || null;
    if (b.assignedTo && !p.status && bk.status === "new") p.status = "assigned";
  }
  if (b.notes !== undefined) p.notes = b.notes ? String(b.notes).slice(0, 2000) : null;
  await updateBooking(c.db, bk.id, p, nowIso());
  await c.audit("booking.update", "call_booking", bk.id, p);
  if (p.assigned_to && p.assigned_to !== c.user.id) {
    const who = await getUser(c.db, p.assigned_to);
    if (who) c.exec.waitUntil(notify(c.env, c.db, [{ id: who.id, email: who.email, name: who.full_name }], { kind: "booking.assigned", title: `Call request assigned to you: ${bk.name}`, body: `${bk.preferred_date} at ${bk.preferred_time} (${bk.timezone})`, link: "/app/?tab=admissions" }));
  }
  return ok({ booking: await getBooking(c.db, bk.id) });
});

// ---------- Admissions assistant ----------
// Everything the assistant may say comes from here: the programme catalogue, the before-you-apply answers, the
// standards and the live admission status. Anything else is answered with a handoff to Admissions.
async function knowledge(db: D1Database): Promise<string> {
  let status: Record<string, { state: string; listed: boolean }> = {};
  try { status = await publicAdmissions(db); } catch { /* admissions tables missing: status unknown */ }
  const progs = PROGRAMMES.map((p) => `- ${p.name} (slug ${p.slug}): fee ₦${p.price.toLocaleString("en-NG")}; ${duration(p)}; level: ${p.level}; ${p.fullPaymentOnly ? "full payment only" : `full payment or 3 parts (${PAY_PLAN.split.join("%, ")}%)`}; admission status: ${status[p.slug]?.state ?? "see the programme page"}; topics: ${p.learn.join("; ")}. Page: /programmes/${p.slug}/`).join("\n");
  const faq = FAQ_GROUPS.flatMap((g) => g.items).map(([q, a]) => `Q: ${q}\nA: ${a}`).join("\n");
  const std = STANDARDS.map(([t, d]) => `- ${t}: ${d}`).join("\n");
  return `PROGRAMMES\n${progs}\n\nFACTS\n- Teaching: one assigned instructor, a weekly one-on-one live session of 45–60 minutes on Google Meet, and 10–20 hours of independent study a week.\n- Currency: the country of residence sets the displayed currency (NGN where the naira is the national currency, GBP in the UK, EUR in eurozone countries, USD elsewhere). Paystack charges in naira (NGN); the exact charge is shown before payment.\n- Payment methods: Paystack online, or bank transfer.\n- Certificate: a Skill Mountain Academy certificate on completing requirements; not a degree or government/professional qualification.\n- Admissions email: ${BUSINESS.email}. Visitors can book a call with Admissions on the website.\n\nBEFORE YOU APPLY\n${faq}\n\nSTANDARDS\n${std}`;
}

const SYSTEM = (k: string) => `You are the admissions assistant on the Skill Mountain Academy website. Answer questions from prospective students about programmes, fees, durations, curricula, admissions, payment, learning format, internships, faculty, requirements, study commitments and international applications.

Rules:
1. Use ONLY the information below. Never invent fees, dates, policies, discounts, instructor names or anything not stated.
2. If the information below does not answer the question, say so plainly and offer to connect the visitor with Admissions (book a call or email). Then end your reply with the exact marker [[HANDOFF]].
3. Never promise jobs, income, placements, guaranteed results or profits (including from dropshipping).
4. Be concise (at most about 120 words), courteous and precise. British English. No markdown headings.
5. If the question concerns one programme, end with [[PROGRAMME:slug]] using that programme's slug.
6. Do not ask for or repeat personal data such as card numbers or passwords.

INFORMATION
${k}`;

publicRoute("POST", "/api/assistant/ask", async (c) => {
  const b = await c.body<{ conversationId?: string; question?: string; history?: { role?: string; content?: string }[] }>();
  const conv = String(b.conversationId ?? "");
  if (!/^[\w-]{8,64}$/.test(conv)) throw new ApiError(400, "invalid", "Please reload the page and try again.");
  const question = String(b.question ?? "").trim().slice(0, 600);
  if (question.length < 2) throw new ApiError(400, "invalid", "Please type your question.");
  const repo = new Repo(c.db);
  await repo.limitOrThrow(`ask:${c.ipHash}`, 8, 60);
  await repo.limitOrThrow(`ask-day:${c.ipHash}`, 60, 86400);
  // The visitor's own recent turns travel with the request; conversations are never read back from the server.
  const history: ChatMessage[] = (Array.isArray(b.history) ? b.history : []).slice(-6)
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, 800) }));
  let raw = "";
  try {
    raw = await runModel(c.env, [{ role: "system", content: SYSTEM(await knowledge(c.db)) }, ...history, { role: "user", content: question }], 350);
  } catch {
    raw = `I cannot answer right now. Please email ${BUSINESS.email} or book a call with Admissions, and the team will help you. [[HANDOFF]]`;
  }
  const handoff = /\[\[HANDOFF\]\]/.test(raw);
  const slug = raw.match(/\[\[PROGRAMME:([\w-]+)\]\]/)?.[1];
  const programme = slug && findProgramme(slug) ? slug : PROGRAMMES.find((p) => question.toLowerCase().includes(p.name.toLowerCase()))?.slug ?? null;
  const answer = raw.replace(/\[\[(HANDOFF|PROGRAMME:[\w-]+)\]\]/g, "").trim();
  await logEnquiry(c.db, { id: crypto.randomUUID(), conversation_id: conv, question, answer, programme, answered: handoff ? 0 : 1, needs_followup: handoff ? 1 : 0, handled_at: null, ip_hash: c.ipHash, created_at: nowIso() })
    .catch(() => undefined); // the answer still goes back if logging is unavailable
  return ok({ answer, handoff, programme });
});

route("GET", "/api/app/admin/enquiries", ["admin"], async (c) => {
  const only = c.url.searchParams.get("followup") === "1";
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [list, stats] = await Promise.all([listEnquiries(c.db, only), enquiryStats(c.db, since)]);
  return ok({ enquiries: list.map((e) => ({ id: e.id, conversation: e.conversation_id.slice(0, 8), question: e.question, answer: e.answer, programme: e.programme ? findProgramme(e.programme)?.name ?? e.programme : null,
    answered: !!e.answered, needsFollowup: !!e.needs_followup, handledAt: e.handled_at, createdAt: e.created_at })), last30Days: stats, retentionDays: 180 });
});

route("POST", "/api/app/admin/enquiries/:id/handled", ["admin"], async (c) => {
  await markEnquiryHandled(c.db, c.params.id, nowIso());
  await c.audit("enquiry.handled", "assistant_enquiry", c.params.id);
  return ok({});
});
