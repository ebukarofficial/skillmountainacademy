// Reconciliation of Paystack checkout attempts (Expansion Stage D.1.1). Finance only.
//   GET  /api/app/admin/payments/attempts                 uncertain, stale and recently failed attempts
//   POST /api/app/admin/payments/attempts/:id/check       read-only check with Paystack; a payment Paystack reports as
//                                                         successful is recorded through the existing, idempotent path
//   POST /api/app/admin/payments/attempts/:id/release     {reason, confirmedWithPaystack}: after checking, release an
//                                                         uncertain attempt so the student can open a new checkout.
//                                                         Needs the authenticator code. Never possible for a paid one.
//                                                         Stage E: disabled until the owner authorises it (see below).
// Nothing here starts a payment: a new attempt is opened only when the student retries, through initiatePayment().
import { ApiError } from "../../http";
import { ok, requireStrongAuth, route } from "../api";
import { Checker } from "../../validate";
import { Repo } from "../../repo";
import { CLAIM_TTL_MS, verifyReference, verifyWithPaystack } from "../../routes/payments";
import { checkReleasable, releaseAttempt } from "../payment-release";
import { getApprovalPolicy, openApproval } from "../institution";

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

// Stage E: release is OFF for everyone (the owner included) until the owner records who may release and whether a
// second person must approve (approval_policy.paymentRelease). With approval required, the officer's request is stored
// and nothing is released until the approver decides; the release then re-runs every check above at that moment.
route("POST", "/api/app/admin/payments/attempts/:id/release", ["admin"], async (c) => {
  const rule = (await getApprovalPolicy(c.db)).paymentRelease;
  if (!rule || !rule.enabled) {
    await c.audit("payment.attempt_release_refused", "payment_attempt", c.params.id, { why: "not_authorised" });
    throw new ApiError(403, "release_not_authorised", "Releasing a payment attempt has not been authorised by the owner yet. Check the attempt with Paystack and escalate to the owner.");
  }
  const group = c.effectiveAdminRole ?? c.user.admin_role ?? "";
  if (!c.isOwner && !(rule.allowedGroups as string[]).includes(group)) {
    await c.audit("payment.attempt_release_refused", "payment_attempt", c.params.id, { why: "group_not_authorised", group });
    throw new ApiError(403, "release_not_authorised", "Your administrator group is not authorised by the owner to release payment attempts.");
  }
  await requireStrongAuth(c, "payment.attempt_release", c.params.id);
  const b = await c.body();
  const ch = new Checker();
  const reason = ch.req(b.reason, "Reason", 500);
  ch.done();
  const confirmed = b.confirmedWithPaystack === true;
  if (rule.requiresApproval && !c.isOwner) {
    await checkReleasable(c, c.params.id, confirmed);
    const request = await openApproval(c, { category: "payment_attempt_release", targetType: "payment_attempt", targetId: c.params.id, payload: { confirmedWithPaystack: confirmed }, reason, rule });
    return ok({ approvalRequired: true, request }, 202);
  }
  const attempt = await releaseAttempt(c, c.params.id, { reason, confirmedWithPaystack: confirmed, releasedBy: c.user.id });
  return ok({ attempt });
});
