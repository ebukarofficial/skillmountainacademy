# Expansion Stage E.1: invitation acceptance atomicity and approval execution integrity

**Status:** implemented locally for Owner review. Nothing was deployed, migrated in production, emailed for real or paid.
**Date:** 28 November 2026.
**Boundaries kept:**

- No change to the Owner identity or bootstrap.
- No new permission for department heads or Super Administrators, and no group widened.
- No approval policy or payment release activated, and no change to who may release.
- No departments seeded and no staff appointed.
- No invitations or emails sent.
- No change to payment, tuition, FX or country rules.
- Every Owner decision from Stage E is still open.

---

## 1. Root cause and correction

### Issue 1: an invitation could be consumed without its account

**Root cause.** In Stage E the acceptance route ran several separate statements:

1. moved the invitation from `pending` to `accepted`;
2. created the user;
3. set the group;
4. created the department assignment;
5. wrote the audit entries.

A failure after step 1 left an accepted invitation with no account. The person had no way to recover, because a used link is refused.

**Correction.** Acceptance is now **one D1 batch**. D1 runs a batch as a single SQL transaction: every statement succeeds or the whole batch rolls back. The batch is built by `acceptInvitationAtomic()` in `src/server/lms/data/institution.ts`:

1. `UPDATE staff_invitations SET status = 'accepted', accepted_user_id = :newId … WHERE id = :id AND status = 'pending' AND expires_at > :now`. This is the single-use claim, and it re-checks expiry inside the transaction.
2. Each later statement runs only if `EXISTS (… WHERE id = :id AND status = 'accepted' AND accepted_user_id = :newId)`, that is, only if *this* request's claim is the one recorded. Those statements are:
   - `INSERT INTO users …` with exactly the invited email, role, group, staff number and candidate status;
   - `INSERT INTO staff_assignments …` (only when the invitation names a department);
   - the `invite.accepted` and `staff.joined` audit entries.

If any statement fails, nothing is kept and the invitation stays `pending`. Failures include: the email already has an account, a constraint, or a database error. The person gets `503 try_again` ("your invitation is still valid"), and the failure goes to the error log without the token. A concurrent second request finds the invitation no longer pending, so its update changes nothing and its inserts do not run. It gets the ordinary invalid-link answer.

### Issue 2: "approved" could hide an action that failed

**Root cause.** `approval_requests` had a single `status`, which records the decision, plus free-text `executed_at` and `execution_result` fields. The route set `approved` and then ran the action. If the action failed, the request still read "approved". There was no claim to stop two runs, and no way to tell an interrupted run from a finished one.

**Correction.** The decision and the action now have separate states, plus an atomic claim (migration `0016_approval_execution.sql`; see section 4).

## 2. Transaction and recovery strategy

| Operation | Mechanism |
|---|---|
| Invitation acceptance | One D1 batch (transaction) with a compare-and-set claim, and conditional inserts tied to that claim. |
| Session after acceptance | Outside the transaction, on purpose. If it fails, the account is already complete and valid; the response says "sign in from your staff entrance", and `invite.session_failed` is audited. The existing email-link sign-in works at once (test E1.4). |
| Approval decision | Compare-and-set `pending → approved` (or rejected), which also sets `execution_status = 'awaiting_execution'`. The decision is never changed by what happens to the action. |
| Running the action | Atomic claim: `UPDATE … SET execution_status = 'executing', execution_claimed_at = :now, execution_attempts = +1 WHERE status = 'approved' AND execution_status = 'awaiting_execution'` (a recovery may also claim `failed`, or `executing` older than two minutes). Exactly one caller wins. The outcome is written only if `execution_claimed_at` still equals that run's own claim, so a superseded run cannot overwrite a newer one. |
| Recovery | `POST /api/app/admin/approvals/:id/execute`. An explicit action by an eligible approver, never automatic. Section 4 lists what it re-checks. |

## 3. Invitation acceptance: failure behaviour

| Situation | Result | Invitation | Account |
|---|---|---|---|
| Failure while creating the account | 503 `try_again` | still `pending` | none; retry works |
| Failure while persisting the acceptance | 503 `try_again` | still `pending` | none |
| Failure while creating the department assignment | 503 `try_again` | still `pending` | none (no account without its department) |
| Email gained an account in the meantime | 409 `exists` | still `pending` | the existing one, unchanged |
| Expired, including expiry between the checks and the claim | 400 `invalid_invitation` | expired | none |
| Revoked or declined | 400 `invalid_invitation` | unchanged | none |
| Repeated acceptance after success | 200 `{accepted: true, signedIn: false, alreadyAccepted: true}`, with no cookie | accepted | the same single account; no second session |
| Concurrent acceptances | one 200 with a session; the rest are 400 or "already accepted" | accepted once | exactly one account, one assignment and one audit entry |
| Session cannot be started | 200 `{accepted: true, signedIn: false}` | accepted | valid; the person signs in through the usual email link |

Unchanged:

- Only the hash of the token is stored. The raw token never appears in a response, the audit log or the error log (tests E1.1 and Stage E test 6).
- Rate limiting applies to every acceptance request, including repeated ones.
- Invited instructors still start as candidates (`application_received`) and go through Recruitment.

Behaviour change to note: Stage E answered a repeated acceptance with `400 invalid_invitation`. It now answers "already accepted, please sign in", with no account and no session created. The link still cannot be used to preview, decline or sign in again.

## 4. Approval decision versus execution

| Decision status (`status`, unchanged) | Execution status (`execution_status`, new) |
|---|---|
| `pending` | `not_applicable` |
| `approved` | `awaiting_execution` → `executing` → `completed` or `failed` |
| `rejected`, `cancelled`, `expired` | `not_applicable`, forever (the claim requires `status = 'approved'`) |

- **The approver's decision is preserved** whatever happens next: `decided_by`, `decided_at` and `decision_comment` are never touched by execution.
- **A request is "completed" only when its action succeeded.** `executed_at` is set only on completion.
- **Failures are visible.**
  - The list and detail views show "Approved: action NOT carried out", the reason, and the number of runs.
  - The *Carry out again* button appears only for someone eligible to approve the request.
  - The audit trail has `approval.execution_started`, `executed`, `execution_failed`, `execution_reconciled`, `recovery_requested`, `recovery_refused` and `execution_superseded`.
- **Two kinds of failure:**
  - A *definite refusal* (a rule refused before anything changed) is recorded as `refused, nothing changed (…)`.
  - An *unexpected error* (for example, a database failure part-way) is recorded as `outcome uncertain (…); check before recovering`. It is **never retried automatically** (test E1.12).
- **Recovery re-validates everything, every time:**
  1. The approver must still be eligible. A Super Administrator who lost the group can no longer even see the request (test E1.14).
  2. The owner's policy rule must still be on (`policy_withdrawn` otherwise).
  3. The requester's authority is checked again by the executor.
  4. The target's current state is checked: before running, each category asks whether the change **already took effect**. Examples: the group is already the requested one; the account is already active; the person is already head; the payment attempt is already released. If so, the request is marked `completed` with "already in effect: no change made" and nothing is applied twice (test E1.11).

  For payment release, the executor also re-runs every Stage D.1.1 check.
- **Interrupted runs:**
  - A run claimed less than two minutes ago is treated as in progress (`execution_in_progress`).
  - After that, an eligible approver may recover it, starting with the already-in-effect check.
  - A decision whose action never started (`awaiting_execution`) can be recovered at any time.
- **Owner direct actions are distinguishable.** When the owner changes access directly, `staff.access_changed` carries `authority: "owner_direct"`. A change through an approved request carries `authority: "approval"` with `approvalRequest`, `requestedBy` and `approvedBy`. Delegated direct changes are marked `group`, and a head appointment as `owner_direct` or `delegated`.

## 5. Duplicate-execution prevention

- The atomic claim (compare-and-set on `execution_status` and `status`) lets only one caller run an action at a time (test E1.10: three simultaneous recoveries, exactly one change).
- Outcomes are recorded only by the run that still holds the claim (`execution_claimed_at` token).
- A completed request cannot be claimed again (`already_completed`), and a decided request cannot be decided again (`decided`).
- The already-in-effect check stops a recovery from repeating a change that an interrupted or uncertain run did make.
- The one-pending-request-per-target index from Stage E stays.

## 6. Files created and modified

**Created**

- `migrations/0016_approval_execution.sql`
- `tests/stageE1-integrity.test.ts`: 16 tests
- `docs/EXPANSION_STAGE_E1_REPORT.md`

**Modified**

- `src/server/lms/data/institution.ts`: `acceptInvitationAtomic` (one batch), `approveRequest`, `claimExecution`, `finishExecution`; the `ApprovalRequest` type gains execution fields; `recordExecution` removed.
- `src/server/lms/institution.ts`:
  - `executeApproved` (claim, already-in-effect check, run, record);
  - per-category `alreadyApplied` checks;
  - `authority` markers on executor and head-appointment audits.
- `src/server/lms/routes/institution.ts`:
  - atomic acceptance with rollback handling;
  - repeated-acceptance answer;
  - session failure handled;
  - decision route uses the new model;
  - new recovery route `POST /api/app/admin/approvals/:id/execute`;
  - `canRecover` in the list.
- `src/server/lms/routes/users.ts`: `authority: "owner_direct" | "group"` on `staff.access_changed`.
- `src/server/lms/permissions.ts`: one table entry for the recovery route (area `any`; the handler checks approver eligibility). No group gained an area.
- `app/app/institution-admin.tsx`: execution status shown apart from the decision, and the *Carry out again* button for eligible approvers.
- Migration tooling for 0016: `src/server/schema-version.ts`, `db/schema.expected.json` (51 tables, 46 indexes), `db/migration-reviews.json` (review of the two backfill UPDATEs), `scripts/db/rollback.mts` (check `approval_executions_open`), `scripts/db/anonymise.mts`.
- `docs/lms/API.md`: regenerated.
- Tests updated, none weakened:
  - `stageB-catalogue`, `stageD-pricing`, `stageD1-integrity`, `db-preflight`, `db-recovery`, `db-gate`, `stage3b-gates` and `stage3c-staging`: migration lists, the new rollback fact, and future placeholders `0016` → `0017`.
  - `stageE-institution`:
    - test 6 now expects "already accepted" (no account, no session) for a repeated acceptance;
    - test 11 expects the `approval.execution_started` entry in the history.

## 7. Migrations and rollback considerations

**Why a migration is needed.** The 0015 schema cannot tell "approved, action done" from "approved, action failed or interrupted", except through free text. It also has no column to claim a run atomically. Overloading `status` would lose the approver's decision, and parsing `execution_result` would not be safe for compare-and-set.

**`0016_approval_execution.sql`** (additive):

- adds `execution_status` (NOT NULL, default `not_applicable`, CHECK on the five values), `execution_claimed_at`, `execution_claimed_by` and `execution_attempts`;
- adds a partial index on open executions;
- runs two reviewed UPDATEs that touch only approved requests from 0015: `executed_at` set becomes `completed`, otherwise `failed`. 0015 was never applied in production, so production has no such rows.

The invitation correction needs **no** schema change; the D1 batch is enough.

**Rollback.**

- `0016` is classed `olderWorker: "check"`, with check `approval_executions_open`. It counts approved requests that are awaiting, executing or failed.
- An older Worker ignores the new columns. It would show those requests as simply "approved" and could not recover them.
- Before rolling back below 0016, recover or close them.
- The columns can stay in place after a code rollback.
- Before any production use (not done, not authorised): apply 0010–0015 first, take a fresh backup, run a restore rehearsal on staging, and run `db:check` and the preflight.

## 8. Tests and exact results

**Full suite**, run in two halves to fit the time limit, after the last code change:

| Run | Tests | Pass | Fail |
|---|---|---|---|
| Half 1 (20 files) | 155 | 155 | 0 |
| Half 2 (21 files, including `stageE-institution` and `stageE1-integrity`) | 247 | 246 | 1 |
| **Total** | **402** | **401** | **1** |

The single failure is the **pre-existing** "3B.1: staging configuration … account_id is not pinned" (`tests/stage3b-gates.test.ts`). It is kept visible and has not been weakened. At the end of Stage E the result was 385 of 386; Stage E.1 adds 16 tests, and all of them pass.

**New tests:** `tests/stageE1-integrity.test.ts` has 16 tests. Failures are injected with temporary SQLite triggers in the isolated test database.

*Invitations (brief list)*

| Test | Covers |
|---|---|
| E1.1 | failure during account creation |
| E1.2 | failure during acceptance persistence, and during the assignment insert |
| E1.3 | repeated acceptance |
| E1.4 | account created, then the session fails, then normal sign-in works |
| E1.5 | expired invitations, including expiry inside the claim; revoked and declined invitations |
| E1.6 | six concurrent acceptances |

*Approvals (brief list)*

| Test | Covers |
|---|---|
| E1.7 | success |
| E1.8 | approval followed by execution failure, and the display |
| E1.9 | recovery after failure, and no second run |
| E1.10 | concurrent recovery requests |
| E1.11 | interrupted execution, both fresh and stale, and already in effect |
| E1.12 | uncertain failure with no automatic retry |
| E1.13 | policy withdrawn before execution |
| E1.14 | approver or requester permission change before recovery |
| E1.15 | rejected, expired and cancelled requests, including tampered rows |
| E1.16 | audit history and the owner-direct marker |

Duplicate-execution prevention is covered by E1.9, E1.10 and E1.11.

**Other checks**

| Check | Result |
|---|---|
| TypeScript (both configurations) | pass |
| ESLint | pass |
| `npm run db:check` | PASS (16 migration files) |
| `npm run docs:api` | regenerated |
| `npm run build` | pass |
| Built site compared with the pre-Stage-B baseline | 0 pages with different visible text (32 pages, as in Stage E) |
| CSP check | pass |
| Secret scan | pass |
| `npm audit` | 0 vulnerabilities |
| Worker bundle | 346.5 KiB minified, within the Stage E budget of 360 KiB; the budget was not changed |

## 9. Remaining limitations and Owner decisions

- **An uncertain outcome still needs a person.** The system records it and refuses to retry automatically. Recovery first checks whether the change took effect, but deciding to recover is an approver's action.
- **The already-in-effect check looks at the current state.** If the same change was made by other means (for example, the owner acted directly), the request is marked completed with "already in effect: no change made".
- **The two-minute window** before an interrupted run can be recovered is a fixed engineering value (`EXECUTION_STALE_MS`).
- **A recovered request can still fail again.** For example, it fails if the requester has lost authority (test E1.14). The request then stays failed and visible. Closing such a request without carrying it out (a "close as not done" action) is not implemented and is proposed as **Owner decision D-E13**.
- **Session start stays outside the acceptance transaction**, as the brief allows. Its failure leaves a valid account and the usual sign-in path.
- **Stage E Owner decisions D-E1 to D-E12 are unchanged and unresolved.** No approval rule, department, appointment or payment-release authorisation has been activated.

## 10. Confirmation

- No deployment, no production migration, and no change to production D1, KV or R2 data, DNS, domains, secrets, environment variables or authentication settings.
- No real invitation and no real or bulk email: every email in the tests went to the local mock.
- No payment made or initiated, and Paystack not activated (mocked in tests).
- No approval policy, payment release, department or appointment activated in any real database. Policies and failures in the tests were fixtures in isolated test databases, and failures were injected with temporary SQLite triggers there.
- `app/globals.css`, logos and icons were not edited.

**Stopped after Stage E.1. Stage F not begun.**
