# Stage E.4: Paystack Payment-Release Race Hardening

Date: 28 November 2026
Scope: local development only.

Production was not touched:

- nothing was deployed;
- no production migration was run;
- no live Paystack endpoint was called;
- no email was sent.

All Paystack and email traffic in tests is mocked.

The file name follows the brief. The stage is E.4; it closes a race found during the Stage E.3 review.

**Outcome:** implemented locally.

- Full suite: **474 tests, 473 pass, 1 fail**. The one failure is the known, pre-existing "3B.1 staging configuration … account_id is not pinned" test. It is unchanged and still visible.
- 19 new adversarial tests are in `tests/stageE4-payment-race.test.ts`.
- Worker bundle: **368,526 bytes against 368,640**, leaving **114 bytes** of headroom. The budget was not raised.

---

## 1. Root cause and the original race

Before this stage, a release (D.1.1, gated in Stage E) ran these checks:

1. Ask Paystack about the attempt's reference.
2. If the answer was not "success", move the attempt `uncertain` → `released`.
3. Once released, the student could open a new checkout.

There were four weaknesses.

- **Any non-success answer counted as "unpaid".** This included "abandoned", "ongoing" and "pending". An unreadable or unknown answer also counted, as long as the officer ticked `confirmedWithPaystack`.
- **Nothing tied the Paystack answer to the database state it was judged against.** Consider this sequence:
  1. The executor gets "not paid".
  2. The customer pays.
  3. The webhook is late.
  4. The release commits, because D1 still says unpaid.

  The E.3 commit-time checks re-read only D1 (`instalment_unpaid`), and D1 had not heard about the payment yet.
- **A payment arriving later for a released (or failed) attempt was recorded silently.** It was recorded like any other payment. If the student had already opened attempt 2, both checkouts stayed payable and nothing flagged the duplicate.
- **`verifyWithPaystack`**, used by the order-status page, had no timeout. It could throw on a malformed answer.

A D1 transaction cannot lock or commit Paystack's state. That part of the race cannot be removed. What this stage does is:

- make the release fail closed whenever Paystack's answer is uncertain;
- tie every answer to the exact database version it was given for;
- stop a checkout from being reopened while anything is unresolved;
- make the remaining external risk detectable, recorded and blocking.

## 2. Existing payment state model (inspected in the current code)

**Tables:**
- `instalments.status`: `due`, `overdue` or `paid`.
- `orders.status`: `pending`, `part_paid`, `paid` or `cancelled`.
- `payments`: one row per `provider_ref` (UNIQUE), which is the idempotency key.
- `webhook_events`: Paystack event ids.
- `payment_attempts` (0014), with states:

| State | Meaning |
|---|---|
| `claimed` | A request owns the attempt and is calling Paystack. Treated as uncertain after 120 s. |
| `initialized` | A checkout exists and is reused by every retry. |
| `failed` | Paystack definitely refused the initialisation, so no transaction exists. |
| `uncertain` | The outcome of the initialisation is unknown. |
| `released` | Finance released an uncertain attempt. |

A partial unique index allows only one `claimed`, `initialized` or `uncertain` attempt per instalment.

**Every route that can create a checkout opportunity** goes through `initiatePayment()` (`src/server/routes/payments.ts`):

| Route | Path into `initiatePayment()` |
|---|---|
| `POST /api/register` (Paystack method) | via `beginPayment` |
| A retried registration (same idempotency key) | `replay` → `beginPayment` |
| `GET /api/pay?ref=…&t=…` | signed links for parts 2 and 3, emailed by the cron job (the cron itself only emails links) |

**Every route that can release an attempt:**
- `POST /api/app/admin/payments/attempts/:id/release`: direct release, or it opens an approval request.
- Approval execution: `POST /api/app/admin/approvals/:id/decision` (approve) and `POST /api/app/admin/approvals/:id/execute` (recovery). Both go through `planRelease` inside the Stage E.2 fenced batch.

**Every path that records a payment:**
- the signed webhook `POST /api/paystack/webhook`;
- `GET /api/order` (`verifyWithPaystack`);
- the Finance check and release routes;
- bank-transfer recording (`lms/data/reports.ts`).

All of them use `Repo.recordPayment` or the bank equivalent, each in one batch.

## 3. New and revised state transitions

Migration 0018 adds columns to `payment_attempts`. All are additive.

| Column | Purpose |
|---|---|
| `version` | Increases on **every** change. A trigger bumps it after any UPDATE that did not set it itself. |
| `verified_status`, `verified_at`, `verified_version` | Paystack's last answer, and the version it applies to. |
| `first_verified_at` | Start of an unbroken run of definite non-success answers. |
| `outcome` | `paid` or `reconcile`. Never removed or downgraded. |
| `resolved_by`, `resolved_reason` | For a person's review of a `reconcile` outcome. The columns exist; the review route is deferred (section 13). |

How the required states map onto the model:

| Required state | Representation |
|---|---|
| Confirmed unpaid | Instalment `due`/`overdue`, the attempt's evidence is definite (`failed`/`abandoned`), current, at most 10 min old and settled for 30 min or more. |
| Payment pending | Attempt `initialized` (a checkout is open). |
| Payment verification pending | Attempt `claimed`, or `uncertain` with no definite evidence. |
| Confirmed paid | `instalments.status = 'paid'` and `outcome = 'paid'`, set in the same transaction as the payment row. |
| Confirmed failed | Attempt `failed`: the initialisation was refused, so no Paystack transaction exists. |
| Unknown or unresolved provider outcome | `uncertain`, with `verified_status` of `unknown`, `mismatch`, `ongoing`, `reversed` and so on. |
| Reconciliation required | `outcome = 'reconcile'`. |

How Paystack's verify answer is classified (`verifyReference`, stricter than before):
- An answer is "known" only when it is HTTP 2xx, has `status: true` and has a `data.reference` **equal to the reference asked about** with a string status.
- Anything else is stored as `unknown`: a timeout, a network error, a 4xx or 5xx, non-JSON, another reference, or a missing status.
- A known answer with the wrong amount or currency is stored as `mismatch`.
- Only `failed` and `abandoned` with the right reference, amount and NGN currency are **definite**.

Transitions:

- **Evidence write:** `UPDATE … WHERE id = ? AND version = <version read> AND outcome IS NULL`.
  - It sets the evidence and `version = version + 1`.
  - A definite answer extends the run. Any other answer resets `first_verified_at` to NULL, so the 30 minutes start again.
- **Release:** `uncertain`/stale `claimed` → `released`, only `WHERE version = <the version this worker verified>`.
  - The trigger `payment_attempts_release_guard` also refuses it unless all of these hold:
    - there is no outcome;
    - `verified_version = version`;
    - the evidence is definite;
    - `verified_at` is at most 10 minutes old (D1 clock);
    - `first_verified_at` is at least 30 minutes before `verified_at`;
    - the part is unpaid;
    - no payment row exists for the reference or the instalment.
- **Payment recorded (Paystack):** the trigger `payments_attempt_outcome` sets the attempt's `outcome`, in the same statement as the payment insert.
  - It sets `reconcile` if the attempt was `released` or `failed`, if another payment exists for the part, or if the attempt was already `reconcile`.
  - Otherwise it sets `paid`.
- **Payment recorded (bank) for a part already paid by Paystack:** `payments_duplicate_bank` changes `paid` to `reconcile`.
- **Successful charge with the wrong amount, currency or instalment metadata:** the payment is still not recorded, as before. The attempt is now flagged `reconcile`.
- **New checkout attempt:** `payment_attempts_checkout_guard` refuses the insert (`checkout_blocked`) when the part is paid or any attempt for it has an unreviewed outcome.
- **Never:**
  - an outcome removed, or `reconcile` turned into `paid` (`payment_attempts_outcome_kept`);
  - a paid instalment made unpaid (`instalments_paid_kept`). No existing code path does this; checked with grep.

## 4. Exact safeguards implemented

1. **Unknown never means unpaid.** A timeout, HTTP error, malformed or ambiguous answer, wrong reference or wrong amount is stored as non-definite evidence and refuses the release (`payment_unresolved`). The officer's `confirmedWithPaystack` no longer overrides this. It is ignored. (Tests E4.3–E4.5.)
2. **Settled evidence.** A release needs the same definite answer twice, 30 minutes or more apart. The latest answer must be at most 10 minutes old. A first answer gives `payment_settling`, with the time to check again. (Test E4.1a.)
3. **Version-bound evidence.** An answer is stored only for the version that was read. A webhook, payment, check or state change in between discards it (`changed`), so a stale answer can never be applied late. (Tests E4.1b, E4.15.)
4. **Database-level enforcement.** Four refusal triggers (release, checkout, outcome, paid instalment) and three writing triggers (version, Paystack outcome, bank duplicate) enforce the rules for every code path, including an older Worker or a raw SQL statement. (Tests E4.6, E4.8, E4.16, E4.17.)
5. **Outcome in the same transaction as the payment.** Recording a payment is the only thing that sets `paid` or `reconcile`. It cannot be half-written: the batch rolls back as one. (Test E4.11–12.)
6. **No automatic retry and no second attempt from a failed verification.** Verification is read-only. The only way to a new attempt is a release that passes every check, followed by the student's own retry. (Tests E4.13, E4.18.)
7. **All transitions audited and idempotent.**
   - `payment.attempt_check` records who checked, the reason, the version, Paystack's answer, the evidence and whether it was stored.
   - `payment.attempt_release` records the evidence start time.
   - Payment recording stays idempotent by `provider_ref`. Repeating any step is harmless.
8. **The order-status verification** now has the 20 s timeout. It never throws for a Paystack failure, and it records only a confirmed success.

## 5. How checkout concurrency is controlled

- **One active attempt per instalment.** This is the existing 0014 partial unique index. The claim is a single INSERT, so of two simultaneous requests exactly one claims and calls Paystack. The other gets `payment_in_progress`, or reuses the stored checkout. (Test E4.10: two overlapping requests, one Paystack call, attempts `[1 released, 2 initialized]`.)
- **No new attempt for a paid or unreconciled part.** The new insert trigger enforces this even after the earlier attempt is no longer "active", for example a `released` attempt whose late payment needs review. `claimAttempt` maps the refusal to `payment_needs_check` with the existing "our team is checking" message. (Tests E4.2, E4.17.)
- **A stale claim** (older than 120 s) becomes `uncertain` through a compare-and-set from `claimed`. A late initialisation result can never overwrite it.

## 6. How webhook and reconciliation races are handled

| Race | Handling |
|---|---|
| Webhook arrives while an approved release is running | The payment insert sets the outcome and moves the version. The run's Paystack answer is then discarded (`changed`). If the payment lands inside the commit transaction itself, the commit-time condition `payment_evidence` and the release trigger roll the whole batch back. (E4.1b, E4.1c) |
| Payment succeeds right after an "unpaid" answer | The first answer cannot release (settling). The next check sees the success, records it and refuses the release. (E4.1a) |
| Delayed webhook after a release committed (irreducible) | The payment is recorded, never dropped. The released attempt becomes `reconcile`. No further checkout can open. If the student also pays the second open checkout, that payment is recorded and flagged too. (E4.2) |
| Duplicate successful webhooks (concurrent, or with different event ids) | One payment row, one `recorded` result, and no emails for the duplicates. (E4.7) |
| Out-of-order failed event after a success | Ignored. A later "failed" verification is not stored over the outcome. Triggers refuse any downgrade. (E4.8) |
| Worker crash or D1 failure after Paystack success | The webhook batch rolls back completely (500, so Paystack retries). The stale claim becomes `uncertain`. Recovery sees the success, records it once, and the attempt is never released. The retried webhook converges. (E4.11–12) |
| Recovery while the outcome is still unknown | Audited. Stored as `unknown`. The attempt stays on hold, with no new attempt and no Paystack initialise call. (E4.13) |
| Recovery after an authoritative success | Recorded once. The attempt is closed as `paid`. Release and checkout are refused. (E4.14) |
| Approval executor recovered after a timeout | The E.2 fencing is unchanged. The recovered run re-verifies, writes new version-bound evidence and commits only through the fenced batch. A superseded run commits nothing. (E2.4, E2.5) |

## 7. Approval-release integration

`planRelease`, inside the E.2 fenced batch, now does the following:

- It reruns `checkReleasable`:
  - fresh Paystack verification;
  - the evidence write against the version read;
  - the definite and settled rules.
- It plans `releaseStmt` bound to that version.
- It adds a commit-time condition, `payment_evidence`, to the E.3 conditions. The condition requires the attempt version to be unchanged and the outcome to be NULL. The release trigger enforces freshness and settling in the same transaction.

Unchanged:

- requester and approver authorisation (the E.3 `requester_authority`, approver and policy conditions);
- `attempt_releasable` and `instalment_unpaid`;
- the unique execution claims and fences;
- the effect check;
- the rule that a release only lets the student open checkout; it starts no payment (E4.18 asserts no initialise call).

A refusal records an `approval.execution_failed` audit, with the reason code (`payment_unresolved`, `payment_settling`, `changed`, `paid_at_paystack`, `commit_refused:…` or `target_changed`).

The request step (`requiresApproval`) runs the same checks before a request can be stored.

## 8. Migrations

**`migrations/0018_payment_reconciliation.sql`** (new, sequential, additive):
- 8 nullable or defaulted columns on `payment_attempts`;
- 1 index;
- 7 triggers.

No existing row changes value. The test E4.migration applies 0018 in place over a 0017 database that holds a real order, attempt, payment and webhook event. It asserts every historical value is byte-identical afterwards, and that existing attempts start with no evidence (fail closed).

| Item | Status |
|---|---|
| Local tests | Applied in every test database. |
| `db/schema.expected.json` | Regenerated: 52 tables, 48 indexes, 11 triggers. |
| `EXPECTED_MIGRATION` | Set to `0018_payment_reconciliation.sql`. |
| `db/migration-reviews.json` | Review recorded (the trigger bodies write only the new columns). `db:check` passes on 18 files. |
| Rollback/compatibility entry (`scripts/db/rollback.mts`) | An older Worker on a 0018 database is fail-closed: the triggers refuse its releases. Check `payments_need_reconciliation` requires reviewing flagged attempts before rolling back below 0018. |
| Anonymiser | Covers the new columns. `resolved_by` is cleared. |
| Production and staging | **Not applied.** |

## 9. Adversarial tests and persisted-state results

All tests are in `tests/stageE4-payment-race.test.ts` and all pass. Each asserts rows in D1 (attempt state, version, evidence and outcome; instalment status; payment rows; webhook events; fences; audit rows), not just responses.

| # | Test | Persisted result |
|---|---|---|
| 1 | Payment succeeds after "unpaid", before commit (settling / paused run plus webhook / payment inside the commit) | Attempt `uncertain`, outcome `paid`, part `paid`, 1 payment, 0 fences, 0 release audits. In-commit case: everything rolled back; version moved only by the run's own evidence write. |
| 2 | Webhook delayed past the release | Attempt 1 `released`, outcome `reconcile`, part `paid`. A third attempt insert is refused (`checkout_blocked`). A second payment is recorded and attempt 2 is flagged `reconcile`. |
| 3 | Verify timeout | `uncertain`, evidence `unknown`, `first_verified_at` NULL, which breaks a 30-minute run. The next definite answer must settle again. |
| 4 | HTTP 5xx | Same as 3. |
| 5 | Malformed or ambiguous answers (8 variants) | Stored as `unknown`, `ongoing`, `reversed` or `mismatch`. Never released. No payment rows. |
| 6 | Stale evidence, raw SQL | Trigger refuses: 11-minute-old evidence, evidence for an older version, and `unknown`. It accepts only fresh, current, settled, unpaid evidence. |
| 7 | Duplicate webhooks | 1 payment, 1 `recorded` result, no extra emails. |
| 8 | Failed event after success | Outcome `paid`, version unchanged, 1 payment. Downgrades of the instalment or the outcome are refused by triggers. |
| 9 | Two releases at once | One 200, one 409. One release audit. |
| 10 | Two checkouts at once | One Paystack initialise call. Attempts `[1 released, 2 initialized]`. |
| 11–12 | Crash after success, and D1 failure | Nothing half-written. Recovery records one payment. Never released. The retried webhook converges. |
| 13 | Recovery while unknown | 2 audited checks (actor, reason, evidence `unknown`). No new attempt. No initialise call. |
| 14 | Recovery after success | Outcome `paid`, 1 payment. Release and checkout refused. |
| 15 | Stale worker | A paused run's answer is discarded; the newer evidence stands. An old-version release changes 0 rows. |
| 16 | Confirmed payment never released | Refused by route and by trigger. A released attempt cannot be released twice (1 audit). |
| 17 | Unresolved attempt blocks checkout | 3 retries, 0 initialise calls. A duplicate insert hits UNIQUE. A wrong-amount charge flags `reconcile` and blocks new checkouts. |
| 18 | Resolved attempts follow the existing rules | Refused initialisation leads to attempt 2. A settled abandoned attempt leads to a release with no Paystack call, then one student checkout. |
| parity | `payment_evidence` condition | 1 at the current version; 0 for an older or newer version; 0 once an outcome exists. |
| migration | 0018 in place over 0017 data | Historical rows identical. New columns default to fail-closed values. 7 triggers present. |

Existing tests changed. Each change makes the rule stricter, and every original assertion is kept.

- **`stageD11-payments` (6):** previously "unknown + confirmation ⇒ release". Now asserts `payment_unresolved` with confirmation, then `payment_settling`, then a release only after a settled abandoned answer.
- **`stageE-institution` (17), `stageE2-fencing`, `stageE3-commit-authorization`:** the Paystack mock now gives a definite "abandoned" answer, and the attempt is settled with a fixture.
  - E2.12 now asserts that an unconfirmed reference blocks the request even with the officer's confirmation.
  - E3.8's two cases now stop earlier, at the version-bound evidence write (`changed`), instead of at commit. Nothing is committed either way.
- **Schema and tooling tests:** the pending-migration lists, the trigger lists and the rollback facts include 0018. The placeholder "future" migration names moved from 0018 to 0019.
- **Shared fixtures** are in `tests/worker-harness.ts`: `paystackAnswer` and `settled`.

## 10. Full test-suite results

`npm test`: **474 tests, 473 pass, 1 fail, 0 skipped.**

- The one failure is the known, pre-existing `tests/stage3b-gates.test.ts:312` ("3B.1 staging configuration … account_id is not pinned"). It is kept visible and not weakened.
- The previous baseline was 455 tests, 454 passing, plus that one failure.
- After the full run, a final 3-line change (no Paystack call without a key) was re-verified on every test file that exercises verification and order status: 110 tests, 109 pass, plus the known failure.

## 11. Static, build, database and security checks

| Check | Result |
|---|---|
| TypeScript (`tsc -p .` and `tsc -p src/tsconfig.json`) | Pass |
| ESLint (`npm run lint`) | Pass |
| Build (`npm run build`, including the CSP post-build) | Pass (31 pages) |
| `npm run db:check` | Pass (18 migration files; the existing owner-decision notes are unchanged) |
| `npm run db:schema` | Regenerated; the schema test passes |
| `npm run security:csp` | Pass (31 pages, report mode) |
| `npm run security:secrets` | Pass |
| `npm audit` | 0 vulnerabilities |
| `npm run docs:api` | `docs/lms/API.md` regenerated |

## 12. Bundle size

| | Bytes | KiB | Headroom to 368,640 |
|---|---|---|---|
| Before E.4 | 368,119 | 359.49 | 521 |
| After E.4 | **368,526** | **359.89** | **114** |
| gzip (after) | ≈110,405 | | |

The budget was not raised. To fit, I made these behaviour-neutral compactions:
- Collapsed line-break indentation inside multi-line SQL template strings in `src/server/repo.ts` and `src/server/lms/data/*.ts` (and `lms/routes/pricing.ts`). SQL ignores this whitespace.
- Removed release fields from `moveAttempt` that are now unused.
- Merged the duplicate Paystack verify fetch (`verifyWithPaystack` now reuses `verifyReference`).
- Shared the attempt lookup.

Most enforcement lives in migration triggers, which cost no bundle bytes.

**114 bytes is not enough for the next feature.** The budget decision D-UI6 (I recommend 400 KiB) now blocks further server work.

## 13. Remaining limitations and irreducible external-provider risks

**Implemented** means everything in sections 3–7. The following are **not** implemented, or cannot be.

- **Irreducible:** a customer can complete an old checkout after a release that met every rule. Paystack offers no documented way to cancel an initialised transaction, and "abandoned" or "failed" is not final for an open checkout page. The settling rule shrinks this window but cannot close it. When it happens:
  - the payment is recorded;
  - the attempt is flagged `reconcile`;
  - no further checkout opens.

  If the student pays both open pages, both payments are recorded and the second is flagged. **A refund is a manual Owner decision. Nothing is refunded automatically.**
- **Paystack documentation gaps.** Paystack does not document its answer for an unknown reference, so such attempts now stay on hold indefinitely. The officer override was removed. The student can pay by bank transfer.
- **Reconciliation review route deferred.** The `resolved_by` and `resolved_reason` columns, and the trigger that honours them, exist. There is no route yet to record an Owner's review of a `reconcile` outcome. Until there is, a flagged part cannot get a new online checkout; bank transfer still works. Deferred for bundle size and pending an Owner decision.
- **Clock.** The freshness and settling checks in the trigger use D1's clock; the JS messages use the Worker's. Skew is negligible.
- **Diagnostics.** When a change made inside the commit transaction causes the rollback, the explanation probe (run after the rollback) may say `target_changed` rather than naming the rule. Nothing is committed either way.
- **No admin UI changes.** The release and check routes are API-only today. The dashboard only counts attempts. New error codes reach the API caller with plain-language messages.
- **Paystack is still not activated in production.** 0010–0018 are local and staging only.

## 14. Owner decisions (unresolved)

| ID | Decision needed |
|---|---|
| **D-E4.1** | Confirm the settling window (30 min) and the freshness limit (10 min). |
| **D-E4.2** | Confirm that Paystack `failed` and `abandoned` (with matching reference, amount and NGN currency) are the only answers that may support a release. |
| **D-E4.3** | References Paystack cannot confirm now stay on hold, with no officer override. Approve this, or define a documented, Owner-only override. |
| **D-E4.4** | Policy and route for reviewing `reconcile` outcomes, including refunds of duplicate payments. Records only; no automatic money movement. |
| **D-E4.5** | Approve migration 0018 for staging. Production is separate and later. |
| **D-UI6** | Bundle budget; headroom is now 114 bytes. |

D-E1 to D-E13 and D-UI1 to D-UI6 remain open.

Stage F has not begun. Nothing was deployed, and no production migration was run.
