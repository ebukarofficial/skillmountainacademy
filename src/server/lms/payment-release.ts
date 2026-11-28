// Releasing an uncertain Paystack checkout attempt (Stage D.1.1 reconciliation, gated in Stage E, fail-closed in E.4).
// The safety checks live here so the direct route and an approved request run exactly the same checks, at the moment
// the release actually happens. A release is never a retry: it only lets the student open a new checkout themselves.
// Stage E.4: D1 cannot lock Paystack, so a release needs DEFINITE evidence: Paystack's answer for this reference, amount
// and currency is 'failed' or 'abandoned', stored against the attempt version this worker read, at most 10 minutes old,
// and the same definite answer was already given at least 30 minutes earlier. Unknown, pending or unreadable answers
// keep the attempt on hold. Migration 0018's triggers enforce the same at commit, for every code path.
import { ApiError } from "../http";
import type { Ctx } from "./api";
import { Repo, type InstalmentRow, type PaymentAttempt } from "../repo";
import { auditStmt } from "./data/users";
import { releaseConditions } from "./policy-sql";
import { CLAIM_TTL_MS, verifyWithPaystack } from "../routes/payments";

export const SETTLE_MS = 30 * 60_000;
const DEFINITE = ["failed", "abandoned"];

// Asks Paystack about the attempt. A success is recorded (idempotently); anything else is stored as evidence against
// the version read (null evidence: the attempt changed meanwhile, so the answer is discarded, never applied late).
export async function verifyAttempt(c: Ctx, repo: Repo, a: PaymentAttempt, inst: InstalmentRow | null) {
  const v = await verifyWithPaystack(c.env, repo, c.exec, a.reference);
  if (v.known && v.status === "success") return { v, status: "success", e: null };
  const status = !v.known ? "unknown" : v.amount === inst?.amount_kobo && v.currency === "NGN" ? v.status! : "mismatch";
  return { v, status, e: await repo.evidence(a.id, a.version, status, new Date().toISOString()) };
}

// Every check short of the release itself. Paystack is asked first; a payment it reports as successful is recorded
// through the existing idempotent path and never released.
export async function attemptOr404(repo: Repo, id: string) {
  const a = await repo.getAttempt(id);
  if (!a) throw new ApiError(404, "not_found", "That payment attempt was not found.");
  return a;
}
export async function checkReleasable(c: Ctx, attemptId: string) {
  const repo = new Repo(c.db);
  const a = await attemptOr404(repo, attemptId);
  if (a.state === "claimed" && Date.now() - Date.parse(a.claimed_at) <= CLAIM_TTL_MS) throw new ApiError(409, "in_progress", "This attempt is still in progress. Wait a few minutes before checking it.");
  if (!["uncertain", "claimed"].includes(a.state) || a.outcome) throw new ApiError(409, "not_uncertain", `This attempt is ${a.outcome ?? a.state}; only an uncertain attempt can be released.`);
  const inst = await repo.getInstalment(a.instalment_id);
  if (inst?.status === "paid") throw new ApiError(409, "paid", "This part is already paid. Nothing to release.");
  const { v, status, e } = await verifyAttempt(c, repo, a, inst);
  if (status === "success") throw new ApiError(409, "paid_at_paystack", "Paystack reports this payment as successful. It has been recorded (or flagged for reconciliation); the attempt is not released.");
  if (!e) throw new ApiError(409, "changed", "This attempt changed in the meantime. Reload and check again.");
  if (!DEFINITE.includes(status)) throw new ApiError(409, "payment_unresolved", `Paystack has not confirmed ${a.reference} as unpaid (${status}). It stays on hold.`);
  const ready = Date.parse(e.first_verified_at!) + SETTLE_MS;
  if (ready > Date.parse(e.verified_at!)) throw new ApiError(409, "payment_settling", `Paystack reports ${status}. Check again after ${new Date(ready).toISOString().slice(11, 16)} UTC.`);
  return { repo, attempt: e, paystack: v };
}

export async function releaseAttempt(c: Ctx, attemptId: string, o: { reason: string; releasedBy: string }) {
  const { repo, attempt: a, paystack } = await checkReleasable(c, attemptId);
  const r = await repo.releaseStmt(a.id, o.releasedBy, o.reason, new Date().toISOString(), a.version).run().catch(() => null);
  if (!r?.meta.changes) throw new ApiError(409, "changed", "This attempt changed in the meantime. Reload and check again.");
  await c.audit("payment.attempt_release", "payment_attempt", a.id, { reference: a.reference, reason: o.reason, paystack, evidence: a.first_verified_at, releasedBy: o.releasedBy });
  return repo.getAttempt(a.id);
}

// Stage E.2: an APPROVED release, planned as statements that commit only inside the approval's fenced batch. Every
// check above runs first (Paystack is asked first; a successful payment is recorded and never released).
export async function planRelease(c: Ctx, attemptId: string, o: { reason: string; releasedBy: string; approvedBy: string; approvalRequest: string; claimId: string }) {
  const { repo, attempt: a, paystack } = await checkReleasable(c, attemptId);
  const at = new Date().toISOString();
  const reason = `${o.reason} (approval ${o.approvalRequest})`;
  return {
    stmts: [
      repo.releaseStmt(a.id, o.releasedBy, reason, at, a.version),
      auditStmt(c.db, { actor_id: c.user.id, action: "payment.attempt_release", target_type: "payment_attempt", target_id: a.id, ip_hash: c.ipHash,
        detail: { reference: a.reference, reason: o.reason, paystack, evidence: a.first_verified_at, releasedBy: o.releasedBy, approvedBy: o.approvedBy, approvalRequest: o.approvalRequest, claim: o.claimId } }),
    ],
    // The batch commits only if THIS run moved the attempt to released (not a release made by anyone else).
    effect: { sql: "SELECT 1 FROM payment_attempts WHERE id = ?2 AND state = 'released' AND released_reason = ?3 AND updated_at = ?4", binds: [a.id, reason, at] },
    result: "payment attempt released",
    // Stage E.3: checkReleasable again at commit time (the Paystack verification above stays read-only and before it).
    conditions: releaseConditions({ attemptId: a.id, requesterId: o.releasedBy, claimedBefore: new Date(Date.now() - CLAIM_TTL_MS).toISOString(), version: a.version }),
  };
}
