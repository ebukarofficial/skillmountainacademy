// Messaging, instructor ratings and performance, admin overview, academic monitoring, finance and platform health,
// and the student's own payment view.
import { findProgramme, PROGRAMMES } from "../../../../lib/config.ts";
import { ApiError, nowIso } from "../../http";
import { Checker } from "../../validate";
import { Repo } from "../../repo";
import { notFound, ok, page, route, type Ctx } from "../api";
import { teaches } from "../data/enrolments";
import {
  academicStats, addMessage, attentionList, contacts, conversation, financeStats, instructorStats, instructorsSummary, markConversationRead, orderInstalments,
  ordersList, overviewStats, paymentHistory, platformStats, ratingsFor, recentErrors, recordManualPayment, revenueByMonth, studentOrders, totalUnreadMessages,
  unreadFrom, upsertRating,
} from "../data/reports";
import { getUser } from "../data/users";
import { notify } from "../notify";
import { afterPayment } from "../../routes/payments";
import { payLink } from "../../routes/payments";

const progName = (s: string) => findProgramme(s)?.name ?? s;
const naira = (k: number | null) => Math.round((k ?? 0) / 100);
const round = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const days = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

// ======================= MESSAGING (student <-> assigned instructor only) =======================
async function partner(c: Ctx) {
  if (c.user.role === "admin") throw new ApiError(403, "forbidden", "Messages are private between a student and their instructor.");
  const other = await getUser(c.db, c.params.userId);
  if (!other || other.status !== "active") throw notFound("That person");
  const pair = c.user.role === "student" ? other.role === "instructor" && (await teaches(c.db, other.id, c.user.id)) : other.role === "student" && (await teaches(c.db, c.user.id, other.id));
  if (!pair) throw new ApiError(403, "forbidden", "You can only message your own instructor or students.");
  return other;
}

route("GET", "/api/app/messages", ["student", "instructor"], async (c) => {
  const list = await contacts(c.db, c.user.id, c.user.role as "student" | "instructor");
  return ok({ contacts: list.map((x) => ({ id: x.id, fullName: x.full_name, photo: x.photo_key ? `/api/app/files/photo/${x.id}` : null, programme: progName(x.programme_slug), unread: x.unread, lastAt: x.last_at, lastMessage: x.last_body?.slice(0, 140) ?? null })),
    unread: await totalUnreadMessages(c.db, c.user.id) });
});

route("GET", "/api/app/messages/:userId", ["student", "instructor"], async (c) => {
  const other = await partner(c);
  const before = c.url.searchParams.get("before");
  const msgs = await conversation(c.db, c.user.id, other.id, before && !Number.isNaN(Date.parse(before)) ? before : "9999", page(c.url, 100).limit);
  await markConversationRead(c.db, c.user.id, other.id, nowIso());
  return ok({ with: { id: other.id, fullName: other.full_name }, messages: msgs.map((m) => ({ id: m.id, mine: m.from_id === c.user.id, body: m.body, createdAt: m.created_at, readAt: m.read_at })) });
});

route("POST", "/api/app/messages/:userId", ["student", "instructor"], async (c) => {
  const other = await partner(c);
  const ch = new Checker();
  const body = ch.req((await c.body()).body, "Message", 5000);
  ch.done();
  await new Repo(c.db).limitOrThrow(`msg:${c.user.id}`, 30, 600);
  const firstUnread = (await unreadFrom(c.db, other.id, c.user.id)) === 0;
  const m = { id: crypto.randomUUID(), from_id: c.user.id, to_id: other.id, body, created_at: nowIso(), read_at: null };
  await addMessage(c.db, m);
  // One email per unread conversation (not one per message); the in-app notice is always added.
  c.exec.waitUntil(notify(c.env, c.db, [{ id: other.id, email: other.email, name: other.full_name }], { kind: "message", title: `New message from ${c.user.full_name}`, body: body.slice(0, 300), link: "/app/" }, firstUnread));
  return ok({ message: { id: m.id, mine: true, body, createdAt: m.created_at, readAt: null } }, 201);
});

// ======================= RATINGS AND INSTRUCTOR PERFORMANCE =======================
route("POST", "/api/app/student/ratings", ["student"], async (c) => {
  const b = await c.body();
  const ch = new Checker();
  const instructorId = ch.req(b.instructorId, "Instructor", 64);
  const rating = ch.int(b.rating, 1, 5, "Rating");
  const comment = ch.opt(b.comment, 1000);
  ch.done();
  if (!(await teaches(c.db, instructorId, c.user.id))) throw new ApiError(403, "forbidden", "You can only rate your own instructor.");
  await upsertRating(c.db, { id: crypto.randomUUID(), student_id: c.user.id, instructor_id: instructorId, rating, comment, created_at: nowIso() });
  await c.audit("rating.set", "user", instructorId, { rating });
  return ok({});
});

async function performance(c: Ctx, id: string, withNames: boolean) {
  const s = (await instructorStats(c.db, id, days(30)))!;
  const reviews = await ratingsFor(c.db, id, 20);
  return {
    studentsTaught: s.students, activeStudents: s.active_students, sessions: { completed: s.completed, missed: s.missed, cancelled: s.cancelled, completedLast30Days: s.completed_30d, awaitingAttendance: s.pending_outcomes },
    attendancePct: s.completed + s.missed ? Math.round((100 * s.completed) / (s.completed + s.missed)) : null,
    studentScores: { avgAssignmentPct: round(s.avg_assignment_pct), avgQuizPct: round(s.avg_quiz_pct) }, grading: { graded: s.graded, waiting: s.to_grade },
    rating: { average: round(s.avg_rating), count: s.ratings },
    // Instructors see comments without names; admins see who wrote them.
    reviews: reviews.map((r) => ({ rating: r.rating, comment: r.comment, at: r.created_at, ...(withNames ? { student: r.student_name } : {}) })),
  };
}
route("GET", "/api/app/instructor/performance", ["instructor"], async (c) => ok({ performance: await performance(c, c.user.id, false) }));
route("GET", "/api/app/admin/instructors", ["admin"], async (c) => ok({ instructors: (await instructorsSummary(c.db, nowIso())).map((i) => ({ ...i, avg_rating: round(i.avg_rating) })) }));
route("GET", "/api/app/admin/instructors/:id/performance", ["admin"], async (c) => {
  const u = await getUser(c.db, c.params.id);
  if (!u || u.role !== "instructor") throw notFound("That instructor");
  return ok({ instructor: { id: u.id, fullName: u.full_name, email: u.email }, performance: await performance(c, u.id, true) });
});

// ======================= ADMIN REPORTS =======================
route("GET", "/api/app/admin/overview", ["admin"], async (c) => {
  const s = (await overviewStats(c.db, nowIso(), days(30)))!;
  return ok({ overview: { ...s, programmes: PROGRAMMES.length } });
});

route("GET", "/api/app/admin/academics", ["admin"], async (c) => {
  const s = (await academicStats(c.db, days(30), nowIso()))!;
  const list = await attentionList(c.db, nowIso(), days(21));
  const done = (s.sessions_completed_30d ?? 0), missed = (s.sessions_missed_30d ?? 0);
  return ok({
    academics: {
      assignmentCompletionPct: s.assignments_due ? Math.round((100 * (s.assignments_submitted ?? 0)) / s.assignments_due) : null,
      avgAssignmentPct: round(s.avg_assignment_pct), avgQuizPct: round(s.avg_quiz_pct), avgAssessmentPct: round(s.avg_assessment_pct),
      lessonsCompleted: s.lessons_completed, programmesCompleted: s.programmes_completed,
      last30Days: { completed: done, missed, cancelled: s.sessions_cancelled_30d, attendancePct: done + missed ? Math.round((100 * done) / (done + missed)) : null },
    },
    needsAttention: list.map((x) => {
      const why: string[] = [];
      if (x.overdue) why.push(`${x.overdue} overdue`);
      if (x.missed >= 2) why.push(`${x.missed} missed classes`);
      if (x.assignment_pct !== null && x.assignment_pct < 50) why.push("assignments < 50%");
      if (x.assessment_pct !== null && x.assessment_pct < 50) why.push("assessments < 50%");
      if (x.last_class && Date.parse(x.last_class) < Date.now() - 21 * 86400_000) why.push("no class in 3 weeks");
      return { enrolmentId: x.enrolment_id, studentId: x.student_id, student: x.student_name, programme: progName(x.programme_slug), instructor: x.instructor_name, reasons: why };
    }),
  });
});

route("GET", "/api/app/admin/finance", ["admin"], async (c) => {
  const s = (await financeStats(c.db, nowIso(), days(1)))!;
  const months = await revenueByMonth(c.db, days(186));
  return ok({
    finance: {
      revenueNaira: naira(s.revenue_kobo), payments: s.payments, outstandingNaira: naira(s.outstanding_kobo), overdueNaira: naira(s.overdue_kobo),
      oneTimePaid: s.one_time_paid, instalmentOrders: s.instalment_orders, awaitingBankConfirmation: s.awaiting_bank_confirmation,
      // Paystack sends no event for abandoned or failed card attempts, so these are checkouts older than a day that were never paid.
      unpaidCheckouts: s.unpaid_checkouts,
      byMonth: months.map((m) => ({ month: m.month, naira: naira(m.kobo), payments: m.n })),
    },
  });
});

route("GET", "/api/app/admin/payments", ["admin"], async (c) => {
  const rows = await paymentHistory(c.db, { email: c.url.searchParams.get("email")?.toLowerCase() || undefined, ...page(c.url, 200) });
  return ok({ payments: rows.map((p) => ({ id: p.id, method: p.provider, providerRef: p.provider_ref, naira: naira(p.amount_kobo), paidAt: p.paid_at, reference: p.reference, programme: progName(p.programme_slug), plan: p.plan, part: p.seq, name: `${p.first_name} ${p.surname ?? ""}`.trim(), email: p.email })) });
});

// Registrations / orders, with whether the person already has a learning account.
route("GET", "/api/app/admin/orders", ["admin"], async (c) => {
  const st = c.url.searchParams.get("status");
  const rows = await ordersList(c.db, { status: st && ["pending", "part_paid", "paid", "cancelled"].includes(st) ? st : undefined, q: c.url.searchParams.get("q")?.slice(0, 80) || undefined, ...page(c.url, 200) });
  const inst = await orderInstalments(c.db, rows.map((r) => r.id));
  return ok({ orders: rows.map((o) => ({ id: o.id, reference: o.reference, createdAt: o.created_at, programme: progName(o.programme_slug), plan: o.plan, method: o.method, totalNaira: naira(o.total_kobo), paidNaira: naira(o.paid_kobo),
    outstandingNaira: naira(o.total_kobo - o.paid_kobo), status: o.status, name: `${o.first_name} ${o.surname ?? ""}`.trim(), email: o.email, phone: o.phone, accountId: o.account_id,
    parts: inst.filter((i) => i.order_id === o.id).map((i) => ({ seq: i.seq, naira: naira(i.amount_kobo), due: i.due_date, status: i.status })) })) });
});

// Admin confirms a bank transfer for one part. Same effect as a Paystack payment (and creates the account on the first part).
route("POST", "/api/app/admin/orders/:reference/payments", ["admin"], async (c) => {
  const ref = c.params.reference;
  const repo = new Repo(c.db);
  const order = await repo.getOrderByReference(ref);
  if (!order) throw notFound("That order");
  const b = await c.body();
  const ch = new Checker();
  const seq = ch.int(b.part ?? 1, 1, 3, "Part");
  const note = ch.opt(b.bankReference, 100);
  ch.done();
  const inst = (await repo.instalments(order.id)).find((i) => i.seq === seq);
  if (!inst) throw new ApiError(400, "invalid", "That part does not exist for this order.");
  if (inst.status === "paid") throw new ApiError(409, "paid", "That part is already paid.");
  const at = nowIso();
  await recordManualPayment(c.db, { id: crypto.randomUUID(), orderId: order.id, instalmentId: inst.id, ref: `BANK-${inst.reference}${note ? `-${note.replace(/[^\w-]/g, "").slice(0, 40)}` : ""}`, amountKobo: inst.amount_kobo, paidAt: at });
  await c.audit("payment.manual", "order", order.id, { part: seq, naira: inst.amount_kobo / 100, bankReference: note });
  // Same steps as a Paystack payment: on part 1 the student account, registration number and emails.
  await afterPayment(c.env, repo, inst, inst.amount_kobo, `BANK-${inst.reference}`);
  return ok({ order: await repo.getOrderByReference(ref) });
});

route("GET", "/api/app/admin/platform", ["admin"], async (c) => {
  const s = (await platformStats(c.db, days(7), days(1)))!;
  return ok({
    platform: s, errors: await recentErrors(c.db, 20),
    // Traffic and search rankings come from outside this system.
    website: { available: false, note: "Turn on Cloudflare Web Analytics for traffic, and use Google Search Console for search rankings. Registrations and conversion are shown in the overview." },
  });
});

// ======================= STUDENT: my payments =======================
route("GET", "/api/app/student/payments", ["student"], async (c) => {
  const orders = await studentOrders(c.db, c.user.id, c.user.email);
  const inst = await orderInstalments(c.db, orders.map((o) => o.id));
  const history = orders.length ? await paymentHistory(c.db, { orderIds: orders.map((o) => o.id), limit: 100, offset: 0 }) : [];
  const out = [];
  for (const o of orders) {
    const parts = inst.filter((i) => i.order_id === o.id);
    const paid = parts.filter((p) => p.status === "paid").reduce((n, p) => n + p.amount_kobo, 0);
    out.push({ reference: o.reference, programme: progName(o.programme_slug), plan: o.plan === "parts" ? "3 parts" : "Full payment", totalNaira: naira(o.total_kobo), paidNaira: naira(paid),
      outstandingNaira: naira(o.total_kobo - paid), status: o.status,
      parts: await Promise.all(parts.map(async (p) => ({ part: p.seq, naira: naira(p.amount_kobo), due: p.due_date, status: p.status, paidAt: p.paid_at,
        payLink: p.status !== "paid" && c.env.PAYSTACK_SECRET_KEY && o.method === "paystack" && o.status !== "pending" ? await payLink(c.env, p.reference) : null }))) });
  }
  return ok({ orders: out, history: history.map((h) => ({ naira: naira(h.amount_kobo), paidAt: h.paid_at, method: h.provider, reference: h.reference, part: h.seq })) });
});

