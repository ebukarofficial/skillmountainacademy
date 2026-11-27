// Final refinement brief (21 Nov 2026): currency quotes, AI Automation full payment, call requests, the admissions
// assistant, instructor records and attendance detail, Meet link settings, the weekly checklist, engagement alerts,
// guardian contact and the admin currency view. Workers AI is mocked; everything else runs in the real Worker.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker, learner, registration } from "./worker-harness.ts";
import { setup, signIn, type Session, eligible } from "./lms-helpers.ts";
import { read } from "./helpers.ts";
import { currencyForCountry } from "../lib/pricing.ts";

let w: Awaited<ReturnType<typeof startWorker>>;
let aiReply = "AI Automation runs for 1 month of training and 1 month of internship.";
after(async () => { await w.dispose(); });

const ids: Record<string, string> = {};
let admin: Session, ins: Session, stu: Session;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

before(async () => {
  w = await startWorker({ ai: true, mock: (req) => (new URL(req.url).host === "ai.test" ? Response.json({ response: aiReply }) : undefined) });
  const s = await setup(w);
  admin = s.admin;
  ids.ins = await s.make("instructor", "ref-ins@example.com", "Ada Instructor");
  ids.ins2 = await s.make("instructor", "ref-ins2@example.com", "Other Instructor");
  ids.stu = await s.make("student", "ref-stu@example.com", "Bola Student");
  await eligible(admin, ids.ins, "ai-automation");
  ids.en = (await admin.json<{ enrolment: { id: string } }>("POST", "/api/app/admin/enrolments", { studentId: ids.stu, programme: "ai-automation", instructorId: ids.ins })).enrolment.id;
  ins = await signIn(w, "ref-ins@example.com");
  stu = await signIn(w, "ref-stu@example.com");
  const db = await w.db();
  // Two finished classes in the past, without an outcome yet.
  for (const [id, ago] of [["sess-a", 3 * 3600_000], ["sess-b", 26 * 3600_000]] as const) {
    await db.prepare("INSERT INTO class_sessions (id, enrolment_id, student_id, instructor_id, starts_at, ends_at, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'scheduled', ?7)")
      .bind(id, ids.en, ids.stu, ids.ins, iso(ago), iso(ago - 45 * 60_000), iso(ago + 86400_000)).run();
  }
});

test("currency follows the country of residence; Paystack is always charged in naira", async () => {
  assert.equal(currencyForCountry("NG"), "NGN");
  assert.equal(currencyForCountry("GB"), "GBP");
  assert.equal(currencyForCountry("IE"), "EUR");
  assert.equal(currencyForCountry("KE"), "USD");
  await w.fetchApi("/api/geo"); // first visit stores the rates
  const q = async (country: string, programme = "webdev", plan = "full") => (await (await w.fetchApi(`/api/quote?programme=${programme}&country=${country}&plan=${plan}`)).json()) as {
    currency: string; display: { total: number; approximate: boolean }; charge: { currency: string; total: number; parts: number[] }; ratesUpdatedAt: string | null; fullPaymentOnly: boolean; plan: string };
  const ng = await q("NG");
  assert.equal(ng.currency, "NGN");
  assert.equal(ng.display.total, 500000);
  assert.equal(ng.display.approximate, false);
  const gb = await q("GB");
  assert.equal(gb.currency, "GBP");
  assert.ok(gb.display.approximate && gb.ratesUpdatedAt, "dated, approximate conversion");
  assert.deepEqual([gb.charge.currency, gb.charge.total], ["NGN", 500000]);
  assert.equal((await q("DE")).currency, "EUR");
  assert.equal((await q("US")).currency, "USD");
  const ai = await q("NG", "ai-automation", "parts");
  assert.deepEqual([ai.fullPaymentOnly, ai.plan, ai.charge.parts], [true, "full", [300000]], "AI Automation has no instalments");
  assert.equal((await w.fetchApi("/api/quote?programme=nope&country=NG")).status, 400);
});

test("AI Automation cannot be bought or admitted in parts (server-side)", async () => {
  const r = await w.post("/api/register", registration({ programme: "ai-automation", plan: "parts", learner: learner({ email: "aia@example.com" }) }), { "cf-connecting-ip": "10.66.0.1" });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /paid in full|full payment|instalment/i);
  const a = await admin.send("POST", "/api/app/admin/admit", { firstName: "Ann", surname: "Parts", email: "ann.parts@example.com", programme: "ai-automation", plan: "parts", paidParts: 1 });
  assert.equal(a.status, 400);
});

test("book a call: saved, emailed to Admissions and the applicant, listed and assignable in the admin workspace", async () => {
  const before = w.calls.length;
  const body = { name: "Chi Visitor", email: "chi@example.com", phone: "+2348012345678", programme: "ai-automation", preferredDate: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10), preferredTime: "10:30", timezone: "Europe/London", reason: "Questions about the internship month.", turnstileToken: "good-token" };
  const bad = await w.post("/api/bookings", { ...body, email: "nope" }, { "cf-connecting-ip": "10.66.1.1" });
  assert.equal(bad.status, 400);
  const r = await w.post("/api/bookings", body, { "cf-connecting-ip": "10.66.1.2" });
  assert.equal(r.status, 200, await r.clone().text());
  assert.ok(await w.waitFor((c) => c.slice(before).filter((x) => x.url.includes("api.resend.com")).length >= 2), "Admissions and the applicant are emailed");
  const list = await admin.json<{ bookings: { id: string; name: string; status: string }[]; staff: { id: string }[] }>("GET", "/api/app/admin/bookings");
  const b = list.bookings.find((x) => x.name === "Chi Visitor")!;
  assert.equal(b.status, "new");
  const upd = await admin.json<{ booking: { status: string; assigned_to?: string; assignedTo?: string } }>("PATCH", `/api/app/admin/bookings/${b.id}`, { status: "assigned", assignedTo: list.staff[0].id });
  assert.equal(upd.booking.status, "assigned");
  assert.equal((await admin.send("PATCH", `/api/app/admin/bookings/${b.id}`, { assignedTo: ids.stu })).status, 400, "only an active administrator can be assigned");
  assert.equal((await stu.send("GET", "/api/app/admin/bookings")).status, 403);
});

test("admissions assistant: answers from approved knowledge, logs the question, hands off when unsure", async () => {
  const conv = crypto.randomUUID();
  const r = await (await w.post("/api/assistant/ask", { conversationId: conv, question: "How long is AI Automation?" }, { "cf-connecting-ip": "10.66.2.1" })).json() as { answer: string; handoff: boolean };
  assert.match(r.answer, /1 month/);
  assert.equal(r.handoff, false);
  const sys = JSON.parse(w.calls.filter((c) => c.url.includes("ai.test")).at(-1)!.body).messages[0].content as string;
  assert.match(sys, /AI Automation/);
  assert.match(sys, /\[\[HANDOFF\]\]/, "the model is told to hand off when unsure");
  aiReply = "[[HANDOFF]] I am not certain about visa matters.";
  const h = await (await w.post("/api/assistant/ask", { conversationId: conv, question: "Can you sponsor my visa?" }, { "cf-connecting-ip": "10.66.2.1" })).json() as { answer: string; handoff: boolean };
  assert.equal(h.handoff, true);
  assert.doesNotMatch(h.answer, /\[\[/);
  const e = await admin.json<{ enquiries: { question: string; answered: number | boolean; needs_followup?: number; needsFollowup?: boolean }[] }>("GET", "/api/app/admin/enquiries?followup=1");
  assert.ok(e.enquiries.some((x) => x.question === "Can you sponsor my visa?"), "handoffs are logged for follow-up");
  assert.ok(!e.enquiries.some((x) => x.question === "How long is AI Automation?"), "answered questions are not in the follow-up list");
  assert.equal((await w.post("/api/assistant/ask", { conversationId: "x", question: "hi" }, { "cf-connecting-ip": "10.66.2.2" })).status, 400);
  aiReply = "AI Automation runs for 1 month of training and 1 month of internship.";
});

test("attendance detail: on time, late and excused are recorded and summarised; students never see the detail", async () => {
  assert.equal((await ins.send("POST", "/api/app/instructor/sessions/sess-a/outcome", { status: "missed", detail: "late" })).status, 400, "late only applies to an attended class");
  await ins.json("POST", "/api/app/instructor/sessions/sess-a/outcome", { status: "completed", detail: "late" });
  await ins.json("POST", "/api/app/instructor/sessions/sess-b/outcome", { status: "missed", detail: "excused" });
  const a = await ins.json<{ week: { attended: number; missed: number; late: number; excused: number; attendancePct: number }; month: { attended: number }; sessions: { id: string; attendanceDetail: string | null }[] }>("GET", "/api/app/instructor/attendance");
  assert.ok(a.month.attended >= 1);
  const byId = Object.fromEntries(a.sessions.map((s) => [s.id, s.attendanceDetail]));
  assert.deepEqual([byId["sess-a"], byId["sess-b"]], ["late", "excused"]);
  const mine = await stu.json<{ sessions: { id: string; attendanceDetail?: unknown }[] }>("GET", "/api/app/student/sessions");
  for (const s of mine.sessions) assert.ok(s.attendanceDetail === undefined || s.attendanceDetail === null, "hidden from students");
});

test("My Students: one record per student with sessions, marks and an academic average (no invented GPA)", async () => {
  const r = await ins.json<{ records: { studentId: string; studentNo: string | null; programmeName: string; sessions: { attended: number; missed: number; late: number; excused: number; attendancePct: number }; marks: { average: number | null }; status: string }[]; averageMethod: string }>("GET", "/api/app/instructor/records");
  const rec = r.records.find((x) => x.studentId === ids.stu)!;
  assert.equal(rec.programmeName, "AI Automation");
  assert.deepEqual([rec.sessions.attended, rec.sessions.missed, rec.sessions.late, rec.sessions.excused, rec.sessions.attendancePct], [1, 1, 1, 1, 50]);
  assert.equal(rec.marks.average, null, "no marks yet, so no average");
  assert.match(r.averageMethod, /no GPA scale/);
  const other = await signIn(w, "ref-ins2@example.com");
  assert.ok(!(await other.json<{ records: { studentId: string }[] }>("GET", "/api/app/instructor/records")).records.some((x) => x.studentId === ids.stu), "instructors see only their own students");
});

test("Meet link settings: validated, saved and applied to scheduled classes", async () => {
  assert.equal((await ins.send("PUT", "/api/app/instructor/meet-link", { url: "https://zoom.us/j/1", apply: "none" })).status, 400);
  const db = await w.db();
  await db.prepare("INSERT INTO class_sessions (id, enrolment_id, student_id, instructor_id, starts_at, ends_at, status, created_at) VALUES ('sess-c', ?1, ?2, ?3, ?4, ?5, 'scheduled', ?6)")
    .bind(ids.en, ids.stu, ids.ins, iso(-2 * 86400_000), iso(-2 * 86400_000 - 45 * 60_000), iso(0)).run();
  const r = await ins.json<{ meetLink: string; applied: number }>("PUT", "/api/app/instructor/meet-link", { url: "https://meet.google.com/abc-defg-hij", apply: "empty" });
  assert.equal(r.meetLink, "https://meet.google.com/abc-defg-hij");
  assert.ok(r.applied >= 1);
  const g = await ins.json<{ meetLink: string; sessions: { id: string }[] }>("GET", "/api/app/instructor/meet-link");
  assert.ok(g.sessions.some((s) => s.id === "sess-c"));
  assert.ok(!read("app/app/instructor-records.tsx").includes("<iframe"), "Meet opens in a new tab; it is never embedded");
});

test("weekly checklist: records tick their own items, the student ticks the rest, instructors add tasks", async () => {
  const wk = async () => (await stu.json<{ checklists: { enrolmentId: string; items: { key: string; done: boolean; source: string; notSet: boolean }[]; done: number; total: number }[] }>("GET", "/api/app/student/weekly")).checklists[0];
  const c0 = await wk();
  assert.ok(c0.items.every((i) => !i.done), "nothing starts complete");
  assert.equal((await stu.send("POST", "/api/app/student/weekly", { enrolmentId: ids.en, key: "assignment", done: true })).status, 400, "record-backed items cannot be ticked by hand");
  await stu.json("POST", "/api/app/student/weekly", { enrolmentId: ids.en, key: "practice", done: true });
  assert.ok((await wk()).items.find((i) => i.key === "practice")!.done);
  // Asking the AI study assistant is evidence for the AI revision item.
  const db = await w.db();
  await db.prepare("INSERT INTO ai_messages (id, student_id, role, content, created_at) VALUES ('ai-1', ?1, 'user', 'Explain webhooks', ?2)").bind(ids.stu, new Date().toISOString()).run();
  assert.ok((await wk()).items.find((i) => i.key === "ai")!.done);
  const t = await ins.json<{ checklist: { items: { key: string; source: string; title: string }[] } }>("POST", `/api/app/instructor/weekly/${ids.en}/tasks`, { title: "Rebuild the lead-capture workflow" });
  const task = t.checklist.items.find((i) => i.source === "instructor")!;
  assert.equal(task.title, "Rebuild the lead-capture workflow");
  await stu.json("POST", "/api/app/student/weekly", { enrolmentId: ids.en, key: task.key, done: true });
  assert.equal((await ins.send("DELETE", `/api/app/instructor/weekly/${ids.en}/tasks/${task.key.slice(5)}`)).status, 400, "a completed task stays on the record");
  const other = await signIn(w, "ref-ins2@example.com");
  assert.equal((await other.send("GET", `/api/app/weekly/${ids.en}`)).status, 404, "other instructors cannot see it");
  assert.equal((await stu.send("POST", "/api/app/student/weekly", { enrolmentId: "nope", key: "practice", done: true })).status, 404);
});

test("engagement alerts use the Academy's thresholds; monitoring lists flagged students", async () => {
  assert.equal((await admin.send("PUT", "/api/app/admin/settings/engagement", { missedClasses: 0, overdueAssignments: 1, missedAssessments: 1, averageBelow: 50, inactiveDays: 21 })).status, 400);
  await admin.json("PUT", "/api/app/admin/settings/engagement", { missedClasses: 1, overdueAssignments: 1, missedAssessments: 1, averageBelow: 50, inactiveDays: 21 });
  const m = await admin.json<{ records: { studentId: string; needsAttention: string[]; phase: { phase: string } | null; weekly: { done: number } | null }[] }>("GET", "/api/app/admin/monitoring");
  const r = m.records.find((x) => x.studentId === ids.stu)!;
  assert.ok(r.needsAttention.includes("1 missed class"), JSON.stringify(r.needsAttention));
  assert.equal(r.phase?.phase, "Training");
  assert.ok((r.weekly?.done ?? 0) >= 2);
  await admin.json("PUT", "/api/app/admin/settings/engagement", { missedClasses: 2, overdueAssignments: 1, missedAssessments: 1, averageBelow: 50, inactiveDays: 21 });
  const m2 = await admin.json<{ records: { studentId: string; needsAttention: string[] }[] }>("GET", "/api/app/admin/monitoring");
  assert.ok(!m2.records.find((x) => x.studentId === ids.stu)!.needsAttention.some((a) => /missed class/.test(a)));
  assert.equal((await ins.send("GET", "/api/app/admin/monitoring")).status, 403);
});

test("student and guardian contact: editable email, guardian only when authorised, every attempt recorded", async () => {
  const c = await admin.json<{ template: { subject: string; body: string }; guardian: { contactAuthorised: boolean } }>("GET", `/api/app/admin/students/${ids.stu}/contact`);
  assert.match(c.template.body, /Dear Bola/);
  assert.doesNotMatch(c.template.body, /fail|lazy|warning|disciplin/i, "respectful wording");
  assert.equal(c.guardian.contactAuthorised, false);
  assert.equal((await admin.send("POST", `/api/app/admin/students/${ids.stu}/email`, { to: "guardian", subject: "Hi", body: "Hello" })).status, 403);
  assert.equal((await admin.send("POST", `/api/app/admin/students/${ids.stu}/contacts`, { target: "guardian", channel: "call", outcome: "reached" })).status, 400);
  assert.equal((await admin.send("PUT", `/api/app/admin/students/${ids.stu}/guardian`, { name: "Mrs Student", email: "mum@example.com", contactAuthorised: true })).status, 400, "authorisation must be recorded");
  await admin.json("PUT", `/api/app/admin/students/${ids.stu}/guardian`, { name: "Mrs Student", relationship: "Mother", email: "mum@example.com", contactAuthorised: true, authorisationNote: "Signed consent on the admission form" });
  const before = w.calls.length;
  await admin.json("POST", `/api/app/admin/students/${ids.stu}/email`, { to: "guardian", subject: c.template.subject, body: "Dear Mrs Student,\n\nA short update." });
  assert.ok(w.calls.slice(before).some((x) => x.url.includes("api.resend.com") && x.body.includes("mum@example.com")));
  const log = await admin.json<{ log: { target: string; channel: string; outcome: string }[] }>("POST", `/api/app/admin/students/${ids.stu}/contacts`, { target: "student", channel: "call", outcome: "no_answer", summary: "Tried at 10:00" });
  assert.deepEqual(log.log.map((l) => `${l.target}:${l.channel}:${l.outcome}`).sort(), ["guardian:email:sent", "student:call:no_answer"]);
  assert.equal((await ins.send("GET", `/api/app/admin/students/${ids.stu}/contact`)).status, 403);
  const me = await stu.json<Record<string, unknown>>("GET", "/api/me");
  assert.ok(me.user, "signed-in profile");
  assert.doesNotMatch(JSON.stringify(me), /mum@example\.com/, "guardian details never reach the student's own session data");
});

test("admin currency view: stored rates with their time, every programme's price, naira charge", async () => {
  const c = await admin.json<{ rates: Record<string, number> | null; fetchedAt: string | null; chargeCurrency: string; programmes: { slug: string; fullPaymentOnly: boolean; prices: Record<string, number | null> }[] }>("POST", "/api/app/admin/currency/refresh");
  assert.ok(c.rates && c.fetchedAt);
  assert.equal(c.chargeCurrency, "NGN");
  const ai = c.programmes.find((p) => p.slug === "ai-automation")!;
  assert.equal(ai.prices.NGN, 300000);
  assert.ok(ai.fullPaymentOnly);
  assert.equal(c.programmes.length, 9);
});
