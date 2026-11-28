// Paystack: start a payment (secret key stays here, server-side), receive the signed webhook, record payments
// exactly once, and serve the payment links for instalments 2 and 3.
// Docs: https://paystack.com/docs/api/transaction/#initialize  https://paystack.com/docs/payments/webhooks/
import { PROGRAMMES, duration, programmeName } from "../../../lib/config.ts";
import { money } from "../../../lib/pricing.ts";
import type { AppEnv } from "../env";
import { siteUrl } from "../env";
import { ApiError, clientIp, json, nowIso, sha256 } from "../http";
import { orderIntegritySupported, Repo, type InstalmentRow, type OrderRow, type PaymentAttempt } from "../repo";
import { ipPseudonym } from "../privacy";
import { button, esc, layout, letter, notice, sendEmail, table } from "../email";
import { mirrorToSheet } from "../sheet";
import { ensureStudentAccount } from "../lms/accounts";
import { sendSignInLink } from "../lms/routes/auth";

const PAYSTACK = "https://api.paystack.co";
const progName = (slug: string) => programmeName(slug);

// Each attempt gets its own Paystack reference: <instalment reference>-<4 characters>. Paystack refuses to reuse a reference.
const INST_REF = /^(SMA-(?:BT-)?[A-Z0-9]{12}-P\d)(?:-[A-Z0-9]{4})?$/;
export const instalmentRefOf = (paystackRef: string) => INST_REF.exec(paystackRef)?.[1] ?? null;

// ---------- Paystack checkout initialisation (Stage D.1.1) ----------
// Paystack's API reference documents no idempotency header for /transaction/initialize; it requires a unique reference.
// So every call goes through initiatePayment(): a durable claim in D1 (payment_attempts, one active attempt per instalment)
// is taken BEFORE Paystack is called, and the reference is deterministic per attempt. Outcomes are classified:
//   initialized  Paystack returned a checkout -> stored and reused by every retry
//   failed       Paystack answered with a definite refusal (HTTP 4xx, status false, not a duplicate) -> a new attempt is allowed
//   uncertain    timeout, network error, 5xx, unreadable answer, "duplicate reference", or a crash -> NO automatic new attempt;
//                Finance reconciles it (check with Paystack, then release with a reason)
export const CLAIM_TTL_MS = 120_000; // a claim older than this without a result is treated as uncertain
const PAYSTACK_TIMEOUT_MS = 20_000;
export type InitResult = { reference: string; authorizationUrl: string; accessCode: string; reused: boolean };
type Outcome = { kind: "ok"; url: string; code: string } | { kind: "failed"; detail: string } | { kind: "uncertain"; detail: string };

async function callInitialize(env: AppEnv, order: OrderRow, inst: InstalmentRow, email: string, callbackUrl: string, reference: string): Promise<Outcome> {
  let r: Response;
  try {
    r = await fetch(`${PAYSTACK}/transaction/initialize`, {
      method: "POST", signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
      headers: { authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        email, amount: inst.amount_kobo, currency: "NGN", reference, callback_url: callbackUrl, channels: ["card", "bank_transfer", "ussd", "bank"],
        metadata: { order_id: order.id, instalment_id: inst.id, part: inst.seq, programme: progName(order.programme_slug), order_reference: order.reference },
      }),
    });
  } catch (e) {
    return { kind: "uncertain", detail: `no answer from Paystack (${(e as Error)?.name ?? "error"})` };
  }
  const j = (await r.json().catch(() => null)) as { status?: boolean; message?: string; data?: { authorization_url?: string; access_code?: string } } | null;
  if (r.ok && j?.status && j.data?.authorization_url) return { kind: "ok", url: j.data.authorization_url, code: j.data.access_code ?? "" };
  const msg = String(j?.message ?? "").slice(0, 200);
  if (r.status >= 400 && r.status < 500 && j && j.status === false && !/duplicate/i.test(msg)) return { kind: "failed", detail: `Paystack refused (${r.status}): ${msg}` };
  return { kind: "uncertain", detail: `unclear answer from Paystack (${r.status}): ${msg || "unreadable"}` };
}

const NEEDS_CHECK = "We could not confirm whether your Paystack payment page was opened. To make sure you are never charged twice, our team is checking it. Please try again in a few minutes, pay by bank transfer, or contact Admissions.";

export async function initiatePayment(env: AppEnv, repo: Repo, order: OrderRow, inst: InstalmentRow, email: string, callbackUrl: string): Promise<InitResult> {
  if (!env.PAYSTACK_SECRET_KEY) throw new ApiError(503, "not_configured", "Online payment is not set up yet.");
  if (inst.status === "paid") throw new ApiError(409, "already_paid", "This part is already paid. Thank you.");
  if (!order.id || !(await orderIntegritySupported(repo.db))) throw new ApiError(503, "payment_unavailable", "Online payment is briefly unavailable. Please try again shortly or contact Admissions.");
  // No pricing record, no online payment (historical orders made before Stage D excepted).
  const integrity = await repo.paymentIntegrity(order.id);
  if (!integrity.ok) {
    console.error("payment refused: order has no pricing record", order.reference);
    throw new ApiError(409, "payment_blocked", "This order cannot be paid online. Please contact Admissions, who will check it with you.");
  }
  // An attempt is already active for this instalment.
  const active = await repo.activeAttempt(inst.id);
  if (active) return reuseOrRefuse(repo, active);
  const attempt = await repo.nextAttemptNo(inst.id);
  const reference = `${inst.reference}-A${String(attempt).padStart(3, "0")}`;
  const id = crypto.randomUUID();
  const claimed = await repo.claimAttempt({ id, order_id: order.id, instalment_id: inst.id, attempt, reference, at: new Date().toISOString() });
  if (claimed === null) throw new ApiError(409, "payment_needs_check", NEEDS_CHECK); // Stage E.4: paid, or a payment needs reconciling
  if (!claimed) {
    // Another request claimed it a moment ago (or took this attempt number): never call Paystack ourselves.
    const now = await repo.activeAttempt(inst.id);
    if (now) return reuseOrRefuse(repo, now);
    throw new ApiError(409, "payment_in_progress", "Your payment is being prepared. Please wait a moment and try again.");
  }
  const out = await callInitialize(env, order, inst, email, callbackUrl, reference);
  if (out.kind === "ok") {
    // A failed write here does NOT mean Paystack failed: the checkout is valid and is returned. The claim then stays
    // 'claimed', becomes 'uncertain' after CLAIM_TTL_MS, and is reconciled; no automatic second attempt is made.
    await repo.moveAttempt(id, ["claimed"], "initialized", { authorization_url: out.url, access_code: out.code }).catch((e) => console.error("payment attempt not stored after Paystack success", reference, e));
    return { reference, authorizationUrl: out.url, accessCode: out.code, reused: false };
  }
  if (out.kind === "failed") {
    await repo.moveAttempt(id, ["claimed"], "failed", { detail: out.detail }).catch((e) => console.error("payment attempt state not stored", reference, e));
    console.error("paystack initialize refused", reference, out.detail);
    throw new ApiError(502, "payment_start_failed", "We could not start the Paystack payment. Your registration is saved; please try again or choose bank transfer.");
  }
  await repo.moveAttempt(id, ["claimed"], "uncertain", { detail: out.detail }).catch((e) => console.error("payment attempt state not stored", reference, e));
  console.error("paystack initialize uncertain", reference, out.detail);
  throw new ApiError(502, "payment_needs_check", NEEDS_CHECK);
}

async function reuseOrRefuse(repo: Repo, a: PaymentAttempt): Promise<InitResult> {
  if (a.state === "initialized" && a.authorization_url) return { reference: a.reference, authorizationUrl: a.authorization_url, accessCode: a.access_code ?? "", reused: true };
  if (a.state === "claimed" && Date.now() - Date.parse(a.claimed_at) < CLAIM_TTL_MS)
    throw new ApiError(409, "payment_in_progress", "Your payment is being prepared. Please wait a moment and try again.");
  // A stale claim (the request that owned it never finished) or an uncertain attempt: never retried automatically.
  if (a.state === "claimed") await repo.moveAttempt(a.id, ["claimed"], "uncertain", { detail: "claim expired without a recorded result" });
  throw new ApiError(409, "payment_needs_check", NEEDS_CHECK);
}

// Read-only check of a reference with Paystack. Stage E.4: "known" only for a well-formed answer about THIS reference;
// a timeout, error, unreadable or ambiguous answer is "not confirmed" (known null) and is never proof of non-payment.
export type Verified = { known: boolean | null; status: string | null; amount: number | null; currency: string | null; detail: string; charge?: Charge };
export async function verifyReference(env: AppEnv, reference: string): Promise<Verified> {
  try {
    if (!env.PAYSTACK_SECRET_KEY) throw new Error("not configured"); // as before: no call without the key (unknown)
    const r = await fetch(`${PAYSTACK}/transaction/verify/${encodeURIComponent(reference)}`, { headers: { authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` }, signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS) });
    const j = (await r.json().catch(() => null)) as { status?: boolean; message?: string; data?: Charge } | null;
    const d = j?.data;
    if (r.ok && j?.status === true && d?.reference === reference && typeof d.status === "string") return { known: true, status: d.status, amount: d.amount ?? null, currency: d.currency ?? null, detail: String(j.message ?? ""), charge: d };
    return { known: null, status: null, amount: null, currency: null, detail: `${r.status}: ${String(j?.message ?? "unreadable").slice(0, 200)}` };
  } catch (e) {
    return { known: null, status: null, amount: null, currency: null, detail: `no answer from Paystack (${(e as Error)?.name ?? "error"})` };
  }
}

async function hmacHex(alg: "SHA-512" | "SHA-256", key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: alg }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

type Charge = { id?: number; reference?: string; amount?: number; currency?: string; status?: string; paid_at?: string; metadata?: { instalment_id?: string } };

// Records a successful Paystack charge. Safe to call any number of times for the same charge.
export async function recordCharge(env: AppEnv, repo: Repo, ctx: ExecutionContext, ch: Charge, eventId: string): Promise<"recorded" | "duplicate" | "ignored"> {
  if (ch.status !== "success" || !ch.reference) return "ignored";
  const instRef = instalmentRefOf(ch.reference);
  const inst = instRef ? await repo.getInstalmentByReference(instRef) : null;
  if (!inst) { console.warn("paystack charge for unknown reference", ch.reference); return "ignored"; }
  // The amount must be the full part, in naira. Anything else is left for the owner to check by hand.
  if (ch.currency !== "NGN" || typeof ch.amount !== "number" || ch.amount < inst.amount_kobo || (ch.metadata?.instalment_id ?? inst.id) !== inst.id) {
    console.error("paystack amount mismatch", ch.reference, ch.amount, ch.currency, inst.amount_kobo);
    await repo.flagAttempt(ch.reference); // Stage E.4: money arrived that a person must reconcile; no new checkout meanwhile
    return "ignored";
  }
  const paidAt = ch.paid_at && !Number.isNaN(Date.parse(ch.paid_at)) ? new Date(ch.paid_at).toISOString() : nowIso();
  const isNew = await repo.recordPayment({ id: crypto.randomUUID(), orderId: inst.order_id, instalmentId: inst.id, providerRef: ch.reference, amountKobo: ch.amount, currency: "NGN", paidAt, eventId });
  if (!isNew) return "duplicate";
  ctx.waitUntil(afterPayment(env, repo, inst, ch.amount, ch.reference));
  return "recorded";
}

// After a confirmed payment (Paystack webhook, or an admin recording a transfer). Runs once per payment.
export async function afterPayment(env: AppEnv, repo: Repo, inst: InstalmentRow, amountKobo: number, ref: string) {
  const order = await repo.getOrder(inst.order_id);
  if (!order) return;
  const reg = await repo.getRegistration(order.registration_id);
  if (!reg) return;
  const p = PROGRAMMES.find((x) => x.slug === order.programme_slug);
  const name = p?.name ?? order.programme_slug;
  const all = await repo.instalments(order.id);
  const left = all.filter((i) => i.status !== "paid");
  const ngn = (k: number) => money(k / 100, "NGN");
  const site = siteUrl(env);
  const rows: [string, string][] = [["Programme", name], ["Amount paid", ngn(amountKobo)], ["Reference", ref], ...(p ? [["Duration", duration(p)] as [string, string]] : [])];
  const booking = env.CLASS_BOOKING_URL ? button(env.CLASS_BOOKING_URL, "Book my classes") : "<p>We will send you a link to choose your class days and times within one working day.</p>";
  const rest = left.length ? `<p>Still to pay: ${left.map((i) => `part ${i.seq}, ${ngn(i.amount_kobo)} due ${i.due_date}`).join("; ")}. We email a payment link on each due date, with a reminder 3 days before. Live sessions are paused if a payment is more than 2 weeks late.</p>` : "<p>Your programme is now fully paid.</p>";
  const welcome = inst.seq === 1;
  // First payment: the learner gets a student account and enrolment on the learning platform.
  const student = welcome ? await ensureStudentAccount(env, reg, order) : null;
  const regNo = student?.student_no ?? null;
  // 1. Admission confirmation (first payment) or payment receipt (later parts).
  await sendEmail(env, {
    to: reg.email,
    subject: welcome ? `Admission confirmed: ${name}` : `Payment received: ${name} (part ${inst.seq})`,
    html: layout(`Dear ${esc(reg.first_name)}`,
      `${welcome ? `<p>We are pleased to confirm your admission to <b>${esc(name)}</b> at Skill Mountain Academy. Your payment has been received and your place is secured.</p>` : "<p>Thank you. We have received your payment.</p>"}
       ${table([...(regNo ? [["Registration No", regNo] as [string, string]] : []), ...rows])}${rest}
       ${welcome ? `<p>Please keep your registration number for all correspondence with the Academy.</p><h3 style="margin:26px 0 4px;font-family:Montserrat,Arial,sans-serif;font-size:17px">Your curriculum</h3>${button(`${site}${p?.curriculum ?? "/"}`, "Open the curriculum")}<h3 style="margin:26px 0 4px;font-family:Montserrat,Arial,sans-serif;font-size:17px">Your weekly class time</h3>${booking}<p>A separate email brings your private link to your learning space.</p>` : ""}`, { headline: welcome ? "Admission confirmed" : "Payment received", kind: welcome ? "admission" : "payment" }),
  });
  // 2. Access to the learning space: a fresh single-use sign-in link.
  if (welcome && student && student.status === "active" && env.DB) await sendSignInLink(env, env.DB, student, true);
  // Group members get their own welcome when the lead's first payment arrives.
  if (welcome && order.group_size > 1) {
    for (const m of await repo.groupMembers(reg.id)) {
      await sendEmail(env, { to: m.email, subject: `You're in: ${name} with ${reg.first_name}`, html: letter("You are in", `Welcome, ${m.first_name}`, `<p>${reg.first_name} registered you for <b>${name}</b> as a group class. You will share one live class, with your own record, grades and attendance.</p>${booking}`) });
    }
  }
  await sendEmail(env, { to: env.ADMIN_EMAIL || "admission@skillmountainacademy.com", subject: `Payment confirmed: ${name} (part ${inst.seq} of ${all.length})`, html: notice("Payment confirmed", table([["Learner", `${reg.first_name} ${reg.surname ?? ""}`], ["Email", reg.email], ["Phone", reg.phone ?? ""], ...rows]), "payment") });
  await mirrorToSheet(env, { action: "payment", reference: order.reference, paystackReference: ref, part: inst.seq, parts: all.length, amountNaira: amountKobo / 100, programme: name, email: reg.email, status: left.length ? "PART PAID" : "PAID" });
}

// POST /api/paystack/webhook. The x-paystack-signature header is HMAC-SHA512 of the raw body with the secret key.
export async function handleWebhook(req: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
  if (!env.PAYSTACK_SECRET_KEY) return json({ ok: false }, 503);
  const raw = await req.text();
  if (raw.length > 100_000) return json({ ok: false }, 413);
  const sig = req.headers.get("x-paystack-signature") || "";
  if (!safeEqual(sig.toLowerCase(), await hmacHex("SHA-512", env.PAYSTACK_SECRET_KEY, raw))) return json({ ok: false, error: "bad_signature" }, 401);
  let evt: { event?: string; data?: Charge };
  try { evt = JSON.parse(raw); } catch { return json({ ok: false }, 400); }
  if (evt.event !== "charge.success" || !evt.data) return json({ ok: true, ignored: true });
  const repo = new Repo(env.DB);
  const eventId = `paystack:${evt.data.id ?? (await sha256(raw))}`;
  const result = await recordCharge(env, repo, ctx, evt.data, eventId);
  return json({ ok: true, result });
}

// Asks Paystack directly (the learner returned before the webhook, or Finance checks an attempt). Never throws for a
// Paystack failure; only a confirmed success is recorded (idempotently, like the webhook).
export async function verifyWithPaystack(env: AppEnv, repo: Repo, ctx: ExecutionContext, reference: string) {
  const v = await verifyReference(env, reference);
  if (v.known && v.status === "success") await recordCharge(env, repo, ctx, v.charge!, `paystack:${v.charge!.id ?? reference}`);
  return v;
}

// GET /api/order?ref=<order reference>[&trxref=<paystack reference>]: payment status for the "thank you" screen. No personal data.
export async function handleOrderStatus(req: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref") || "";
  if (!/^SMA-(BT-)?[A-Z0-9]{12}$/.test(ref)) throw new ApiError(400, "invalid", "Unknown reference.");
  const repo = new Repo(env.DB);
  await repo.limitOrThrow(`order:${await ipPseudonym(env, clientIp(req))}`, 30, 600);
  let order = await repo.getOrderByReference(ref);
  if (!order) throw new ApiError(404, "not_found", "Unknown reference.");
  const trx = url.searchParams.get("trxref") || url.searchParams.get("reference") || "";
  if (order.status !== "paid" && instalmentRefOf(trx)?.startsWith(`${ref}-P`)) {
    await verifyWithPaystack(env, repo, ctx, trx);
    order = (await repo.getOrderByReference(ref))!;
  }
  const parts = await repo.instalments(order.id);
  return json({ ok: true, reference: ref, status: order.status, programme: order.programme_slug, totalNaira: order.total_kobo / 100,
    parts: parts.map((i) => ({ seq: i.seq, naira: i.amount_kobo / 100, due: i.due_date, status: i.status })) });
}

// Signed payment links for parts 2 and 3: /api/pay?ref=<instalment reference>&t=<signature>
export const payLinkSig = (env: AppEnv, instRef: string) => hmacHex("SHA-256", env.PAYSTACK_SECRET_KEY || "", `pay|${instRef}`).then((h) => h.slice(0, 32));
export async function payLink(env: AppEnv, instRef: string) {
  return `${siteUrl(env)}/api/pay?ref=${encodeURIComponent(instRef)}&t=${await payLinkSig(env, instRef)}`;
}

export async function handlePayLink(req: Request, env: AppEnv): Promise<Response> {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref") || "";
  const site = siteUrl(env);
  if (!env.PAYSTACK_SECRET_KEY || !env.DB) return Response.redirect(`${site}/?notice=pay-unavailable`, 302);
  if (!INST_REF.test(ref) || !safeEqual(url.searchParams.get("t") || "", await payLinkSig(env, ref))) throw new ApiError(400, "invalid", "This payment link is not valid. Please contact us.");
  const repo = new Repo(env.DB);
  const inst = await repo.getInstalmentByReference(ref);
  if (!inst) throw new ApiError(404, "not_found", "This payment link is not valid. Please contact us.");
  const order = (await repo.getOrder(inst.order_id))!;
  if (inst.status === "paid") return Response.redirect(`${site}/checkout/?p=${order.programme_slug}&ref=${order.reference}`, 302);
  const reg = (await repo.getRegistration(order.registration_id))!;
  try {
    const pay = await initiatePayment(env, repo, order, inst, reg.email, `${site}/checkout/?p=${order.programme_slug}&ref=${order.reference}`);
    return Response.redirect(pay.authorizationUrl, 302);
  } catch (e) {
    if (e instanceof ApiError && ["payment_in_progress", "payment_needs_check", "payment_start_failed", "payment_unavailable", "payment_blocked"].includes(e.code))
      return Response.redirect(`${site}/?notice=pay-unavailable`, 302);
    throw e;
  }
}
