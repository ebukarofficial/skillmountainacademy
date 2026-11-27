// Weekly checklist, engagement alerts, student monitoring, guardian contact and currency settings (owner brief, 21 Nov 2026).
//
//   GET    /api/app/student/weekly?week=YYYY-MM-DD           the student's checklist for each programme (default: this week)
//   POST   /api/app/student/weekly                           {enrolmentId, key, done, note?} tick or untick a study item
//   GET    /api/app/weekly/:enrolmentId?week=                instructor (own students) or admin: the same checklist, read-only
//   POST   /api/app/instructor/weekly/:enrolmentId/tasks     {title, detail?} set a task for this week
//   DELETE /api/app/instructor/weekly/:enrolmentId/tasks/:id remove a task the student has not completed
//   GET|PUT /api/app/admin/settings/engagement               alert thresholds
//   GET    /api/app/admin/monitoring                         every active enrolment with its record and alerts
//   GET    /api/app/admin/students/:id/contact               guardian details, contact log and a draft email
//   PUT    /api/app/admin/students/:id/guardian              guardian details and contact authorisation
//   POST   /api/app/admin/students/:id/email                 {to: "student" | "guardian", subject, body}
//   POST   /api/app/admin/students/:id/contacts              record a call or contact attempt
//   GET    /api/app/admin/currency  ·  POST /api/app/admin/currency/refresh
//
// Nothing on the checklist is marked complete without evidence in the records or the student's own action.
import { BUSINESS, PROGRAMMES, findProgramme } from "../../../../lib/config.ts";
import { CURRENCIES, convert, priceNaira } from "../../../../lib/pricing.ts";
import { esc, layout, sendEmail } from "../../email";
import { ApiError, nowIso } from "../../http";
import { readRates, refreshRates } from "../../routes/geo";
import { Checker } from "../../validate";
import { ok, route, type Ctx } from "../api";
import { getEnrolment, studentEnrolments, type Enrolment } from "../data/enrolments";
import {
  activeEnrolmentsForMonitoring, addWeeklyTask, contactLog, deleteWeeklyTask, getSetting, getWeeklyRow, lastContacts, logContact, putSetting, tickWeekly,
  untickWeekly, weeklyEvidence, weeklyRows,
} from "../data/engagement";
import { getUser, updateUser } from "../data/users";
import { notify } from "../notify";
import { cleanRules, DEFAULT_RULES, RULES_KEY, RULE_LIMITS, type AlertRules } from "../rules";
import { addDays, isDate, lagosDate, lagosToIso } from "../time";
import { studentRecord } from "./records";

// ---------- weekly checklist ----------
type Source = "record" | "student";
export const WEEKLY: { key: string; title: string; detail: string; source: Source }[] = [
  { key: "lesson", title: "Review this week's lesson", detail: "Work through the lesson and mark it complete in Lessons.", source: "record" },
  { key: "videos", title: "Watch the assigned videos", detail: "Recorded walkthroughs or videos your instructor set.", source: "student" },
  { key: "practice", title: "Complete the practical exercises", detail: "Repeat what was demonstrated in class until you can do it unaided.", source: "student" },
  { key: "classwork", title: "Finish the classwork", detail: "Anything started in your live session.", source: "student" },
  { key: "assignment", title: "Submit this week's assignment", detail: "Recorded when you submit it in Assignments.", source: "record" },
  { key: "test", title: "Take the weekly test", detail: "Recorded when you submit it in Quizzes.", source: "record" },
  { key: "ai", title: "Revise with the AI study assistant", detail: "Recorded when you ask the assistant a question this week.", source: "record" },
  { key: "questions", title: "Prepare questions for your next class", detail: "Note what you want your instructor to explain.", source: "student" },
];
const STUDENT_KEYS = WEEKLY.filter((w) => w.source === "student").map((w) => w.key);

export const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
const thisWeek = () => mondayOf(lagosDate(new Date()));

export async function weekFor(c: Ctx, e: Enrolment, weekStart: string) {
  const from = lagosToIso(weekStart, "00:00"), to = lagosToIso(addDays(weekStart, 7), "00:00");
  const [ev, rows] = await Promise.all([weeklyEvidence(c.db, e, from, to), weeklyRows(c.db, e.id, weekStart)]);
  const byKey = new Map(rows.map((r) => [r.item_key, r]));
  const x = ev!;
  const recordState: Record<string, { done: boolean; evidence: string | null; notSet?: boolean }> = {
    lesson: { done: x.lessons > 0, evidence: x.lessons ? `${x.lessons} lesson${x.lessons > 1 ? "s" : ""} completed` : null },
    assignment: x.submissions > 0 ? { done: true, evidence: `${x.submissions} submitted` } : { done: false, evidence: null, notSet: x.assignments_due === 0 },
    test: x.tests > 0 ? { done: true, evidence: `${x.tests} submitted` } : { done: false, evidence: null, notSet: x.tests_due === 0 },
    ai: { done: x.ai_questions > 0, evidence: x.ai_questions ? `${x.ai_questions} question${x.ai_questions > 1 ? "s" : ""} asked` : null },
  };
  const items = WEEKLY.map((w) => {
    if (w.source === "record") {
      const r = recordState[w.key];
      return { key: w.key, title: w.title, detail: r.notSet ? "Nothing was set for this week." : w.detail, source: w.source, done: r.done, notSet: !!r.notSet, completedAt: null as string | null, evidence: r.evidence, note: null as string | null, assignedBy: null as string | null };
    }
    const row = byKey.get(w.key);
    return { key: w.key, title: w.title, detail: w.detail, source: w.source, done: !!row?.completed_at, notSet: false, completedAt: row?.completed_at ?? null, evidence: row?.completed_at ? "Marked done by the student" : null, note: row?.completion_note ?? null, assignedBy: null };
  });
  const tasks = rows.filter((r) => r.item_key.startsWith("task:")).map((r) => ({
    key: r.item_key, title: r.title ?? "Task", detail: r.detail ?? "", source: "instructor" as const, done: !!r.completed_at, notSet: false, completedAt: r.completed_at,
    evidence: r.completed_at ? "Marked done by the student" : null, note: r.completion_note, assignedBy: r.assigned_by_name ?? null,
  }));
  const all = [...items, ...tasks];
  const counted = all.filter((i) => !i.notSet);
  return {
    enrolmentId: e.id, programme: e.programme_slug, programmeName: findProgramme(e.programme_slug)?.name ?? e.programme_slug, weekStart, current: weekStart === thisWeek(),
    classesAttended: x.classes, items: all, done: counted.filter((i) => i.done).length, total: counted.length,
  };
}

const weekParam = (c: Ctx) => { const w = c.url.searchParams.get("week"); return w && isDate(w) ? mondayOf(w) : thisWeek(); };

route("GET", "/api/app/student/weekly", ["student"], async (c) => {
  const week = weekParam(c);
  const ens = (await studentEnrolments(c.db, c.user.id)).filter((e) => e.status === "active" || e.status === "paused");
  return ok({ weekStart: week, thisWeek: thisWeek(), checklists: await Promise.all(ens.map((e) => weekFor(c, e, week))) });
});

route("POST", "/api/app/student/weekly", ["student"], async (c) => {
  const b = await c.body<{ enrolmentId?: string; key?: string; done?: boolean; note?: string }>();
  const e = await getEnrolment(c.db, String(b.enrolmentId ?? ""));
  if (!e || e.student_id !== c.user.id) throw new ApiError(404, "not_found", "Programme not found.");
  const key = String(b.key ?? "");
  const week = thisWeek(); // only the current week can be changed, so past weeks remain an honest record
  if (key.startsWith("task:")) {
    if (!(await getWeeklyRow(c.db, e.id, week, key))) throw new ApiError(404, "not_found", "Task not found for this week.");
  } else if (!STUDENT_KEYS.includes(key)) {
    throw new ApiError(400, "invalid", "This item is recorded automatically from your work and cannot be ticked by hand.");
  }
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) || null : null;
  if (b.done) await tickWeekly(c.db, { id: crypto.randomUUID(), enrolment: e, weekStart: week, key, at: nowIso(), note });
  else await untickWeekly(c.db, e.id, week, key);
  return ok({ checklist: await weekFor(c, e, week) });
});

async function enrolmentFor(c: Ctx, id: string) {
  const e = await getEnrolment(c.db, id);
  if (!e || (c.user.role === "instructor" && e.instructor_id !== c.user.id)) throw new ApiError(404, "not_found", "Student programme not found.");
  return e;
}

route("GET", "/api/app/weekly/:enrolmentId", ["instructor", "admin"], async (c) => {
  const e = await enrolmentFor(c, c.params.enrolmentId);
  return ok({ checklist: await weekFor(c, e, weekParam(c)) });
});

route("POST", "/api/app/instructor/weekly/:enrolmentId/tasks", ["instructor"], async (c) => {
  const e = await enrolmentFor(c, c.params.enrolmentId);
  const b = await c.body<{ title?: string; detail?: string }>();
  const ch = new Checker();
  const title = ch.req(b.title, "Task", 140);
  const detail = ch.opt(b.detail, 600);
  if (ch.errors.length) throw new ApiError(400, "invalid", ch.errors.join(" "));
  const week = thisWeek(), id = crypto.randomUUID(), at = nowIso();
  await addWeeklyTask(c.db, { id, enrolment_id: e.id, student_id: e.student_id, week_start: week, item_key: `task:${id}`, title, detail, assigned_by: c.user.id, completed_at: null, completion_note: null, created_at: at });
  const stu = await getUser(c.db, e.student_id);
  if (stu) await notify(c.env, c.db, [{ id: stu.id, email: stu.email, name: stu.full_name }], { kind: "weekly.task", title: `New task this week: ${title}`, body: detail ?? "Your instructor added a task to this week's checklist.", link: "/app/?tab=overview" }, false);
  await c.audit("weekly.task", "enrolment", e.id, { title });
  return ok({ checklist: await weekFor(c, e, week) });
});

route("DELETE", "/api/app/instructor/weekly/:enrolmentId/tasks/:id", ["instructor"], async (c) => {
  const e = await enrolmentFor(c, c.params.enrolmentId);
  const n = await deleteWeeklyTask(c.db, e.id, `task:${c.params.id}`);
  if (!n) throw new ApiError(400, "invalid", "Only tasks the student has not completed can be removed.");
  return ok({ checklist: await weekFor(c, e, thisWeek()) });
});

// ---------- engagement settings ----------
export const loadRules = async (c: Ctx): Promise<AlertRules> => cleanRules(await getSetting(c.db, RULES_KEY));

route("GET", "/api/app/admin/settings/engagement", ["admin"], async (c) => ok({ rules: await loadRules(c), defaults: DEFAULT_RULES, limits: RULE_LIMITS }));
route("PUT", "/api/app/admin/settings/engagement", ["admin"], async (c) => {
  const b = await c.body<Record<string, unknown>>();
  for (const [k, [lo, hi]] of Object.entries(RULE_LIMITS)) {
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new ApiError(400, "invalid", `${k} must be a whole number from ${lo} to ${hi}.`);
  }
  const rules = cleanRules(b);
  await putSetting(c.db, RULES_KEY, rules, c.user.id, nowIso());
  await c.audit("settings.engagement", "settings", RULES_KEY, rules);
  return ok({ rules });
});

// ---------- monitoring ----------
// Training then internship: the phase is worked out from the start date and the durations recorded when the student
// enrolled (migration 0011), falling back to the programme's current published durations for older records.
export function phaseOf(e: Enrolment, now = Date.now()) {
  const current = findProgramme(e.programme_slug);
  const training = e.training_months ?? current?.trainingMonths, internship = e.internship_months ?? current?.internshipMonths;
  if (training == null || internship == null) return null;
  const p = { trainingMonths: training, internshipMonths: internship };
  const started = Date.parse(e.started_at);
  const month = 30.44 * 86400_000;
  const elapsed = Math.max(0, (now - started) / month);
  if (e.status === "completed") return { phase: "Completed", monthOf: null, trainingMonths: p.trainingMonths, internshipMonths: p.internshipMonths };
  if (elapsed < p.trainingMonths) return { phase: "Training", monthOf: `Month ${Math.floor(elapsed) + 1} of ${p.trainingMonths}`, trainingMonths: p.trainingMonths, internshipMonths: p.internshipMonths };
  const intern = elapsed - p.trainingMonths;
  if (p.internshipMonths && intern < p.internshipMonths) return { phase: "Internship", monthOf: `Month ${Math.floor(intern) + 1} of ${p.internshipMonths}`, trainingMonths: p.trainingMonths, internshipMonths: p.internshipMonths };
  return { phase: "Programme period ended", monthOf: null, trainingMonths: p.trainingMonths, internshipMonths: p.internshipMonths };
}

route("GET", "/api/app/admin/monitoring", ["admin"], async (c) => {
  const rules = await loadRules(c);
  const [rows, contacts] = await Promise.all([activeEnrolmentsForMonitoring(c.db, 400), lastContacts(c.db).catch(() => [])]);
  const last = new Map(contacts.map((r) => [r.student_id, r.last_at]));
  const week = thisWeek();
  const records = [];
  for (const e of rows) {
    const [r, wk] = await Promise.all([studentRecord(c, e, rules), weekFor(c, e, week).catch(() => null)]);
    records.push({ ...r, email: e.email, instructorName: e.instructor_name, phase: phaseOf(e), lastContactAt: last.get(e.student_id) ?? null, weekly: wk ? { done: wk.done, total: wk.total } : null });
  }
  return ok({ records, rules, weekStart: week });
});

// ---------- contact ----------
const guardianView = (u: NonNullable<Awaited<ReturnType<typeof getUser>>>) => ({
  name: u.guardian_name ?? null, relationship: u.guardian_relationship ?? null, email: u.guardian_email ?? null, phone: u.guardian_phone ?? null,
  contactAuthorised: !!u.guardian_contact_ok, authorisationNote: u.guardian_contact_note ?? null,
});

async function studentOr404(c: Ctx) {
  const u = await getUser(c.db, c.params.id);
  if (!u || u.role !== "student") throw new ApiError(404, "not_found", "Student not found.");
  return u;
}

route("GET", "/api/app/admin/students/:id/contact", ["admin"], async (c) => {
  const u = await studentOr404(c);
  const rules = await loadRules(c);
  const ens = (await studentEnrolments(c.db, u.id)).filter((e) => e.status !== "withdrawn");
  const first = u.full_name.split(" ")[0];
  const recs = await Promise.all(ens.map((e) => studentRecord(c, { ...e, full_name: u.full_name, photo_key: u.photo_key, student_no: u.student_no }, rules)));
  const concerns = recs.flatMap((r) => r.needsAttention);
  const progName = recs[0]?.programmeName ?? "your programme";
  // A respectful starting point; the administrator edits it before sending.
  const template = {
    subject: `Checking in on your ${progName} studies`,
    body: `Dear ${first},\n\nWe hope your studies are going well. We are writing because we noticed ${concerns.length ? concerns.join(", ") : "that we have not heard from you recently"}.\n\nIf anything is making it difficult to keep up, please reply to this email or book a time with us. We would like to help you get back on track, and your instructor is ready to support you.\n\nWith best wishes,\nThe Academic Office\n${BUSINESS.name}`,
  };
  return ok({ student: { id: u.id, fullName: u.full_name, email: u.email, phone: u.phone, studentNo: u.student_no }, guardian: guardianView(u), records: recs, template, log: await contactLog(c.db, u.id).catch(() => []) });
});

route("PUT", "/api/app/admin/students/:id/guardian", ["admin"], async (c) => {
  const u = await studentOr404(c);
  const b = await c.body<Record<string, unknown>>();
  const ch = new Checker();
  const name = ch.opt(b.name, 120), relationship = ch.opt(b.relationship, 60);
  const email = b.email ? ch.email(b.email, "Guardian email") : null;
  const phone = ch.phone(b.phone, "Guardian phone", false);
  const authorised = b.contactAuthorised === true;
  const note = ch.opt(b.authorisationNote, 300);
  if (authorised && !note) ch.errors.push("Record how contact with the guardian was authorised.");
  if (authorised && !email && !phone) ch.errors.push("Add an email address or phone number for the guardian.");
  if (ch.errors.length) throw new ApiError(400, "invalid", ch.errors.join(" "));
  await updateUser(c.db, u.id, { guardian_name: name, guardian_relationship: relationship, guardian_email: email, guardian_phone: phone, guardian_contact_ok: authorised ? 1 : 0, guardian_contact_note: note });
  await c.audit("guardian.update", "user", u.id, { authorised });
  return ok({ guardian: guardianView((await getUser(c.db, u.id))!) });
});

route("POST", "/api/app/admin/students/:id/email", ["admin"], async (c) => {
  const u = await studentOr404(c);
  const b = await c.body<{ to?: string; subject?: string; body?: string }>();
  const ch = new Checker();
  const to = ch.oneOf(b.to, ["student", "guardian"] as const, "who to email");
  const subject = ch.req(b.subject, "Subject", 160);
  const body = ch.req(b.body, "Message", 5000);
  if (ch.errors.length) throw new ApiError(400, "invalid", ch.errors.join(" "));
  let address = u.email;
  if (to === "guardian") {
    if (!u.guardian_contact_ok) throw new ApiError(403, "forbidden", "Contact with this student's guardian has not been authorised.");
    if (!u.guardian_email) throw new ApiError(400, "invalid", "No guardian email address is recorded.");
    address = u.guardian_email;
  }
  const html = layout(subject, body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join(""), { kind: "notification" });
  const sent = await sendEmail(c.env, { to: address, subject, html, replyTo: c.env.ADMIN_EMAIL || BUSINESS.email });
  await logContact(c.db, { id: crypto.randomUUID(), student_id: u.id, target: to, channel: "email", outcome: sent ? "sent" : "failed", subject, summary: body.slice(0, 1000), by_user: c.user.id, created_at: nowIso() });
  await c.audit("student.email", "user", u.id, { to, sent });
  if (!sent) throw new ApiError(502, "email_failed", "The email could not be sent. It has been recorded as a failed attempt; check the email settings.");
  return ok({ sent: true, log: await contactLog(c.db, u.id) });
});

route("POST", "/api/app/admin/students/:id/contacts", ["admin"], async (c) => {
  const u = await studentOr404(c);
  const b = await c.body<Record<string, unknown>>();
  const ch = new Checker();
  const target = ch.oneOf(b.target, ["student", "guardian"] as const, "who was contacted");
  const channel = ch.oneOf(b.channel, ["call", "sms", "whatsapp", "in_person", "email"] as const, "how they were contacted");
  const outcome = ch.oneOf(b.outcome, ["reached", "no_answer", "left_message", "wrong_number", "sent", "failed"] as const, "the outcome");
  const summary = ch.opt(b.summary, 1000);
  if (target === "guardian" && !u.guardian_contact_ok) ch.errors.push("Contact with this student's guardian has not been authorised.");
  if (ch.errors.length) throw new ApiError(400, "invalid", ch.errors.join(" "));
  await logContact(c.db, { id: crypto.randomUUID(), student_id: u.id, target, channel, outcome, subject: null, summary, by_user: c.user.id, created_at: nowIso() });
  await c.audit("student.contact", "user", u.id, { target, channel, outcome });
  return ok({ log: await contactLog(c.db, u.id) });
});

// ---------- currency ----------
async function currencyView(c: Ctx) {
  const rates = await readRates(c.env);
  return {
    rates: rates ? { USD: rates.rates.USD, GBP: rates.rates.GBP, EUR: rates.rates.EUR } : null, fetchedAt: rates?.fetchedAt ?? null, source: rates?.source ?? null,
    chargeCurrency: "NGN", schedule: "Refreshed automatically every 12 hours; the last good rates are kept if every source fails.",
    programmes: PROGRAMMES.map((p) => {
      const ngn = priceNaira(p);
      return { slug: p.slug, name: p.name, trainingMonths: p.trainingMonths, internshipMonths: p.internshipMonths, fullPaymentOnly: !!p.fullPaymentOnly,
        prices: Object.fromEntries(CURRENCIES.map((cur) => [cur, cur === "NGN" ? ngn : convert(ngn, cur, rates)])) };
    }),
  };
}
route("GET", "/api/app/admin/currency", ["admin"], async (c) => ok(await currencyView(c)));
route("POST", "/api/app/admin/currency/refresh", ["admin"], async (c) => {
  await refreshRates(c.env);
  await c.audit("currency.refresh", "settings", "fx", {});
  return ok(await currencyView(c));
});
