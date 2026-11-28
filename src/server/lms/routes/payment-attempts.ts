// Reconciliation of Paystack checkout attempts (Expansion Stage D.1.1). Finance only.
//   GET  /api/app/admin/payments/attempts                 uncertain, stale and recently failed attempts
//   POST /api/app/admin/payments/attempts/:id/check       read-only check with Paystack; a payment Paystack reports as
//                                                         successful is recorded through the existing, idempotent path
//   POST /api/app/admin/payments/attempts/:id/release     {reason, confirmedWithPaystack}: after checking, release an
//                                                         uncertain attempt so the student can open a new checkout.
//                                                         Needs the authenticator code. Never possible for a paid one.
// Nothing here starts a payment: a new attempt is opened only when the student retries, through initiatePayment().
import { ApiError } from "../../http";
import { ok, requireStrongAuth, route } from "../api";
import { Checker } from "../../validate";
import { Repo } from "../../repo";
import { CLAIM_TTL_MS, verifyReference, verifyWithPaystack } from "../../routes/payments";

route("GET", "/api/app/admin/payments/attempts", ["admin"], async (c) => {
  const repo = new Repo(c.db);
  const rows = (await repo.listAttempts(["uncertain", "claimed", "failed"])) as Record<string, unknown>[];
  return ok({ attempts: rows.map((r) => ({ ...r, stale: r.state === "claimed" && Date.now() - Date.parse(String(r.claimed_at)) > CLAIM_TTL_MS })) });
});

route("POST", "/api/app/admin/payments/attempts/:id/check", ["admin"], async (c) => {
  const repo = new Repo(c.db);
  const a = await repo.getAttempt(c.params.id);
  if (!a) throw new ApiError(404, "not_found", "That payment attempt was not found.");
  const v = await verifyReference(c.env, a.reference);
  if (v.known && v.status === "success") await verifyWithPaystack(c.env, repo, c.exec, a.reference);
  await c.audit("payment.attempt_check", "payment_attempt", a.id, { reference: a.reference, state: a.state, paystack: v });
  return ok({ attempt: await repo.getAttempt(a.id), paystack: v, instalment: await repo.getInstalment(a.instalment_id) });
});

route("POST", "/api/app/admin/payments/attempts/:id/release", ["admin"], async (c) => {
  await requireStrongAuth(c, "payment.attempt_release", c.params.id);
  const repo = new Repo(c.db);
  const a = await repo.getAttempt(c.params.id);
  if (!a) throw new ApiError(404, "not_found", "That payment attempt was not found.");
  const b = await c.body();
  const ch = new Checker();
  const reason = ch.req(b.reason, "Reason", 500);
  ch.done();
  if (a.state === "claimed" && Date.now() - Date.parse(a.claimed_at) <= CLAIM_TTL_MS) throw new ApiError(409, "in_progress", "This attempt is still in progress. Wait a few minutes before checking it.");
  if (!["uncertain", "claimed"].includes(a.state)) throw new ApiError(409, "not_uncertain", `This attempt is ${a.state}; only an uncertain attempt can be released.`);
  const inst = await repo.getInstalment(a.instalment_id);
  if (inst?.status === "paid") throw new ApiError(409, "paid", "This part is already paid. Nothing to release.");
  // Check with Paystack first. A successful payment is recorded, never released.
  const v = await verifyReference(c.env, a.reference);
  if (v.known && v.status === "success") {
    await verifyWithPaystack(c.env, repo, c.exec, a.reference);
    throw new ApiError(409, "paid_at_paystack", "Paystack reports this payment as successful. It has been recorded; the attempt is not released.");
  }
  // Paystack does not document its answer for an unknown reference, so when it cannot confirm the attempt, the release
  // needs Finance's explicit confirmation that they checked the Paystack dashboard.
  if (!v.known && b.confirmedWithPaystack !== true) throw new ApiError(409, "confirm_required", `Paystack could not confirm this reference (${v.detail}). Check ${a.reference} in the Paystack dashboard, then confirm.`);
  if (!(await repo.moveAttempt(a.id, ["uncertain", "claimed"], "released", { released_by: c.user.id, released_reason: reason }))) throw new ApiError(409, "changed", "This attempt changed in the meantime. Reload and check again.");
  await c.audit("payment.attempt_release", "payment_attempt", a.id, { reference: a.reference, reason, paystack: v, confirmedWithPaystack: b.confirmedWithPaystack === true });
  return ok({ attempt: await repo.getAttempt(a.id) });
});
