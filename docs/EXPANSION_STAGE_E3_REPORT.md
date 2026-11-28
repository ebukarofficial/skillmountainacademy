# Expansion Stage E.3: commit-time authorization and business-rule revalidation

**Status:** implemented locally for Owner review. Nothing was deployed, migrated in production, emailed for real or paid.
**Date:** 28 November 2026.
**No new migration:** the E.2 schema supports the correction (section 9).

---

## 1. Root cause and scope

Stage E.2 fenced the commit, so a superseded run cannot commit. The executors still *read* every other condition before the transaction:

- the approver's and requester's authority;
- the target account;
- the department and headship;
- the payment attempt;
- the owner's approval policy.

Any of these could change between the read and the commit, and the action would still commit on the stale reading: a time-of-check/time-of-use (TOCTOU) gap.

**Correction.** Every mutable condition is now re-evaluated **inside the same D1 batch** that commits the action. That batch is one SQL transaction, and a single **validation statement** makes the whole transaction roll back if any condition is false. The early checks are kept for prompt refusals and clear messages, but they are no longer the final authority.

The scope is limited to the approval execution path for the four executable categories. The approval framework and the permission model are unchanged.

## 2. Files inspected and modified

**Inspected:**

- `executeApproved` and the four executors;
- `planHead` and `appointHead`;
- `planRelease`, `checkReleasable` and `releaseAttempt`;
- `claimExecution`, `fenceStmt`, `effectStmt`, `completeStmt` and `recordOutcome`;
- `mayDecide`, `groupChangeRefusal`, `accountChangeRefusal`, `canManageAdmins`, `adminMay` and `isOwner`;
- `resolveOwner` and `isBootstrapped`;
- the effective-group logic (`restrictUnassigned`);
- `assertAssignable` and the one-department rule;
- the approval and institution policies;
- migrations 0015–0017;
- the E.2 adversarial tests.

**Created**

- `src/server/lms/policy-sql.ts`: commit-time predicates (pure module, every value bound)
- `tests/stageE3-commit-authorization.test.ts`: 15 tests
- `docs/EXPANSION_STAGE_E3_REPORT.md`

**Modified**

- `src/server/lms/institution.ts`:
  - each plan now carries `conditions`;
  - `executeApproved` adds the shared conditions and puts the validation statement right after the fence;
  - after a rollback it reports which rule failed;
  - executor preflights gained the matching requester and active-account checks;
  - `planHead` returns its snapshot (the head it replaces and the target's assignments).
- `src/server/lms/data/institution.ts`: `validateStmt`.
- `src/server/lms/payment-release.ts`: `planRelease` returns release conditions. Paystack verification stays read-only and before the transaction.

No route, permission group, grant, migration, policy default or Owner decision was changed.

## 3. Every mutable condition read before the transaction

The list below comes from the code. "Pre" means it was read in a preflight before the transaction (in E.2 these reads were the final authority).

| # | Condition | Category | Source rule |
|---|---|---|---|
| 1 | The owner's rule for this category is still on | all | `ruleFor` (route-level, before claim) |
| 2 | Approver is eligible: not the requester; not the target of a people change; `owner` request needs the owner; `super` request needs the owner or a Super Administrator | all | `mayDecide` (route-level) |
| 3 | Approver's account is active and not removed | all | session and status (implicit) |
| 4 | Who the owner is (bootstrap record, `OWNER_EMAIL` and a usable account) | all | `resolveOwner`, `isOwner` |
| 5 | Requester's account is active | all | new preflight, consistent with the rules below |
| 6 | Requester may make this group change | group change | `groupChangeRefusal(requester, …)` |
| 7 | Approver may make this group change | group change | `groupChangeRefusal(approver, …)` |
| 8 | Target is an administrator, not removed, not the owner; the current group (Super rule); bootstrap done | group change | inside `groupChangeRefusal` |
| 9 | Target is a suspended, not removed staff account | reinstatement | executor |
| 10 | Requester may change accounts (the "users" area, with `restrictUnassigned`) and this account (`accountChangeRefusal`) | reinstatement | creation-time rule, now also applied at execution |
| 11 | Approver may change this account | reinstatement | `accountChangeRefusal(approver, …)` |
| 12 | Requester is still a Super Administrator | head appointment | creation-time rule, now also applied at execution |
| 13 | Department exists and is active | head appointment | executor |
| 14 | Target is assignable (active, not removed, administrator or instructor, not the owner) | head appointment | `assertAssignable` |
| 15 | The current head is the one the plan will replace (or there is still none) | head appointment | `planHead` |
| 16 | The target's open memberships are the ones the plan was built from | head appointment | `planHead` |
| 17 | One-department policy still allows a person with another membership | head appointment | `getInstitutionPolicy().multipleDepartments` |
| 18 | Attempt is `uncertain`, or `claimed` and older than the claim lifetime | payment release | `checkReleasable` |
| 19 | Instalment is not paid | payment release | `checkReleasable` |
| 20 | Requester's group is still one the owner authorised (`allowedGroups`) | payment release | release-route rule at request time, now also applied at execution |
| 21 | Paystack does not report the payment as successful | payment release | `checkReleasable` (external, read-only) |

## 4. How each condition is revalidated at commit time

Each condition is an SQL expression in `policy-sql.ts`, the single SQL form of the rule. The validation statement combines them:

```sql
UPDATE execution_fences SET effect_check = CASE WHEN <all conditions> THEN 'validated' ELSE NULL END WHERE claim_id = ?1
```

It runs as the **second statement of the commit batch**, after the fence and before any action statement. `effect_check` is NOT NULL, so a false condition makes the statement fail and **D1 rolls back the entire batch**. That is deliberate: a conditional UPDATE that simply matched no row would not have stopped the batch (the trap the brief warns about).

| # | Commit-time predicate | Where |
|---|---|---|
| 1 | `policy_enabled`: `json_extract(app_settings.approval_policy, <category path>) = 1` | `commonConditions` |
| 2, 3, 4 | `approver_authority`, built from four checks: (a) the approver is an active user; (b) the approver is neither the requester nor the target; (c) the approver is the owner *or* the request's current `approver` column is `super` and the approver is a Super Administrator; (d) owner identity = `owner_record` row 1 joined to an active, not removed admin whose email equals `OWNER_EMAIL` and the record's email | `commonConditions` |
| 5 | `requester_active` | `commonConditions` |
| 6, 7, 8 | `groupChangeAllowed(requester)` and `groupChangeAllowed(approver)`: valid group, bootstrapped, actor owner or Super, target admin and not removed and not owner, actor ≠ target, Super-involved changes only by the owner (reads the target's **current** group) | `groupChangeConditions` |
| 9 | `target_suspended` | `reinstatementConditions` |
| 10 | `usersAreaWriter(requester)` AND `accountChangeAllowed(requester)` | `reinstatementConditions` |
| 11 | `accountChangeAllowed(approver)` | `reinstatementConditions` |
| 12 | `requester_authority`: the requester is an admin with group `super` | `headConditions` |
| 13 | `department_active` | `headConditions` |
| 14 | `target_assignable` | `headConditions` |
| 15 | `headship_unchanged`: the planned head assignment is still the open head (or there is no open head) | `headConditions` |
| 16 | `membership_unchanged`: the sorted ids of the target's open assignments equal the plan's snapshot | `headConditions` |
| 17 | `multiple_departments_allowed` (only when the plan relies on it) | `headConditions` |
| 18 | `attempt_releasable` | `releaseConditions` |
| 19 | `instalment_unpaid` | `releaseConditions` |
| 20 | `requester_authority`: the requester's group appears in `json_each($.paymentRelease.allowedGroups)` | `releaseConditions` |
| 21 | **Not revalidatable in SQL**: Paystack is an external service. It stays a read-only call before the transaction. A payment confirmed *afterwards* is caught by #19 if it has been recorded by commit time (section 11). | — |

**Guarding against policy drift.** The SQL predicates mirror the existing JavaScript rules in one module, with no new policy. Test `E3.parity` compares them on a matrix: owner, two Super Administrators, Finance, Reporting, a legacy administrator, a removed account, an instructor and a student; every actor against every target; group changes to `finance` and `super`; with `restrictUnassigned` both off and on. That is **more than 300 comparisons**. `groupChangeAllowed`, `accountChangeAllowed` and `usersAreaWriter` must agree exactly with `groupChangeRefusal`, `accountChangeRefusal` and `adminMay`. If either form changes, the test fails.

## 5. Transaction and rollback behaviour

The commit batch, one D1 transaction, in order:

1. **Fence:** the claim id is current, otherwise roll back (E.2). The result is reported as *superseded*.
2. **Validation:** every condition in section 4 holds, otherwise roll back (E.3).
3. The action's statements.
4. The action's audit records.
5. **Effect check:** the intended result is in place, otherwise roll back (E.2).
6. The `approval.executed` audit record.
7. Status set to `completed` for this claim.

If any step fails, nothing from steps 1 to 7 persists:

- no action;
- no session deletion;
- no assignment change;
- no release;
- no success audit;
- no fence row;
- no `completed` status.

After a rollback at step 2 or 5, the server probes each condition separately (a read, for the message only). It then records the outcome, guarded by the claim:

- `failed` with `refused, nothing changed (commit_refused:<condition>: …)`;
- or `target_changed` when only the effect check failed.

The approver's decision (`approved`, who, when) is never touched. A recovery later follows the E.2 rules: explicit, reconciled, fenced, and now validated at commit as well.

## 6. Category-by-category safety results

| Category | Preflight (early, for messages) | Revalidated in the transaction (statement: validation, step 2) | If a condition changes after planning | Stale authority can still commit? |
|---|---|---|---|---|
| `staff_group_change` | target exists; valid group; `groupChangeRefusal` for requester and approver; requester active | policy; approver eligibility and active; requester active; `groupChangeAllowed` for requester and for approver, on current rows (including the target's current group and the owner rule) | Rolled back: group unchanged, target's sessions kept, no `admin.group_assigned`, no fence, status `failed` (tests E3.1b/2b/3b and E3.4) | **No** |
| `staff_reinstatement` | target suspended, staff, not removed; requester "users" area and `accountChangeRefusal`; approver `accountChangeRefusal` | policy; approver; requester active; `target_suspended`; requester `usersAreaWriter` and `accountChangeAllowed`; approver `accountChangeAllowed` | Rolled back: still suspended, no `staff.reinstated` (test E3.4, with a control that commits) | **No** |
| `department_head_appointment` | department active; requester an active Super Administrator; assignable; not already head; one-department rule | policy; approver; requester Super; department active; target assignable; headship unchanged; memberships unchanged; multiple-department policy when relied on | Rolled back: old headship **not** ended, no new headship, no audits (tests E3.5, E3.6 and E3.12, with a control) | **No** |
| `payment_attempt_release` | requester in an authorised group and active; every D.1.1 check; Paystack verify (read-only) | policy; approver; requester active and in `allowedGroups`; attempt releasable; instalment unpaid | Rolled back: attempt stays as it was, no `payment.attempt_release` (tests E3.1, E3.2, E3.3, E3.7, E3.8 and E3.policy) | **No**, apart from the external Paystack state (section 11) |

Payment release keeps every D.1.1 and E.2 safeguard:

- Paystack verification is still read-only and happens first.
- A confirmed payment is recorded through the existing idempotent path and prevents release.
- No payment initiation or charge exists.
- Release remains unavailable until the Owner authorises it.
- The authenticator code and audit requirements are unchanged.

## 7. Adversarial tests and actual results

`tests/stageE3-commit-authorization.test.ts`: **15 of 15 pass.**

Every test inspects the underlying rows: users (group, status, removal), sessions, department and assignment rows, the payment attempt and its instalment, fence rows, audit records and the request's execution fields. None relies on the response status alone.

| Test | Scenario (brief number) | Technique | Result |
|---|---|---|---|
| E3.1 | Approver loses the Super group after planning (1) | Paused at Paystack, persistent change | No release; `commit_refused:approver_authority`; no fence; no audit; status failed |
| E3.2 | Approver suspended after planning (2) | Paused | Same, approver authority |
| E3.3 | Requester leaves the authorised group (3) | Paused | Same, requester authority |
| E3.7 | Instalment paid after planning (7) | Paused | Same, `instalment_unpaid`; never released |
| E3.8 | Attempt resolved elsewhere, or freshly claimed (8) | Paused | Same, `attempt_releasable`; the attempt is untouched |
| E3.policy | Owner switches release off after planning | Paused | Same, `policy_enabled` |
| E3.9 | Valid approver, nothing changed (9) | Paused | Released once; fence row; completed |
| E3.10 | Control: valid requester and approver with the race trigger making a harmless change (10) | In-transaction | Commits, which proves the trigger point lies inside the commit, after planning |
| E3.1b/2b/3b | Group change: approver demoted, approver suspended, requester demoted, requester removed (1, 2, 3) | In-transaction | No change; the target's live session is **kept**; no action audit; no fence; failed |
| E3.4 | Target removed before the group change; target removed before reinstatement; approver suspended before reinstatement; plus a control (4, 2) | In-transaction | No change in any refused case; the control reactivates |
| E3.5 | Department archived before the head appointment commits (5) | In-transaction | Old headship not ended; no new headship; no audits |
| E3.6 | Planned head no longer the head; target joined another department; plus a control (6) | In-transaction | Refused cases leave everything unchanged; the control appoints |
| E3.11 | Superseded claim with every authority check valid (11) | Supersede trigger | Stopped at the commit by the fence; nothing committed |
| E3.12 | Failed validation of a multi-statement action: each planned statement checked to be absent (12) | Rows inspected | No partial action, no success audit, one failure record, no false completion |
| E3.parity | SQL predicates against the JavaScript rules, more than 300 cases | Matrix | All agree |

**The tests can fail.** I temporarily made the validation always pass (`CASE WHEN 1 OR …`) and re-ran the file: **12 of 15 failed**. The three that still passed were the controls and the parity matrix, which do not depend on validation. The code was then restored. The in-transaction technique is shown to reach the race window by its controls: the same trigger point with a harmless change commits, and with the harmful change it does not.

## 8. Full-suite results and known baseline failures

Run in three parts to fit the time limit. Every log was written after the last code change.

| Part | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|
| 1 (15 files) | 113 | 113 | 0 | 0 |
| 2 (14 files) | 127 | 127 | 0 | 0 |
| 3 (14 files, including the E, E.1, E.2 and E.3 files) | 189 | 188 | 1 | 0 |
| **Total** | **429** | **428** | **1** | **0** |

**The single failure is the known baseline**, not a new one: "3B.1: staging configuration: separate Worker, database (by UUID), cache and settings; refused until complete; production config untouched" (`tests/stage3b-gates.test.ts:312`, error `/account_id is not pinned/`). It is kept visible and has not been weakened. At the end of E.2 the result was 413 of 414; Stage E.3 adds 15 tests, and all of them pass.

**No new failures.** One bundle-budget failure did appear during this stage and was fixed in the code, not in the test. The Worker bundle first measured 360.2 KiB, over the existing 360 KiB budget in `tests/phase9.test.ts`. I removed line breaks inside SQL strings in `policy-sql.ts` and `data/institution.ts` (whitespace only) and stopped building the condition list twice in `executeApproved`. The budget was not raised.

| Check | Result |
|---|---|
| TypeScript (both configurations) | pass |
| ESLint | pass |
| `npm run db:check` | PASS (17 files, no new migration) |
| Production build | pass; 0 pages with different visible text from the baseline |
| CSP check | pass |
| Secret scan | pass |
| `npm audit` | 0 vulnerabilities |
| Worker bundle | **359.88 KiB** against the 360 KiB budget. Headroom is now about 0.1 KiB, so the next stage will need a budget decision or a size reduction. |

## 9. Migration and rollback implications

No migration. The validation reuses the E.2 `execution_fences.effect_check` NOT NULL column as its abort mechanism. It sets `'validated'` first; the E.2 effect check later sets `'confirmed'`. Everything else is SQL over existing tables (`users`, `owner_record`, `app_settings`, `approval_requests`, `departments`, `staff_assignments`, `payment_attempts`, `instalments`).

The largest validation statement uses 33 bound parameters, under D1's limit of 100 per statement. Rollback considerations from 0015–0017 are unchanged. An older Worker would lack commit-time validation; the `0017` rollback check (no runs in progress) still applies.

## 10. Operational boundaries respected

- No deployment, publication or production migration.
- No change to production D1, KV or R2 data, DNS, domains, secrets or environment variables.
- No approval policy activated and payment release not enabled: policies in the tests are fixtures in isolated test databases.
- No departments, appointments or staff accounts outside the test databases.
- No invitations or emails: email is mocked.
- No payment initiated or made: Paystack is mocked.
- No change to the Owner identity or bootstrap, permission groups, role grants, tuition, FX, currency or registration.
- `app/globals.css`, logos and icons were not edited.

## 11. Remaining technical limitations and Owner decisions

- **External Paystack state cannot be part of a D1 transaction.** Verification stays read-only before the commit, as in D.1.1. A payment that Paystack confirms after that check is caught at commit only if it has already been recorded (by the webhook or a check), through `instalment_unpaid`. Otherwise the release can commit. A release only lets the student open a new checkout; the D.1.1 claim and verify-first rules apply to that new attempt, and the payment, once recorded, is not lost. This is the same residual risk documented in D.1.1.
- **Owner identity at commit time requires the bootstrap record.** Before the owner has bootstrapped, a request needing the owner fails closed. Approvals presuppose bootstrap anyway.
- **The authenticator code is not re-checked at commit.** It is a property of the approver's *session*, checked when the request is made. If the approver is suspended, their account status, which *is* revalidated, stops the commit.
- **Direct owner actions are outside the approval path** and keep their existing single-request checks. These are the owner's direct head appointment and direct changes in Users.
- **The predicates are a second form of the JavaScript rules.** Drift between them is detected by the parity test rather than prevented by construction. A future change to `permissions.ts` must be mirrored in `policy-sql.ts`, or the parity test fails.
- **The Worker bundle is at 359.88 of 360 KiB.** Any further server code needs either a reduction elsewhere or the Owner's agreement to a higher budget (the Free plan limit is 3 MiB).
- **Owner decisions D-E1 to D-E13 are unchanged and unresolved.**

**Stopped after Stage E.3. Stage F not begun.**
