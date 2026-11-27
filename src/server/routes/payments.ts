// Paystack: start a payment (secret key stays here, server-side), receive the signed webhook, record payments
// exactly once, and serve the payment links for instalments 2 and 3.
// Docs: https://paystack.com/docs/api/transaction/#initialize  https://paystack.com/docs/payments/webhooks/
import { PROGRAMMES, duration, programmeName } from "../../../lib/config.ts";
import { money } from "../../../lib/pricing.ts";
import type { AppEnv } from "../env";
import { siteUrl } from "../env";
import { ApiError, clientIp, json, nowIso, randomCode, sha256 } from "../http";
import { Repo, type InstalmentRow, type OrderRow } from "../repo";
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

export async function startPayment(env: AppEnv, order: OrderRow, inst: InstalmentRow, email: string, callbackUrl: string) {
  if (!env.PAYSTACK_SECRET_KEY) throw new ApiError(503, "not_configured", "Online payment is not set up yet.");
  if (inst.status === "paid") throw new ApiError(409, "already_paid", "This part is already paid. Thank you.");
  const reference = `${inst.reference}-${randomCode(4)}`;
  const r = await fetch(`${PAYSTACK}/transaction/initialize`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      email, amount: inst.amount_kobo, currency: "NGN", reference, callback_url: callbackUrl, channels: ["card", "bank_transfer", "ussd", "bank"],
      metadata: { order_id: order.id, instalment_id: inst.id, part: inst.seq, programme: progName(order.programme_slug), order_reference: order.reference },
    }),
  });
  const j = (await r.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: { authorization_url: string; access_code: string } };
  if (!r.ok || !j.status || !j.data) {
    console.error("paystack initialize failed", r.status, j.message);
    throw new ApiError(502, "payment_start_failed", "We could not start the Paystack payment. Your registration is saved; please try again or choose bank transfer.");
  }
  return { reference, authorizationUrl: j.data.authorization_url, accessCode: j.data.access_code };
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
  if (ch.currency !== "NGN" || typeof ch.amount !== "number" || ch.amount < inst.amount_kobo) {
    console.error("paystack amount mismatch", ch.reference, ch.amount, ch.currency, inst.amount_kobo);
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

// Asks Paystack directly (used when the learner returns from Paystack before the webhook has arrived).
async function verifyWithPaystack(env: AppEnv, repo: Repo, ctx: ExecutionContext, reference: string) {
  if (!env.PAYSTACK_SECRET_KEY) return;
  const r = await fetch(`${PAYSTACK}/transaction/verify/${encodeURIComponent(reference)}`, { headers: { authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } });
  if (!r.ok) return;
  const j = (await r.json()) as { status?: boolean; data?: Charge };
  if (j.status && j.data) await recordCharge(env, repo, ctx, j.data, `paystack:${j.data.id ?? reference}`);
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
  const pay = await startPayment(env, order, inst, reg.email, `${site}/checkout/?p=${order.programme_slug}&ref=${order.reference}`);
  return Response.redirect(pay.authorizationUrl, 302);
}
