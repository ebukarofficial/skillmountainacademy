// Releasing an uncertain Paystack checkout attempt (Stage D.1.1 reconciliation, gated in Stage E).
// The safety checks live here so the direct route and an approved request run exactly the same checks, at the moment
// the release actually happens. A release is never a retry: it only lets the student open a new checkout themselves.
import { ApiError } from "../http";
import type { Ctx } from "./api";
import { Repo, type PaymentAttempt } from "../repo";
import { auditStmt } from "./data/users";
import { releaseConditions } from "./policy-sql";
import { CLAIM_TTL_MS, verifyReference, verifyWithPaystack } from "../routes/payments";

// Every check short of the release itself. Paystack is asked first; a payment it reports as successful is recorded
// through the existing idempotent path and never released.
export async function checkReleasable(c: Ctx, attemptId: string, confirmedWithPaystack: boolean) {
  const repo = new Repo(c.db);
  const a = await repo.getAttempt(attemptId);
  if (!a) throw new ApiError(404, "not_found", "That payment attempt was not found.");
  if (a.state === "claimed" && Date.now() - Date.parse(a.claimed_at) <= CLAIM_TTL_MS) throw new ApiError(409, "in_progress", "This attempt is still in progress. Wait a few minutes before checking it.");
  if (!["uncertain", "claimed"].includes(a.state)) throw new ApiError(409, "not_uncertain", `This attempt is ${a.state}; only an uncertain attempt can be released.`);
  const inst = await repo.getInstalment(a.instalment_id);
  if (inst?.status === "paid") throw new ApiError(409, "paid", "This part is already paid. Nothing to release.");
  const v = await verifyReference(c.env, a.reference);
  if (v.known && v.status === "success") {
    await verifyWithPaystack(c.env, repo, c.exec, a.reference);
    throw new ApiError(409, "paid_at_paystack", "Paystack reports this payment as successful. It has been recorded; the attempt is not released.");
  }
  // Paystack does not document its answer for an unknown reference, so an unconfirmed attempt needs the officer's
  // explicit confirmation that they checked the Paystack dashboard.
  if (!v.known && !confirmedWithPaystack) throw new ApiError(409, "confirm_required", `Paystack could not confirm this reference (${v.detail}). Check ${a.reference} in the Paystack dashboard, then confirm.`);
  return { repo, attempt: a as PaymentAttempt, paystack: v };
}

export async function releaseAttempt(c: Ctx, attemptId: string, o: { reason: string; confirmedWithPaystack: boolean; releasedBy: string; approvedBy?: string; approvalRequest?: string }) {
  const { repo, attempt: a, paystack } = await checkReleasable(c, attemptId, o.confirmedWithPaystack);
  const reason = o.approvalRequest ? `${o.reason} (approval ${o.approvalRequest})` : o.reason;
  if (!(await repo.moveAttempt(a.id, ["uncertain", "claimed"], "released", { released_by: o.releasedBy, released_reason: reason }))) throw new ApiError(409, "changed", "This attempt changed in the meantime. Reload and check again.");
  await c.audit("payment.attempt_release", "payment_attempt", a.id, { reference: a.reference, reason: o.reason, paystack, confirmedWithPaystack: o.confirmedWithPaystack,
    releasedBy: o.releasedBy, approvedBy: o.approvedBy ?? null, approvalRequest: o.approvalRequest ?? null });
  return repo.getAttempt(a.id);
}

// Stage E.2: an APPROVED release, planned as statements that commit only inside the approval's fenced batch. Every
// check above runs first (Paystack is asked first; a successful payment is recorded and never released).
export async function planRelease(c: Ctx, attemptId: string, o: { reason: string; confirmedWithPaystack: boolean; releasedBy: string; approvedBy: string; approvalRequest: string; claimId: string }) {
  const { repo, attempt: a, paystack } = await checkReleasable(c, attemptId, o.confirmedWithPaystack);
  const at = new Date().toISOString();
  const reason = `${o.reason} (approval ${o.approvalRequest})`;
  return {
    stmts: [
      repo.releaseStmt(a.id, o.releasedBy, reason, at),
      auditStmt(c.db, { actor_id: c.user.id, action: "payment.attempt_release", target_type: "payment_attempt", target_id: a.id, ip_hash: c.ipHash,
        detail: { reference: a.reference, reason: o.reason, paystack, confirmedWithPaystack: o.confirmedWithPaystack, releasedBy: o.releasedBy, approvedBy: o.approvedBy,
          approvalRequest: o.approvalRequest, claim: o.claimId } }),
    ],
    // The batch commits only if THIS run moved the attempt to released (not a release made by anyone else).
    effect: { sql: "SELECT 1 FROM payment_attempts WHERE id = ?2 AND state = 'released' AND released_reason = ?3 AND updated_at = ?4", binds: [a.id, reason, at] },
    result: "payment attempt released",
    // Stage E.3: checkReleasable again at commit time (the Paystack verification above stays read-only and before it).
    conditions: releaseConditions({ attemptId: a.id, requesterId: o.releasedBy, claimedBefore: new Date(Date.now() - CLAIM_TTL_MS).toISOString() }),
  };
}
