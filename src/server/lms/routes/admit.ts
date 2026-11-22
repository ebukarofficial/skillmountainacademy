// Admin: admit a student who paid outside the website (bank transfer, cash or a Paystack payment that never reached
// the site). Creates the same records as a website registration (registration, order, instalments), records the
// parts already paid, then runs the normal after-payment steps: registration number, student account and
// enrolment, admission confirmation email and the private access email. Prices always come from lib/config.ts.
//   POST /api/app/admin/admit
import { findProgramme } from "../../../../lib/config.ts";
import { dueDays, lagosDate, planParts, priceNaira, type Plan } from "../../../../lib/pricing.ts";
import { ApiError, nowIso, randomCode } from "../../http";
import { Repo, type InstalmentRow, type OrderRow, type RegistrationRow } from "../../repo";
import { Checker } from "../../validate";
import { afterPayment } from "../../routes/payments";
import { ok, route } from "../api";
import { getUser, getUserByEmail, isApproved } from "../data/users";
import { findEnrolment, updateEnrolment } from "../data/enrolments";
import { recordManualPayment } from "../data/reports";
import { programmeAdmissions } from "../admissions";

route("POST", "/api/app/admin/admit", ["admin"], async (c) => {
  const b = await c.body();
  const ch = new Checker();
  const prog = findProgramme(String(b.programme ?? ""));
  if (!prog) ch.errors.push("Please choose a programme.");
  const firstName = ch.req(b.firstName, "First name", 60);
  const surname = ch.req(b.surname, "Surname", 60);
  const email = ch.email(b.email, "Email");
  const phone = ch.opt(b.phone, 30);
  const country = ch.opt(b.country, 60);
  const plan = ch.oneOf(b.plan ?? "full", ["full", "parts"] as const, "the payment plan") as Plan;
  const paidParts = plan === "full" ? 1 : ch.int(b.paidParts ?? 1, 1, 3, "Parts already paid");
  const progFor = findProgramme(String(b.programme ?? ""));
  if (plan === "parts" && progFor?.fullPaymentOnly) ch.errors.push(`${progFor.name} is paid in full; it has no instalment plan.`);
  const reference = ch.opt(b.paymentReference, 100);
  const instructorId = b.instructorId ? String(b.instructorId) : null;
  ch.done();
  const p = prog!;
  const db = c.db;

  // One admission per student per programme.
  const existing = await getUserByEmail(db, email);
  if (existing && existing.role !== "student") throw new ApiError(409, "conflict", "That email belongs to a staff account.");
  if (existing && (await findEnrolment(db, existing.id, p.slug))) throw new ApiError(409, "conflict", `${existing.full_name} is already admitted to ${p.name}.`);
  if (instructorId) {
    const ins = await getUser(db, instructorId);
    if (!ins || ins.role !== "instructor" || ins.status !== "active" || !isApproved(ins)) throw new ApiError(400, "invalid", "Choose an approved, active instructor.");
  }
  // Admins may admit beyond the public status (for example a payment taken before admissions closed); it is recorded.
  const status = (await programmeAdmissions(db)).list.find((x) => x.slug === p.slug)?.status.state ?? "open";

  const repo = new Repo(db);
  const at = nowIso();
  const now = new Date();
  const ref = `SMA-BT-${randomCode(12)}`;
  const total = priceNaira(p);
  const parts = planParts(total, plan);
  const reg: RegistrationRow = {
    id: crypto.randomUUID(), role: "learner", lead_id: null, created_at: at, programme_slug: p.slug, terms: `Admitted by ${c.user.email} on ${at} (terms accepted outside the website)`,
    ip_hash: null, first_name: firstName, middle_name: null, surname, email, phone, country, city: null, adult: null, education: null, english: null,
    computer_literate: null, background: null, background_detail: null, why: null, goals: null, industry: null, guardian_name: null, guardian_phone: null,
  };
  const order: OrderRow = {
    id: crypto.randomUUID(), reference: ref, created_at: at, registration_id: reg.id, programme_slug: p.slug, plan, method: "bank",
    total_kobo: total * 100, regular_kobo: p.price * 100, hold_id: null, group_size: 1, display_currency: "NGN", fx_rate: 1, fx_at: null, status: "pending",
  };
  const days = dueDays(p);
  const instalments: InstalmentRow[] = parts.map((n, i) => ({
    id: crypto.randomUUID(), order_id: order.id, seq: i + 1, amount_kobo: n * 100, due_date: lagosDate(now, days[i] ?? 0),
    reference: `${ref}-P${i + 1}`, status: "due", reminder_sent_at: null, link_sent_at: null, paid_at: null,
  }));
  await repo.createRegistration({ people: [reg], order, instalments });
  const note = reference ? `-${reference.replace(/[^\w-]/g, "").slice(0, 40)}` : "";
  for (const inst of instalments.slice(0, paidParts)) {
    await recordManualPayment(db, { id: crypto.randomUUID(), orderId: order.id, instalmentId: inst.id, ref: `BANK-${inst.reference}${note}`, amountKobo: inst.amount_kobo, paidAt: at });
  }
  await c.audit("admission.admin", "order", order.id, { programme: p.slug, email, plan, paidParts, paymentReference: reference, publicStatus: status });

  // Part 1 runs the full admission (account, registration number, emails). Later parts already paid get no extra emails.
  await afterPayment(c.env, repo, instalments[0], instalments[0].amount_kobo, `BANK-${instalments[0].reference}${note}`);
  const student = await getUserByEmail(db, email);
  if (student && instructorId) {
    const e = await findEnrolment(db, student.id, p.slug);
    if (e) await updateEnrolment(db, e.id, { instructor_id: instructorId });
  }
  return ok({
    student: student ? { id: student.id, fullName: student.full_name, email: student.email, studentNo: student.student_no } : null,
    order: { reference: ref, totalNaira: total, paidNaira: parts.slice(0, paidParts).reduce((a, n) => a + n, 0), parts: parts.length },
  }, 201);
});
