// LMS 4: messaging, ratings, instructor performance, admin reports, finance, manual bank payments, student payments.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { SECRETS, learner, registration, startWorker } from "./worker-harness.ts";
import { setup, signIn, type Session, eligible } from "./lms-helpers.ts";

let w: Awaited<ReturnType<typeof startWorker>>;
let admin: Session, ins: Session, insB: Session, stu: Session;
const ids: Record<string, string> = {};

before(async () => {
  w = await startWorker();
  const s = await setup(w);
  admin = s.admin;
  ids.ins = await s.make("instructor", "i4@example.com", "Ngozi Instructor");
  ids.insB = await s.make("instructor", "i4b@example.com", "Other Instructor");
  ids.stu = await s.make("student", "s4@example.com", "Tunde Student");
  ids.stuB = await s.make("student", "s4b@example.com", "Other Student");
  [ins, insB, stu] = await Promise.all(["i4", "i4b", "s4"].map((n) => signIn(w, `${n}@example.com`)));
  await eligible(admin, ids.ins, "uiux");
  ids.en = (await admin.json<{ enrolment: { id: string } }>("POST", "/api/app/admin/enrolments", { studentId: ids.stu, programme: "uiux", instructorId: ids.ins })).enrolment.id;
  await eligible(admin, ids.insB, "devops");
  await admin.json("POST", "/api/app/admin/enrolments", { studentId: ids.stuB, programme: "devops", instructorId: ids.insB });
});
after(async () => { await w.dispose(); });

test("messaging: student and assigned instructor only; unread counts; one email per unread conversation; admins cannot read", async () => {
  const c = await stu.json<{ contacts: { id: string; fullName: string }[] }>("GET", "/api/app/messages");
  assert.deepEqual(c.contacts.map((x) => x.fullName), ["Ngozi Instructor"]);
  assert.equal((await stu.send("POST", `/api/app/messages/${ids.insB}`, { body: "hi" })).status, 403, "not their instructor");
  assert.equal((await stu.send("POST", `/api/app/messages/${ids.stuB}`, { body: "hi" })).status, 403, "no student-to-student");
  assert.equal((await insB.get(`/api/app/messages/${ids.stu}`)).status, 403, "other instructors cannot read");
  assert.equal((await admin.get(`/api/app/messages/${ids.stu}`)).status, 403, "private conversations");
  const before = w.calls.length;
  await stu.json("POST", `/api/app/messages/${ids.ins}`, { body: "How do I start the wireframe?" });
  await stu.json("POST", `/api/app/messages/${ids.ins}`, { body: "Also, which tool?" });
  await w.waitFor((x) => x.slice(before).some((y) => y.body.includes("i4@example.com")));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(w.calls.slice(before).filter((x) => x.url.includes("api.resend.com") && x.body.includes("i4@example.com")).length, 1, "one email, not one per message");
  const box = await ins.json<{ contacts: { id: string; unread: number; lastMessage: string }[]; unread: number }>("GET", "/api/app/messages");
  assert.deepEqual([box.unread, box.contacts[0].unread, box.contacts[0].lastMessage], [2, 2, "Also, which tool?"]);
  const conv = await ins.json<{ messages: { mine: boolean; body: string }[] }>("GET", `/api/app/messages/${ids.stu}`);
  assert.deepEqual(conv.messages.map((m) => m.body), ["How do I start the wireframe?", "Also, which tool?"]);
  assert.equal((await ins.json<{ unread: number }>("GET", "/api/app/messages")).unread, 0, "opening marks as read");
  await ins.json("POST", `/api/app/messages/${ids.stu}`, { body: "Start with Figma. Here is a guide." });
  const back = await stu.json<{ messages: { mine: boolean }[] }>("GET", `/api/app/messages/${ids.ins}`);
  assert.deepEqual(back.messages.map((m) => m.mine), [true, true, false]);
});

test("ratings and instructor performance (instructors see comments without names; admins see names)", async () => {
  assert.equal((await stu.send("POST", "/api/app/student/ratings", { instructorId: ids.insB, rating: 5 })).status, 403);
  await stu.json("POST", "/api/app/student/ratings", { instructorId: ids.ins, rating: 4, comment: "Very patient" });
  await stu.json("POST", "/api/app/student/ratings", { instructorId: ids.ins, rating: 5, comment: "Very patient!" });
  const p = await ins.json<{ performance: { rating: { average: number; count: number }; reviews: Record<string, unknown>[]; studentsTaught: number } }>("GET", "/api/app/instructor/performance");
  assert.deepEqual([p.performance.rating.average, p.performance.rating.count, p.performance.studentsTaught], [5, 1, 1]);
  assert.equal("student" in p.performance.reviews[0], false);
  const a = await admin.json<{ performance: { reviews: { student: string }[] } }>("GET", `/api/app/admin/instructors/${ids.ins}/performance`);
  assert.equal(a.performance.reviews[0].student, "Tunde Student");
  const list = await admin.json<{ instructors: { full_name: string; students: number }[] }>("GET", "/api/app/admin/instructors");
  assert.ok(list.instructors.some((i) => i.full_name === "Ngozi Instructor" && i.students === 1));
  assert.equal((await ins.get("/api/app/admin/instructors")).status, 403);
});

test("admin overview and academic monitoring", async () => {
  const o = await admin.json<{ overview: Record<string, number> }>("GET", "/api/app/admin/overview");
  assert.ok(o.overview.students >= 2 && o.overview.instructors >= 2 && o.overview.active_students >= 2);
  assert.equal(o.overview.programmes, 9);
  assert.ok(o.overview.awaiting_timetable >= 2, "enrolments without a weekly slot are flagged");
  await ins.json("POST", "/api/app/instructor/assignments", { studentId: ids.stu, title: "Old task", dueAt: new Date(Date.now() - 3 * 86400_000).toISOString() });
  const a = await admin.json<{ academics: { assignmentCompletionPct: number }; needsAttention: { student: string; reasons: string[] }[] }>("GET", "/api/app/admin/academics");
  assert.equal(a.academics.assignmentCompletionPct, 0);
  assert.ok(a.needsAttention.some((x) => x.student === "Tunde Student" && x.reasons.some((r) => /overdue/.test(r))));
  for (const p of ["/api/app/admin/overview", "/api/app/admin/academics", "/api/app/admin/finance", "/api/app/admin/platform", "/api/app/admin/orders"]) assert.equal((await stu.get(p)).status, 403, p);
});

test("finance: Paystack revenue, outstanding instalments, bank transfer confirmed by admin creates the account; student sees their payments", async () => {
  const reg = await (await w.post("/api/register", registration({ plan: "parts", learner: learner({ email: "fin@example.com", firstName: "Fin", surname: "Ance" }) }), { "cf-connecting-ip": "10.4.0.1" })).json() as { reference: string };
  const init = w.calls.map((c) => c.url.endsWith("/transaction/initialize") ? JSON.parse(c.body) : null).find((b) => b?.reference.startsWith(reg.reference))!;
  const body = JSON.stringify({ event: "charge.success", data: { id: 880001, reference: init.reference, amount: init.amount, currency: "NGN", status: "success", paid_at: new Date().toISOString() } });
  await w.fetchApi("/api/paystack/webhook", { method: "POST", headers: { "x-paystack-signature": createHmac("sha512", SECRETS.PAYSTACK_SECRET_KEY).update(body).digest("hex") }, body });
  const bank = await (await w.post("/api/register", registration({ method: "bank", programme: "graphics", learner: learner({ email: "bank4@example.com", firstName: "Bank", surname: "Payer" }) }), { "cf-connecting-ip": "10.4.0.2" })).json() as { reference: string };
  const f = await admin.json<{ finance: { revenueNaira: number; outstandingNaira: number; instalmentOrders: number; awaitingBankConfirmation: number } }>("GET", "/api/app/admin/finance");
  assert.deepEqual([f.finance.revenueNaira, f.finance.outstandingNaira, f.finance.instalmentOrders, f.finance.awaitingBankConfirmation], [225000, 225000, 1, 1]);
  const orders = await admin.json<{ orders: { reference: string; accountId: string | null; status: string; outstandingNaira: number }[] }>("GET", "/api/app/admin/orders?q=bank4");
  assert.equal(orders.orders[0].accountId, null);
  assert.equal((await admin.send("POST", `/api/app/admin/orders/${bank.reference}/payments`, { part: 2 })).status, 400, "full payment has one part");
  await admin.json("POST", `/api/app/admin/orders/${bank.reference}/payments`, { part: 1, bankReference: "UBA-12345" });
  assert.equal((await admin.send("POST", `/api/app/admin/orders/${bank.reference}/payments`, { part: 1 })).status, 409, "no double recording");
  const after = await admin.json<{ orders: { status: string; accountId: string | null }[] }>("GET", "/api/app/admin/orders?q=bank4");
  assert.equal(after.orders[0].status, "paid");
  assert.ok(after.orders[0].accountId, "learning account created");
  const pays = await admin.json<{ payments: { method: string; naira: number }[] }>("GET", "/api/app/admin/payments");
  assert.ok(pays.payments.some((p) => p.method === "bank" && p.naira === 350000));
  const audit = await admin.json<{ entries: { action: string }[] }>("GET", "/api/app/admin/audit");
  assert.ok(audit.entries.some((e) => e.action === "payment.manual"));
  const fin = await signIn(w, "fin@example.com");
  const mine = await fin.json<{ orders: { plan: string; totalNaira: number; paidNaira: number; outstandingNaira: number; parts: { status: string; payLink: string | null }[] }[]; history: unknown[] }>("GET", "/api/app/student/payments");
  assert.deepEqual([mine.orders[0].plan, mine.orders[0].totalNaira, mine.orders[0].paidNaira, mine.orders[0].outstandingNaira], ["3 parts", 450000, 225000, 225000]);
  assert.match(mine.orders[0].parts[1].payLink!, /\/api\/pay\?ref=.*-P2&t=/);
  assert.equal(mine.history.length, 1);
  assert.equal((await stu.json<{ orders: unknown[] }>("GET", "/api/app/student/payments")).orders.length, 0, "only their own");
});

test("platform health: errors, activity, honest note about traffic and SEO", async () => {
  const p = await admin.json<{ platform: Record<string, number>; website: { available: boolean; note: string } }>("GET", "/api/app/admin/platform");
  assert.ok(p.platform.sign_ins_7d >= 5);
  assert.equal(p.website.available, false);
  assert.match(p.website.note, /Cloudflare Web Analytics/);
});
