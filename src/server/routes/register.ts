// POST /api/register: saves a registration, its order and its instalments in D1 (one atomic batch), then emails
// the learner and the owner (Resend) and mirrors the registration to the Google Sheet. Payment starts in payments.ts.
import { EDUCATION, ENGLISH, FLAGS, BANK, duration, type Programme } from "../../../lib/config.ts";
import { assertLifecycleAllowsNew, resolveProgramme } from "../catalogue";
import { buildSnapshot, getFxPolicy, ipCountry, quoteTuition, resolveCountry, snapshotProblems, validCountry, countryCodeServer } from "../pricing";
import { dueDays, lagosDate, money, planParts, priceNaira, type Currency, type Plan } from "../../../lib/pricing.ts";
import type { AppEnv } from "../env";
import { siteUrl } from "../env";
import { ApiError, clientIp, json, nowIso, randomCode, readJson, sameOrigin } from "../http";
import { orderIntegritySupported, Repo, type InstalmentRow, type OrderRow, type RegistrationRow } from "../repo";
import { verifyTurnstile } from "../turnstile";
import { ipPseudonym } from "../privacy";
import { Checker } from "../validate";
import { button, esc, letter, notice, sendEmail, table } from "../email";
import { mirrorToSheet } from "../sheet";
import { activeHoldFor } from "./hold";
import { readRates } from "./geo";
import { startPayment } from "./payments";
import { assertCanRegister } from "../lms/admissions";

type Body = Record<string, unknown> & { learner?: Record<string, unknown>; members?: unknown };

// Stage 2: one keyed pseudonym for every IP address (src/server/privacy.ts); no predictable fallback salt.
export const ipHash = (env: AppEnv, req: Request) => ipPseudonym(env, clientIp(req));

function readLearner(c: Checker, l: Record<string, unknown>) {
  const adult = c.oneOf(l.adult, ["Yes", "No"] as const, "whether the learner is 18 or older");
  const r = {
    first_name: c.req(l.firstName, "First name", 60), middle_name: c.opt(l.middleName, 60), surname: c.req(l.surname, "Surname", 60),
    email: c.email(l.email), phone: c.phone(l.phone, "Phone or WhatsApp number"), country: c.req(l.country, "Country", 60),
    city: c.req(l.city, "City or state", 60), adult, education: c.oneOf(l.education, EDUCATION, "an educational level"),
    english: c.oneOf(l.english, ENGLISH, "an English level"), computer_literate: c.oneOf(l.computerLiterate, ["Yes", "No"] as const, "whether you are computer literate"),
    background: c.oneOf(l.background, ["Yes", "No"] as const, "whether you have background knowledge"),
    background_detail: c.opt(l.backgroundDetail, 500), why: c.req(l.why, "Why you chose this skill", 500), goals: c.req(l.goals, "Your goals", 800),
    industry: c.req(l.industry, "Industry", 120), guardian_name: c.opt(l.guardianName, 120), guardian_phone: c.phone(l.guardianPhone, "Parent or guardian phone", false),
  };
  if (adult === "No" && !(r.guardian_name && r.guardian_phone)) c.errors.push("Learners under 18 need a parent or guardian name and phone number.");
  return r;
}

export async function handleRegister(req: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
  if (!sameOrigin(req)) throw new ApiError(403, "forbidden", "Please register from skillmountainacademy.com.");
  const body = await readJson<Body>(req);
  // Hidden "website" field: people never fill it in, bots do. Pretend it worked and save nothing.
  if (body.website) return json({ ok: true, reference: `SMA-${randomCode(12)}`, method: "bank" });

  const repo = new Repo(env.DB);
  // Priced from the published catalogue in the database (bundled list only on a database older than 0011).
  // Lifecycle first (Stage C): a draft, paused or retired programme takes no registrations, whatever admissions say.
  await assertLifecycleAllowsNew(env.DB, String(body.programme ?? ""));
  const prog = await resolveProgramme(env.DB, String(body.programme ?? ""));
  if (!prog) throw new ApiError(400, "invalid", "Please choose a programme.");
  // Admissions closed, not yet open, or the programme is full: nothing is saved and nothing is charged.
  await assertCanRegister(env.DB, prog.slug);

  const c = new Checker();
  const learner = readLearner(c, (body.learner as Record<string, unknown>) ?? {});
  const plan = c.oneOf(body.plan ?? "full", ["full", "parts"] as const, "how to pay") as Plan;
  if (plan === "parts" && prog.fullPaymentOnly) c.errors.push(`${prog.name} is paid in full; it has no instalment plan.`);
  const method = c.oneOf(body.method ?? "paystack", ["paystack", "bank"] as const, "a payment method");
  // Stage D: the browser's "currency" is ignored. The country of residence comes from the form (ISO code, validated
  // here; the country name is checked as a fallback) and decides the tuition currency on the server.
  const rawLearner = (body.learner as Record<string, unknown>) ?? {};
  const declared = validCountry(rawLearner.countryCode) ?? countryCodeServer(String(rawLearner.country ?? ""));
  if (rawLearner.countryCode && !validCountry(rawLearner.countryCode)) c.errors.push("Please choose a valid country of residence.");
  if (body.termsAccepted !== true) c.errors.push("Please accept the Terms and Conditions.");
  const members = readMembers(c, body.members, prog);
  // Stage D.1: one key per checkout attempt (sent by the website). Optional for older pages, which then get no
  // de-duplication of retries, exactly as before.
  const idemKey = body.idempotencyKey == null || body.idempotencyKey === "" ? null : String(body.idempotencyKey);
  if (idemKey !== null && !/^[A-Za-z0-9-]{16,100}$/.test(idemKey)) c.errors.push("Please refresh the page and try again.");
  c.done();

  // The order can only be created on a database that holds its pricing record (migrations 0012 and 0013). Otherwise
  // nothing is saved and nothing is charged (deploy order: migrate first, then the Worker).
  if (!env.DB || !(await orderIntegritySupported(env.DB))) throw new ApiError(503, "registration_unavailable", "Registration is briefly unavailable while the system is updated. Please try again shortly or contact Admissions.");
  const fingerprint = await sha256Hex(JSON.stringify({ programme: prog.slug, plan, method, email: learner.email.toLowerCase(), members: members.map((m) => m.email.toLowerCase()).sort() }));
  // A retry of a request that already succeeded (same key) returns that order: no second order, no second payment.
  // It is answered before the security check because a Turnstile token cannot be used twice.
  if (idemKey) {
    const prior = await repo.getOrderByIdempotencyKey(idemKey);
    if (prior) return replay(env, repo, prior, fingerprint, prog);
  }

  const ip = clientIp(req);
  await verifyTurnstile(env, body.turnstileToken, ip);
  const ipH = await ipHash(env, req);
  await repo.limitOrThrow(`reg:${ipH}`, 5, 600);
  await repo.limitOrThrow(`reg-email:${learner.email}`, 5, 3600);

  // The price is ALWAYS computed here from the published catalogue and the hold cookie. Any amount sent by the browser is ignored.
  const hold = await activeHoldFor(req, env, repo, prog);
  const groupSize = members.length + 1;
  const total = priceNaira(prog, { holdActive: !!hold, groupSize });
  const parts = planParts(total, plan);
  if (method === "paystack" && !env.PAYSTACK_SECRET_KEY) throw new ApiError(503, "not_configured", "Online payment is not set up yet. Please choose bank transfer, or contact us on WhatsApp.");

  const [rates, fx] = await Promise.all([readRates(env), getFxPolicy(env.DB)]);
  const country = resolveCountry(declared, ipCountry(req));
  const q = quoteTuition({ prog, totalNaira: total, plan, country, rates, fx });
  // International tuition (a programme with a dollar price) cannot be paid online yet: nothing is saved or charged.
  if (!q.charge.available) throw new ApiError(409, "international_payment_unavailable", q.charge.reason ?? "This tuition cannot be paid online yet. Please contact Admissions.");
  const currency: Currency = q.presentation.currency;
  const now = new Date();
  const at = nowIso();
  const reference = `SMA-${method === "bank" ? "BT-" : ""}${randomCode(12)}`;
  const leadId = crypto.randomUUID();
  const terms = `Accepted v${String(body.termsVersion ?? "").slice(0, 20)} on ${at}`;
  const base = { created_at: at, programme_slug: prog.slug, terms, ip_hash: ipH };
  const people: RegistrationRow[] = [
    { id: leadId, role: "learner", lead_id: null, ...base, ...learner },
    ...members.map((m) => ({
      id: crypto.randomUUID(), role: "group_member" as const, lead_id: leadId, ...base, first_name: m.name, email: m.email,
      middle_name: null, surname: null, phone: null, country: null, city: null, adult: null, education: null, english: null, computer_literate: null,
      background: null, background_detail: null, why: null, goals: null, industry: null, guardian_name: null, guardian_phone: null,
    })),
  ];
  const order: OrderRow = {
    id: crypto.randomUUID(), reference, created_at: at, registration_id: leadId, programme_slug: prog.slug, plan, method,
    total_kobo: total * 100, regular_kobo: prog.price * 100, hold_id: hold?.id ?? null, group_size: groupSize,
    display_currency: currency, fx_rate: currency === "NGN" ? 1 : q.presentation.kind === "guide_from_naira" ? rates?.rates[currency] ?? null : null, fx_at: currency === "NGN" ? null : rates?.fetchedAt ?? null,
    status: "pending",
  };
  const days = dueDays(prog);
  const instalments: InstalmentRow[] = parts.map((n, i) => ({
    id: crypto.randomUUID(), order_id: order.id, seq: i + 1, amount_kobo: n * 100, due_date: lagosDate(now, days[i] ?? 0),
    reference: `${reference}-P${i + 1}`, status: "due", reminder_sent_at: null, link_sent_at: null, paid_at: null,
  }));
  // Stage D.1: the complete pricing snapshot is checked BEFORE anything is written, then saved in the same order row,
  // in the same D1 batch (one transaction) as the registration and the instalments: all of it, or none of it.
  const snapshot = buildSnapshot(q, prog, "registration", plan);
  const missing = snapshotProblems(snapshot);
  if (missing.length) {
    console.error("pricing snapshot incomplete", missing);
    throw new ApiError(500, "pricing_snapshot_incomplete", "We could not prepare your registration. Nothing was saved or charged. Please try again or contact Admissions.");
  }
  try {
    await repo.createRegistration({ people, order, instalments, pricing: {
      residence_country: country.residence, ip_country: country.network, pricing_tier: q.tier, tuition_currency: q.tuition.currency, tuition_minor: q.tuition.minor,
      charge_currency: "NGN", pricing_snapshot: JSON.stringify(snapshot), idempotency_key: idemKey, request_fingerprint: fingerprint } });
  } catch (e) {
    // Two identical requests at the same moment: the unique key lets only one order exist; the other answers with it.
    if (idemKey && /UNIQUE/i.test(String((e as Error)?.message))) {
      const prior = await repo.getOrderByIdempotencyKey(idemKey);
      if (prior) return replay(env, repo, prior, fingerprint, prog);
    }
    console.error("registration not saved", e);
    throw new ApiError(500, "registration_not_saved", "We could not save your registration. Nothing was saved or charged. Please try again.");
  }

  // Only now, with the order and its pricing record safely stored: emails, the sheet mirror and the payment.
  ctx.waitUntil(afterRegister(env, { prog, learner, order, instalments, members, terms }));
  const pay = method === "paystack" ? await beginPayment(env, repo, order, instalments[0], learner.email, prog.slug) : null;
  return json({
    ok: true, reference, method, plan, totalNaira: total, regularNaira: prog.price, holdApplied: !!hold,
    parts: instalments.map((i) => ({ seq: i.seq, naira: i.amount_kobo / 100, due: i.due_date })),
    payNowNaira: parts[0], chargeCurrency: "NGN", displayCurrency: currency, fxRate: order.fx_rate, tier: q.tier, country: country.country,
    authorizationUrl: pay?.authorizationUrl ?? null, accessCode: pay?.accessCode ?? null,
    bank: method === "bank" ? BANK : null,
  });
}

const sha256Hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

// Starts the Paystack payment for part 1 and keeps it on the order, so a retry reuses it instead of opening another.
async function beginPayment(env: AppEnv, repo: Repo, order: OrderRow, inst: InstalmentRow, email: string, slug: string) {
  const pay = await startPayment(env, order, inst, email, `${siteUrl(env)}/checkout/?p=${slug}&ref=${order.reference}`);
  await repo.savePaymentInit(order.id, JSON.stringify({ reference: pay.reference, authorizationUrl: pay.authorizationUrl, accessCode: pay.accessCode, at: nowIso() }))
    .catch((e) => console.error("payment init not stored", e));
  return pay;
}

// The answer to a retried registration: the SAME order, exactly as stored. A key reused for a different request is refused.
async function replay(env: AppEnv, repo: Repo, prior: OrderRow & { request_fingerprint: string | null; payment_init: string | null }, fingerprint: string, prog: Programme): Promise<Response> {
  if (prior.request_fingerprint !== fingerprint) throw new ApiError(409, "idempotency_conflict", "This checkout was already used for a different registration. Please refresh the page and start again.");
  const instalments = await repo.instalments(prior.id);
  let pay: { authorizationUrl: string; accessCode: string } | null = null;
  if (prior.method === "paystack" && instalments[0]?.status !== "paid") {
    const saved = prior.payment_init ? (JSON.parse(prior.payment_init) as { authorizationUrl: string; accessCode: string }) : null;
    if (saved) pay = saved;
    else {
      // The first attempt saved the order but could not start the payment: start it now, once.
      const reg = await repo.getRegistration(prior.registration_id);
      if (reg?.email) pay = await beginPayment(env, repo, prior, instalments[0], reg.email, prog.slug);
    }
  }
  const snap = await repo.pricingSummary(prior.id);
  return json({
    ok: true, replayed: true, reference: prior.reference, method: prior.method, plan: prior.plan, totalNaira: prior.total_kobo / 100, regularNaira: prior.regular_kobo / 100, holdApplied: !!prior.hold_id,
    parts: instalments.map((i) => ({ seq: i.seq, naira: i.amount_kobo / 100, due: i.due_date })),
    payNowNaira: (instalments[0]?.amount_kobo ?? 0) / 100, chargeCurrency: "NGN", displayCurrency: prior.display_currency, fxRate: prior.fx_rate,
    tier: snap?.pricing_tier ?? null, country: snap?.residence_country ?? snap?.ip_country ?? null,
    authorizationUrl: pay?.authorizationUrl ?? null, accessCode: pay?.accessCode ?? null, bank: prior.method === "bank" ? BANK : null,
  });
}

function readMembers(c: Checker, raw: unknown, prog: Programme): { name: string; email: string }[] {
  if (raw == null || (Array.isArray(raw) && raw.length === 0)) return [];
  if (!FLAGS.GROUP_ENABLED || prog.groupPrice == null) { c.errors.push("Group classes are not available for this programme."); return []; }
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2) { c.errors.push("A group class is you plus 1 or 2 friends."); return []; }
  return raw.map((m, i) => {
    const o = (m ?? {}) as Record<string, unknown>;
    return { name: c.req(o.name, `Friend ${i + 1}'s name`, 120), email: c.email(o.email, `Friend ${i + 1}'s email`) };
  });
}

async function afterRegister(env: AppEnv, d: { prog: Programme; learner: ReturnType<typeof readLearner>; order: OrderRow; instalments: InstalmentRow[]; members: { name: string; email: string }[]; terms: string }) {
  const { prog, learner, order, instalments } = d;
  const fullName = [learner.first_name, learner.middle_name, learner.surname].filter(Boolean).join(" ");
  const ngn = (k: number) => money(k / 100, "NGN");
  const rows: [string, string][] = [["Programme", prog.name], ["Duration", duration(prog)], ["Reference", order.reference], ["Total", ngn(order.total_kobo)]];
  const schedule = instalments.length > 1
    ? `<p>You chose to pay in 3 parts:</p>${table(instalments.map((i) => [`Part ${i.seq}${i.seq === 1 ? " (now)" : ""}`, `${ngn(i.amount_kobo)} · due ${i.due_date}`]))}
       <p>We email a secure Paystack link for parts 2 and 3 on their due dates, with a reminder 3 days before. Live sessions are paused if a payment is more than 2 weeks late.</p>`
    : "";
  const bank = order.method === "bank"
    ? `<p>Please pay <b>${ngn(instalments[0].amount_kobo)}</b> to:</p>${table([["Account name", BANK.name], ["Account number", BANK.number], ["Bank", BANK.bank]])}
       <p>Reply to this email with your teller (proof of payment), quoting your reference.</p>`
    : `<p>Complete your payment of <b>${ngn(instalments[0].amount_kobo)}</b> on the Paystack page. We email your welcome message as soon as Paystack confirms it.</p>`;
  const emailed = await sendEmail(env, {
    to: learner.email,
    subject: `We received your registration: ${prog.name}`,
    html: letter("Application received", `Dear ${learner.first_name}`, `<p>Your registration for <b>${esc(prog.name)}</b> is saved.</p>${table(rows)}${schedule}${bank}
      ${button(`${siteUrl(env)}/programmes/${prog.slug}/`, "View your programme")}<p>Questions? Just reply to this email.</p>`, "admission"),
  });
  await sendEmail(env, {
    to: env.ADMIN_EMAIL || "admission@skillmountainacademy.com",
    subject: `New registration (${order.method === "bank" ? "bank transfer" : "Paystack"}): ${prog.name}`,
    html: notice("New registration", table([["Name", fullName], ["Email", learner.email], ["Phone", learner.phone ?? ""], ...rows, ["Plan", order.plan === "parts" ? "3 parts" : "Full"], ["Group size", String(order.group_size)]]), "enquiry"),
  });
  // Same fields as the old website flow, so the existing "Applications" tab keeps working.
  // notify=false tells the updated Apps Script not to send its own email when Resend already did.
  await mirrorToSheet(env, {
    action: "apply", notify: !emailed, reference: order.reference, method: order.method === "bank" ? "Bank transfer" : "Paystack", programme: prog.name, fullName,
    adult: learner.adult, country: learner.country, city: learner.city, phone: learner.phone, email: learner.email, education: learner.education,
    duration: duration(prog), english: learner.english, guardianName: learner.guardian_name, guardianPhone: learner.guardian_phone,
    computerLiterate: learner.computer_literate, background: learner.background, backgroundDetail: learner.background_detail, why: learner.why,
    goals: learner.goals, industry: learner.industry, terms: d.terms,
    plan: order.plan, totalNaira: order.total_kobo / 100, members: d.members,
  });
}
