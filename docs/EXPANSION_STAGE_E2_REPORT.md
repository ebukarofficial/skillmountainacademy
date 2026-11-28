# Expansion Stage E.2: approval execution fencing and stale-worker safety

**Status:** implemented locally for Owner review. Nothing was deployed, migrated in production, emailed for real or paid.
**Date:** 28 November 2026.
**Boundaries kept:**

- No change to the Owner identity or bootstrap.
- No permission group widened or narrowed, and no approval power for department heads.
- No approval policy or payment release activated, and no departments or appointments.
- No invitations or emails sent.
- No change to tuition, FX, currency, registration or payment-provider rules.
- D-E1 to D-E13 are unresolved.

---

## 1. Root cause and technical explanation

Stage E.1 claimed a run atomically and wrote the final status only if `execution_claimed_at` still matched. The action itself, however, was a series of **separate** writes made by the executor, *before* that final check. For a group change, for example:

1. `UPDATE users SET admin_role`
2. `DELETE FROM auth_sessions`
3. the audit insert

Suppose a run paused (a slow Worker, or one stuck on a Paystack call). After two minutes an explicit recovery could reclaim it. If the first run then resumed, it could still make every one of those writes. Only its final status write would be refused. The claim protected the *record* of the outcome, not the *action*. A timestamp was also a weak identity for a claim: two claims in the same millisecond would share it.

Inventory of the actions (as inspected):

| Category | Writes in Stage E.1 | External or irreversible effect |
|---|---|---|
| `staff_group_change` | 3 independent writes: group, sessions, audit | none |
| `staff_reinstatement` | 2: status, audit | none |
| `department_head_appointment` | up to 5: end current head, its audit, end own membership, create headship, its audit | none |
| `payment_attempt_release` | 2: attempt state, audit. Before them, a **read-only** Paystack verification; if Paystack reports success, the payment is recorded through the existing idempotent path and the release is refused. | Paystack verify is a read; recording a confirmed payment is idempotent (keyed by reference). Nothing is charged or initiated. |

Every action is entirely backed by the D1 database. None sends email, charges or calls a writing external API.

## 2. Files inspected and changed

**Inspected:**

- `claimExecution`, `finishExecution` and `executeApproved`;
- all four executors and `appointHead`;
- `payment-release.ts` (checks and release);
- the decision route and the recovery route;
- `repo.moveAttempt`;
- every audit write in these paths;
- migration `0016_approval_execution.sql`.

**Created**

- `migrations/0017_execution_fencing.sql`
- `tests/stageE2-fencing.test.ts`: 12 tests
- `docs/EXPANSION_STAGE_E2_REPORT.md`

**Modified**

- `src/server/lms/institution.ts`:
  - executors now *check and plan* (they return statements and do not write);
  - `executeApproved` is rewritten around the fenced commit;
  - `planHead` builds the head appointment as one statement list, and `appointHead` (direct) runs it as one batch.
- `src/server/lms/data/institution.ts`:
  - `claimExecution` issues a random claim id;
  - added `fenceStmt`, `effectStmt`, `completeStmt`, `fenceFor`, `fencesFor` and `recordOutcome` (claim-guarded outcome and audit, in one batch);
  - added assignment statement builders;
  - `finishExecution` removed.
- `src/server/lms/data/users.ts`: `auditStmt`, `setAdminRoleStmt`, `deleteUserSessionsStmt` and `reinstateStmt` (statement forms).
- `src/server/lms/payment-release.ts`: `planRelease`, the approved-release plan. The direct path `releaseAttempt` is unchanged.
- `src/server/repo.ts`: `releaseStmt`.
- Migration tooling for 0017: `src/server/schema-version.ts`, `db/schema.expected.json` (52 tables, 47 indexes), `scripts/db/rollback.mts`, `scripts/db/classification.mts`, `scripts/db/anonymise.mts`.
- `docs/lms/API.md`: regenerated.
- Tests updated, none weakened:
  - Migration lists, rollback facts and future placeholders (`0017` → `0018`) in `stageB-catalogue`, `stageD-pricing`, `stageD1-integrity`, `db-preflight`, `db-recovery`, `db-gate`, `stage3b-gates` and `stage3c-staging`.
  - `stageE1-integrity` E1.12: an injected database failure inside the action is now **known** to have rolled back (no fence row), so it is recorded as `failed, nothing committed` rather than "outcome uncertain". The test now also checks that no fence row exists and that the target is unchanged.

## 3. Fencing strategy

1. **A fencing token per run.** Every claim writes a new random `execution_claim_id` (migration 0017). Reclaiming replaces it, so the earlier run's token is dead from that moment. The timestamp is kept for the stale threshold only, never as the claim's identity.
2. **Executors only read.** Each category checks every rule with the acting approver's *current* authority (and the requester's) and returns a **plan**:
   - the action's statements;
   - the audit records describing it;
   - an SQL condition that is true only when the action's intended result is in place.
3. **One transaction commits the whole action.** `executeApproved` runs one D1 batch, which D1 executes as a single SQL transaction:
   1. **Fence:** `INSERT INTO execution_fences … owner_check = CASE WHEN <this claim id is current and the request is approved and executing> THEN 'current' ELSE NULL END`. `owner_check` is NOT NULL, so a superseded run makes the statement fail and **the whole batch rolls back**. The primary key on `claim_id` means a run can commit at most once.
   2. The action's statements: the group, sessions, status, assignments or attempt.
   3. The action's audit records.
   4. **Effect check:** `UPDATE execution_fences SET effect_check = CASE WHEN EXISTS(<intended result>) THEN 'confirmed' ELSE NULL END`. This rolls everything back if the action did not take effect as planned, for example if the payment attempt was released by someone else in between, or a head was already appointed.
   5. The `approval.executed` audit record.
   6. `UPDATE approval_requests SET execution_status = 'completed' WHERE execution_claim_id = <this claim>`.

   The ownership check, every mutation, the audit records and the completion commit together or not at all. There is no window in which an old run can perform "several unprotected operations".
4. **Only the owning run records an outcome.** Non-commit outcomes are "completed without change" (reconciled) and "failed". They are written by `recordOutcome`, which inserts the audit entry and updates the status in one batch, both conditional on the claim still being current. A superseded run can overwrite neither the status, nor the result, nor the audit outcome. It only adds an informational `approval.execution_superseded` entry, which records that it committed nothing.
5. **Definite versus uncertain is preserved, and made more precise:**
   - A rule refusal is recorded as `refused, nothing changed`.
   - A batch that fails for any other reason has its fence row looked up:
     - no fence row means it rolled back: `failed, nothing committed`;
     - a fence row means it committed (for example, a response lost after commit): completed.
   - Only if even that lookup fails is the outcome left "executing" for reconciliation, with `approval.execution_uncertain` audited. Nothing is retried.

## 4. The two-minute recovery rule: kept, now safe

The question was whether the stale-claim mechanism can reclaim a run while the original may still be running. With the fence, the answer is yes, safely. Taking over writes a new claim id. From that moment, the original run's batch fails at its first statement and rolls back entirely, whenever it arrives. Its only possible effects before the commit are reads, plus (for payment release) the read-only Paystack verification and the idempotent recording of a payment Paystack confirms as successful. Neither is a release or a charge.

Safeguards around taking over:

- It is never automatic. It is always an explicit `POST /api/app/admin/approvals/:id/execute` by an eligible approver, with the authenticator code, after checking that the owner's rule is still on.
- A claim younger than two minutes is never taken over (`execution_in_progress`).
- **Reconciliation comes before any re-run:**
  1. If the previous run left a fence row, its action committed. The request is recorded as completed ("already committed by the previous run") and nothing is applied again, even if the target has changed since (test E2.7).
  2. Otherwise the already-in-effect check runs.
  3. Only then are the rules re-checked and a new fenced commit attempted.

Requests left in `executing` by 0016 (no claim id) have no fence row to consult. They fall back to the already-in-effect check, then the fenced run.

## 5. Per-category executor safety

| Category | Checks (unchanged) | Plan committed behind the fence | Effect condition |
|---|---|---|---|
| Group change | target exists; valid group; `groupChangeRefusal` for the requester **and** the approver | set group; end all sessions; `admin.group_assigned` audit with authority, requester, approver, claim and attempt | `users.admin_role` = requested group |
| Reinstatement | target suspended; `accountChangeRefusal` (not removed, Super only by owner) | `status = 'active' WHERE status = 'suspended' AND removed_at IS NULL`; `staff.reinstated` audit | active and not removed |
| Head appointment | department active; assignable; not already head; one-department policy | end current head; its audit; end own membership; create headship; its audit (all one transaction; previously separate) | the new headship row exists and is open |
| Payment release | every D.1.1 check: in progress, paid, verify first, confirmation | `state = 'released' WHERE state IN ('uncertain', 'claimed')`; `payment.attempt_release` audit | this run's release (its own reason and timestamp) is in place |

For every category:

- a completed action cannot be applied twice (completed requests cannot be claimed; a fence row blocks a re-run);
- a superseded run cannot apply it (fence);
- an uncertain action is reconciled before any re-run;
- the already-in-effect check precedes every legitimate run;
- the audit trail records the requester, approver, claim id, attempt and outcome, and never reports completion unless the fenced batch committed.

The direct head appointment (owner, or an authorised Super Administrator) now also commits as one batch.

## 6. Payment-release safety

Every Stage D.1.1 safeguard is unchanged:

- the durable D1 claim on checkout attempts;
- no automatic retries;
- the authenticator code;
- verify with Paystack first, and record a confirmed payment instead of releasing;
- explicit dashboard confirmation when Paystack cannot confirm;
- release only from `uncertain` or a stale `claimed`;
- never for a paid instalment;
- the full audit trail.

The Stage E gate is also unchanged: release is disabled until the Owner authorises groups and approval. A release never starts a payment (test E2.12 counts the Paystack initialize calls). Paystack behaviour is unchanged.

## 7. Adversarial tests and results

`tests/stageE2-fencing.test.ts`: **12 of 12 pass.** A superseding run is simulated in two ways:

- **(a)** A SQLite trigger replaces the claim id, exactly as a recovery's claim would, right after the old run claims. The old run then really goes on to check, plan and attempt its commit.
- **(b)** A real second request takes over while the first run is paused inside the Paystack call, and the first run is then resumed.

The assertions check the underlying data, the fence rows and the audit records, not only `execution_status`.

| # | Test | Brief items |
|---|---|---|
| E2.1 | Group change. The old run attempts its commit after being superseded. Group unchanged, target's live session **not** ended, no `admin.group_assigned`, no outcome, newer claim intact. The audit shows it was stopped at the commit. The newer run then commits exactly once and the fence row matches its claim. | 1, 4, 5, 11 |
| E2.2 | Reinstatement: the same, and the account stays suspended. | 1, 4, 11 |
| E2.3 | Head appointment (multi-statement). Neither the current head's ending nor the new headship is committed, so there is no partial state. The newer run commits all of it once. | 1, 3, 4, 11 |
| E2.4 | Payment release. The attempt stays uncertain and there is no release audit. The newer run releases once. | 1, 4, 12 |
| E2.5 | Real interleaving. The first run is paused mid-execution; the newer run takes over (after a fresh-claim refusal) and completes; the first resumes. It commits nothing, writes no failure over the newer success, and leaves the newer result, claim and timestamp untouched: one release, one fence row (the newer one). | 2, 3, 5 |
| E2.6 | Four concurrent recoveries: one runs, one change, one fence row. | 6 |
| E2.7 | A committed run whose request still reads "executing" (lost response), with the target changed since. Recovery reconciles from the fence row and does **not** re-apply. A fresh foreign claim is not taken over. | 7 |
| E2.8 | A completed request cannot be reclaimed and its row is unchanged. | 8 |
| E2.9 | Policy withdrawn: recovery is refused before any claim (attempt count unchanged). | 9 |
| E2.10 | An approver who lost the group cannot act; a requester who lost authority makes the run fail with nothing committed. | 10 |
| E2.11 | Each executor's own refusals hold: group to Super, reinstating a removed account, a head for an archived department. Each is failed, "refused, nothing changed", with no fence row. | 11 |
| E2.12 | The confirmation requirement holds. Paystack-reported success records the payment and refuses the release. No payment is initiated. | 12 |

**Check that the tests have teeth.** I temporarily replaced the fence's ownership condition with a constant `'current'` and re-ran the file: E2.1 to E2.4 failed. The fence was then restored. In E2.5 the resumed run is stopped by its claim-guarded refusal record, because its own checks see the attempt already released. That path is covered independently of the fence.

### Full suite

Run in two halves to fit the time limit, after the last code change:

| Run | Tests | Pass | Fail |
|---|---|---|---|
| Half 1 (21 files) | 161 | 161 | 0 |
| Half 2 (21 files, including the E, E.1 and E.2 files) | 253 | 252 | 1 |
| **Total** | **414** | **413** | **1** |

The only failure is the **pre-existing** "3B.1: staging configuration … account_id is not pinned" (`tests/stage3b-gates.test.ts:312`). It is kept visible and has not been weakened. At the end of E.1 the result was 401 of 402; Stage E.2 adds 12 tests, and all of them pass.

| Check | Result |
|---|---|
| TypeScript (both configurations) | pass |
| ESLint | pass |
| `npm run db:check` | PASS (17 migration files) |
| Schema snapshot | regenerated (52 tables, 47 indexes) |
| `npm run docs:api` | regenerated |
| Production build (`npm run build`) | pass |
| Built site compared with the pre-Stage-B baseline | 0 pages with different visible text |
| CSP check | pass |
| Secret scan | pass |
| `npm audit` | 0 vulnerabilities |
| Worker bundle | 351.5 KiB minified, within the 360 KiB budget set in Stage E; the budget was not changed |

## 8. Migration and rollback implications

**Why a migration was necessary.** The existing schema had no column that could hold a unique per-run token; `execution_claimed_at` is a timestamp, and the brief rules out using it as identity. It also had no durable record of *which run committed*, which is what lets a recovery reconcile an unknown outcome without re-applying.

**`0017_execution_fencing.sql`** (additive, local only):

- adds `approval_requests.execution_claim_id`;
- adds the table `execution_fences` (`claim_id` primary key, `approval_id`, `owner_check` and `effect_check` NOT NULL, `committed_at`);
- adds an index on `approval_id`;
- runs no data statements.

**Existing rows** (local and test databases only; 0015 to 0017 were never applied in production):

| Existing state | How it is handled |
|---|---|
| `executing` | No claim id. It can be taken over after two minutes by an explicit recovery, which checks the target's state first. |
| `failed` | Recoverable as before, now fenced. |
| uncertain (E.1 wording, `failed`) | Recoverable as before, now fenced. |
| `completed` | Untouched. |

Tooling:

- `EXPECTED_MIGRATION` = `0017_execution_fencing.sql`;
- schema snapshot regenerated;
- `execution_fences` classified as `security`, with an anonymisation rule;
- `db:check` PASS (17 files).

**Rollback:** `0017` is `olderWorker: "check"` with check `approval_executions_running`, the count of requests in `executing`. An older (E.1) Worker does not fence, so before rolling back below 0017, wait until nothing is running, or reconcile interrupted runs. The new column and table can stay; an older Worker ignores them.

**Before any production use** (not done, not authorised): apply 0010 to 0016 in order first, take a fresh backup, run a restore rehearsal on staging, and run `db:check` and the preflight.

## 9. Remaining limitations and Owner decisions

- **Checks are reads made before the transaction.** The *ownership* of the claim is verified inside the transaction, and so is the action's intended result (the effect check). Other conditions read earlier, such as the approver's group or a department being active, are not re-read inside it. If one of them changes in the moment between the check and the commit, the run can still commit on the earlier reading. The approver and the requester stay recorded in the audit, and the next action re-checks.
- **Payment release's Paystack verification happens before the transaction.** It is read-only; a confirmed payment is recorded idempotently and the release refused.
- **The two-minute threshold** (`EXECUTION_STALE_MS`) remains a fixed engineering value. Taking over is now safe at any age, so it only controls how soon an eligible approver may intervene.
- **A run whose outcome could not even be looked up** stays `executing` and is reconciled from its fence row by the next explicit recovery. This needs a person, by design.
- **Owner decisions D-E1 to D-E13 are unchanged and unresolved.** This includes D-E13: whether an approver may close a failed request without carrying it out.

## 10. Confirmation

- No deployment, no production migration, and no change to production D1, KV or R2 data, DNS, domains, secrets, environment variables or authentication settings.
- No invitations, and no real or bulk email: every email in the tests went to the local mock.
- No payment made or initiated, and Paystack not activated (mocked in tests).
- No approval policy, payment release, department or appointment activated in any real database. Rules, failures and superseding runs in the tests were fixtures in isolated test databases.
- `app/globals.css`, logos and icons were not edited.

**Stopped after Stage E.2. Stage F not begun.**
