# SMA Stage 3B.1: Independent Closure Audit, Integration Verification and Operational Readiness

> **Stage 3B.2 revision (22 Nov 2026, owner instruction).** The owner's production route is intentional: local Git → push to GitHub → Cloudflare (connected to GitHub) publishes. Findings F1 and F2 are revised (§4), and the recommendations in this document to disconnect the integration or to make `deploy-worker.yml` the production route are **withdrawn**. See `docs/SMA_STAGE_3B_2_ALIGNMENT_REPORT.md`, which takes precedence where the two differ.

Date: 22 November 2026. Scope: the local repository only.

**Nothing was deployed, migrated, rolled back, restored, created or changed** in Cloudflare, GitHub, DNS, storage, Paystack or R2. No production data was accessed. Production `wrangler.jsonc`, the GitHub Pages workflow (`deploy.yml`) and `app/globals.css` were compared byte for byte with the Stage 3B package and are **unchanged**.

## 1. Executive assessment

Stage 3B's components were inspected individually, then against each other and against the hosting arrangement that the repository's own documentation records. The single most important result is about **routes to production**, not about code.

**Routes to production.** The repository documents three independent routes:
1. **Cloudflare Workers Builds**, connected to GitHub. `README.md`, `docs/CLOUDFLARE-DEPLOY.md` and `docs/upgrade/OWNER-CHECKLIST.md` §B record it running `npx wrangler deploy` on every push to `main`.
2. The **GitHub Pages** workflow, publishing on every push to `main`.
3. The new **gated workflow**.

If the first is still connected, the Stage 3B deployment protections are bypassed entirely: every merge to `main` reaches production without an approval, a CI check, an identity proof or a database-compatibility check. This cannot be confirmed without Cloudflare access. It is the Critical finding F1, and resolving it is an owner action.

**Local defects.** Eleven confirmed local defects were found in the Stage 3B engineering and corrected, with tests. These include:
- an ungated `npm run deploy` script;
- a compatibility check that read whatever site answers at the domain instead of the approved database;
- a CSP mode hard-coded to report-only;
- a deployment record that could credit another route's deployment;
- recovery operations that accepted evidence for the wrong database or without a passed restore verification;
- a backup job that could silently skip its record-drop safeguard.

**Verdict: CONDITIONALLY CLOSED (§13).** Local engineering is complete and verified. The remaining items are owner actions and decisions: Workers Builds, Pages, GitHub and Cloudflare set-up. **Nothing here is production-ready.** The gated deployment workflow must not be relied on until F1 and F2 are resolved.

## 2. Files and components actually inspected

| Area | Files |
|---|---|
| Identity-bound operations | `scripts/cf.mts` (every operation and both identity paths); `scripts/db/d1.mts` (`remoteTarget`, `resolveIdentity`, `query` read-only guard); `scripts/db/rollback.mts` (record); `scripts/db/restore.mts` (report); `scripts/db/post-restore.mts` |
| CI and deployment | `.github/workflows/ci.yml`, `deploy-worker.yml`, `backup.yml`, `restore-drill.yml`, `deploy.yml` (Pages); `scripts/deploy/gate.mts`, `pin.mts`, `record.mts`, `ci-status.mts`, `staging-check.mts`; `scripts/security/csp-check.mts`, `secret-scan.mts`; `scripts/csp.mts` (mode); `src/worker.ts` (`/api/status`); `src/server/schema-version.ts` |
| Backup | `scripts/backup/ship.mts`, `scripts/db/dump.mts` (encryption) |
| Staging | `wrangler.staging.jsonc`, `wrangler.jsonc`, `scripts/db/anonymise.mts`, `lib/config.ts` (Turnstile), `app/turnstile.tsx` |
| npm scripts | `package.json` (every script) |
| Wrangler | Installed `wrangler` 4.156.0 (`cli.js`): deploy output (`Current Version ID:`), provisioning, account selection |
| Documents | The seven named in the brief, plus `README.md`, `docs/CLOUDFLARE-DEPLOY.md`, `docs/upgrade/OWNER-CHECKLIST.md`, `docs/SMA_STAGE_3A_STAGE_3B_HANDOVER.md`, and a repository-wide search for every direct Wrangler production command |

## 3. Requirements-to-implementation verification matrix

Status key:
- **V** = verified by inspection and local tests;
- **V\*** = verified after a correction in this stage;
- **D** = documented only or owner action;
- **N** = not testable locally.

### A. Identity-bound Cloudflare operations

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Every remote operation verifies account and resource | V | D1 operations go through `resolveIdentity` (membership, UUID→name, name→UUID). Worker operations check `whoami` membership and that the Worker exists in the account. Tests: `cf-operations` 2, 5. |
| 2 | Account, D1 UUID and KV id pinned where required | V\* | `cf.mts` pins account and UUID. The deploy gate pins account, UUID and KV id (`deploy:pin`). No `cf` operation uses KV. |
| 3 | Verification and operation cannot use different contexts | V | Both use the same account (temporary config `account_id` plus `CLOUDFLARE_ACCOUNT_ID`) and the same UUID. The fake runner asserts this on every call. |
| 4 | Changing operations default to dry run | V | All six changing operations; tests 4, 6–9 |
| 5 | Execution needs approval and all evidence | V\* | F8 (rollback bound to production UUID), F9 (restore verification required), F14 (malformed evidence refused, not a crash) |
| 6 | No undocumented bypass | V\* / D | F3: `npm run deploy` is now gated, and a test forbids ungated scripts. F1 and F20: external or legacy routes are documented, and owner action is required. |
| 7 | Discovery commands distinguished from changes | V | Runbooks mark `whoami` and the account-pinned `d1 list` as "discovery only". The remaining bare commands are historical reports, marked superseded where they are operational guides. |

### B. CI workflow (`ci.yml`)

| Requirement | Status | Evidence |
|---|---|---|
| PRs and pushes to `main` | V | `on.pull_request/push.branches: [main]`; policy test |
| Node 22 everywhere | V | All three jobs. Pages uses Node 20, which is part of F2. |
| Reproducible install | V | `npm ci` with the committed lockfile |
| Both tsc, ESLint, tests, migration check, audit, secret scan | V | Policy test asserts every command |
| Build and CSP check | V | `CI build and security headers` |
| Actions pinned | V | Full 40-character SHAs, tested. The Pages workflow is unpinned (F2). |
| Least privilege | V | `contents: read`; `persist-credentials: false` |
| No secrets to untrusted PR code | V | `pull_request` (not `pull_request_target`); no secrets referenced |
| Job names equal the required checks | V | Test: job names = `REQUIRED_CHECKS` = the GitHub guide §1 |

### C. Worker deployment

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Manual only | V | `workflow_dispatch` only; test |
| 2 | Tag commit on `main` | V\* | F6: compare API instead of a credential-less `git fetch` |
| 3 | CI passed on that exact commit | V\* | F12: GitHub Actions runs only |
| 4 | Production environment approval | D | `environment: production`; the required reviewer is an owner GitHub setting |
| 5 | Gate before deploy | V | Step order tested; failure exits 1, so later steps are skipped |
| 6 | Account, D1, KV and Worker verified | V | Gate tests: 14 refusal cases |
| 7 | Database compatibility before deploy | V\* | F4: read from the approved UUID itself |
| 8 | Paystack and R2 not accidentally activated | V\* | F13: `define` checked too. Runtime Paystack secrets are not touched by deploy. |
| 9 | Record complete and auditable | V\* | F7: deployed vs live version, CSP mode, approvers, gate, outcome; 90-day artefact |
| 10 | No hidden migration, rollback or DNS | V | Policy test on every non-comment line |
| 11 | No automatic rollback | V | Record prints guidance only; tested |

### E. Backup and recovery

| Requirement | Status | Evidence |
|---|---|---|
| Encryption required | V | `--encrypt-for`; shipping refuses plaintext; tested |
| Identity and manifest checks | V | `inspectBackup`: 12 cases |
| SHA-256 | V | Manifest and stored-copy checks; tested |
| Conditional write-once, no silent overwrite | V / N | `--if-none-match '*'`; provider support untested |
| Stored-copy verification | V | `verifyUploaded`; tested |
| Failure alert | V / N | `if: failure()` issue; untested on GitHub |
| Missing storage configuration refused safely | V\* | F10: refused before production is read |
| Retention not assumed | V | The workflow never deletes; retention is an owner choice in the provider |
| Restore needs a verified backup, manifest and approval | V\* | F9 |
| Recovery never overwrites live | V | `restore-import` and `restore-reset` refuse any name except `…-restore-YYYYMMDD`; tested |
| Post-restore session invalidation and audit preserved | V | `restore-reset` accepts only the exact generated 3-statement reset with the `system.restore` audit row; tested (3A.1 and 3B) |

### F. Staging and anonymisation

| Requirement | Status | Evidence |
|---|---|---|
| Independent Worker, D1 and KV | V | `staging-check` |
| Production identifiers cannot be reused | V\* | F15: production KV id required |
| No production routes or cron | V | Checked and tested |
| Paystack disabled | V | Checked and tested |
| Every column covered; new ones refused | V | `db-anonymise` 1 |
| No PII, secrets or free text leaks | V | End to end on local D1; value-level and email-domain scans |
| Cannot target remote | V | `db-anonymise` 2 |

## 4. Confirmed findings and severity

Correction column: **L** = local, done here; **O** = owner action.

| ID | Sev. | Where | Defect or risk | Confirmed? | Impact on SMA | Correction | L/O | Proving test |
|---|---|---|---|---|---|---|---|---|
| F1 | ~~Critical~~ → **Informational (revised in Stage 3B.2)** | Cloudflare Git integration (Workers Builds) | **Revised.** The GitHub → Cloudflare integration is the owner's *intended* production publishing arrangement, not a defect. Stage 3B.2 confirmed read-only that the live domain is served by the Worker, which is running recent code, so the route works. What still needs read-only verification is the exact build and deploy command configured in Cloudflare. | Integration: intended. Command: unverified. | None from the integration itself. It deploys application code; migrations remain a separate, owner-approved step (Stage 3B.2 report §3). | Record the configured build and deploy commands (read-only, owner) | O (read-only) | n/a |
| F2 | ~~High~~ → **Low (revised in Stage 3B.2)** | `.github/workflows/deploy.yml` | Publishes an API-less copy to GitHub Pages on every push: unpinned actions, Node 20, no security headers | Confirmed (workflow); domain target unknown | A second, divergent copy of the site; if the domain points there, all forms and sign-in fail | Stage 3B.2: the production domain is served by the Worker, so Pages is **not** conflicting with the live site. Left in place per owner instruction; it publishes only a `github.io` copy. | O | n/a (not modified, by restriction) |
| F3 | **High** | `package.json` `deploy` | `npm run deploy` was a bare `wrangler deploy`, still instructed in older docs. With the unpinned config it uses the cached account and can auto-create KV. | Confirmed | An ungated production deployment from any developer machine | Now `gate.mts && wrangler deploy` | L | "no npm script reaches production without a gate" |
| F4 | Medium | `gate.mts` | Compatibility came from public `/api/status`, reflecting whatever answers at the domain, not the approved UUID. The first deployment relied on a typed attestation. | Confirmed | Wrong or unverifiable compatibility decision, or a refusal if the domain is on Pages | Identity-bound read of the approved UUID's `d1_migrations`; attestation removed | L | gate "database compatibility read from the approved D1 UUID…" |
| F5 | Medium | `deploy-worker.yml` | `CSP_MODE: report` hard-coded | Confirmed | A release could silently turn an enforced CSP back to report-only | `vars.CSP_MODE` required; build checked with `--expect-mode`; gate refuses if unset | L (+O to set the variable) | "states the CSP mode…", "CSP check refuses a build whose mode differs", gate scope |
| F6 | Medium | `deploy-worker.yml` verify | `git fetch origin main` after a checkout without credentials | Confirmed by inspection (fails on a private repository) | The workflow would be unusable | GitHub compare API | L | policy test (no `git fetch` in steps) |
| F7 | Medium | `record.mts` | "Success" took the newest live version, not this run's | Confirmed | Could certify another route's deployment | Parse `Current Version ID:`; mismatch → `deployed-unverified` | L | record test |
| F8 | Medium | `cf.mts` `worker-rollback` | The record was not bound to the production D1 UUID | Confirmed | A SAFE verdict from a check against a restore database would be accepted | `--database-uuid` required and must match the record | L | `cf-operations` rollback |
| F9 | Medium | `cf.mts` `restore-import` | No proof of a passed restore verification; the backup's source account was not checked | Confirmed | Import of an unverified or foreign backup | `--restore-report` (ok, same manifest SHA, under 24 h); production backup of the approved account | L | `cf-operations` restore |
| F10 | Medium | `backup.yml` | Listing error swallowed (`\|\| true`), silently skipping the record-drop check; missing storage noticed only after production was read | Confirmed | The deletion-detection safeguard could silently disappear | Configuration check plus `head-bucket` before the backup; listing errors fatal | L | "backup workflow refuses before reading production…" |
| F11 | Medium | Backup doc §2.6 | Told the owner to run by hand *before* `BACKUP_ENABLED`, which the job's `if` does not allow | Confirmed | Confusing activation; an apparently "skipped" first run | Corrected | L | n/a (documentation) |
| F12 | Low | `ci-status.mts` | Accepted check runs from any app | Confirmed | Another app with checks permission could satisfy a required name | GitHub Actions only | L | CI status test (spoofed runs) |
| F13 | Low | `gate.mts` | Paystack key in `wrangler.jsonc` `define` not checked | Confirmed | Paystack could be activated through config | Checked | L | gate scope test |
| F14 | Low | `cf.mts` | A manifest without `source` crashed with a TypeError instead of refusing | Confirmed | An unclear failure during an incident | Optional chaining; clean refusal | L | `cf-operations` restore (malformed manifest) |
| F15 | Low | `staging-check.mts` | Production KV id not required when production does not pin it (the UUID was) | Confirmed | Cache separation unproven | Required | L | staging KV test |
| F16 | Low | Staging and `lib/config.ts` | Turnstile site key is compiled in and is production's | Confirmed | Staging forms will fail; the doc implied test keys suffice | Documented; Stage 3C engineering | O / Stage 3C | n/a |
| F17 | Low | `backup.yml` (GitHub platform) | Scheduled workflows stop silently after 60 days of repository inactivity | Platform behaviour | Backups could stop without an alert | The drill must check the newest backup's age (documented) | O | n/a |
| F18 | Info | `cf.mts` `end-sessions` | Ending all production sessions writes no `audit_log` entry (`restore-reset` does) | Confirmed | Weaker audit trail for an incident action | Stage 3C: add a generated, audited form | — | — |
| F19 | Info | Staging | `staging:check` is not enforced before a staging deploy | Confirmed | Relies on the operator | Stage 3C: one wrapped command | — | — |
| F20 | Info | Historical reports (Stage 2B, 2C, security remediation, `upgrade/HANDOVER.md`) | Still contain bare production commands | Confirmed | Could be followed by mistake | Operational guides marked superseded; reports kept as historical records | L | — |
| F21 | Info | `docs/CLOUDFLARE-DEPLOY.md` | Lists `NEXT_PUBLIC_TURNSTILE_SITE_KEY` as a build variable; code reads `lib/config.ts` | Confirmed | None (stale text) | Noted | — | — |
| F22 | Info | `/api/status` | Publicly shows the migration name | By design | Minor information disclosure | Accepted | — | — |
| F23 | Info | Anonymiser | Keeps student and staff numbers (quasi-identifiers) | By design | Re-identification by insiders | Documented; copies confidential | — | — |
| F24 | Info | Tests | Workflow tests rely on `js-yaml` (an ESLint dependency) | Confirmed | Tests break if ESLint drops it | Add as a dev dependency if that happens | — | — |

**Checked and found correct (no finding):**
- the D1 read-only guard on remote queries;
- the time-travel evidence rules;
- `d1-create-restore` proving the new UUID;
- `restore-reset`'s exact-shape check;
- the deploy gate's KV pinning;
- the CI workflow in full;
- the encryption requirement;
- write-once flags;
- stored-copy verification;
- anonymisation coverage and the remote refusal;
- the deploy-workflow ordering;
- the absence of migration, rollback or DNS in the deployment;
- the Turnstile *site* key in the deploy build: it comes from code, so nothing is missing.

## 5. Corrections made

**Code:**
- `package.json` (`deploy` gated);
- `scripts/deploy/gate.mts` (F4, F5, F13);
- `scripts/deploy/record.mts` (F7);
- `scripts/deploy/ci-status.mts` (F12);
- `scripts/deploy/staging-check.mts` (F15);
- `scripts/security/csp-check.mts` (`--expect-mode`);
- `scripts/cf.mts` (F8, F9, F14).

**Workflows:**
- `.github/workflows/deploy-worker.yml`: F5, F6 and F7. The `confirmed_db_migration` input was removed.
- `.github/workflows/backup.yml`: F10.

**Tests:**
- `tests/stage3b-gates.test.ts`: 17 → 22 tests. The compatibility tests were rewritten for the stronger design, with every refusal kept: older, newer, empty, unreadable, unrecognised, and an env attestation that can no longer override. New tests cover the npm scripts, the deploy workflow, the backup workflow, the CSP mode and the staging KV.
- `tests/cf-operations.test.ts`: 9 tests, now with the rollback UUID and restore-report cases.

**Documents:**
- `SMA_STAGE_3B_DEPLOYMENT_RUNBOOK.md`: new §0 "one publisher only"; §5 replaced; CSP mode.
- `SMA_STAGE_3A_DISASTER_RECOVERY_RUNBOOK.md`: rollback `--database-uuid`; restore report and `--restore-report`.
- `SMA_STAGE_3B_BACKUP_AUTOMATION.md`: activation order, configuration check, 60-day note.
- `SMA_STAGE_3B_CLOUDFLARE_PERMISSIONS_AND_SECRETS.md`: `CSP_MODE`; what D1 Read is used for.
- `SMA_STAGE_3B_ENVIRONMENT_SEPARATION.md`: limitations.
- `SMA_STAGE_3B_IMPLEMENTATION_REPORT.md`: pointer to this audit.
- `README.md`, `docs/CLOUDFLARE-DEPLOY.md`, `docs/upgrade/OWNER-CHECKLIST.md`: superseded notices.

**Not changed (by restriction or because it is an owner decision):**
- `wrangler.jsonc`;
- `deploy.yml` (Pages);
- secrets, DNS, GitHub and Cloudflare settings;
- business rules.

## 6. Tests run and actual results (22 November 2026)

| Check | Result |
|---|---|
| `npm test` (complete suite) | **297 tests, 297 passed, 0 failed** |
| `tests/stage3b-gates.test.ts` (deployment gate, pinning, CI status, record, backup shipping, secret scan, CSP, workflow policies, staging isolation, 3B.1 corrections) | 22 / 22 |
| `tests/cf-operations.test.ts` (Cloudflare operations, fake Wrangler) | 9 / 9 |
| `tests/db-anonymise.test.ts` (coverage, remote refusal, end to end on local D1) | 3 / 3 |
| `npx tsc -p tsconfig.json --noEmit` / `npx tsc -p src/tsconfig.json --noEmit` | Pass / Pass |
| `npx eslint .` | Pass |
| `npm run build` | Pass |
| `npm run security:csp -- --expect-mode report` | CSP CHECK PASSED: 30 pages, mode report |
| `npm run security:secrets` | SECRET SCAN PASSED |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `npm run db:check` | MIGRATION FILES PASS (10 files) |
| `actionlint` 1.7.12 + shellcheck 0.11.0 on all workflows | No findings |
| Byte comparison with the Stage 3B package | `wrangler.jsonc`, `deploy.yml`, `app/globals.css` unchanged |

## 7. Tests that remain unperformed against live services

None of the following has run:
- **any workflow on GitHub runners**, including:
  - the required-reviewer pause;
  - the compare-API ancestry check;
  - the check-runs query;
  - the approvals API;
  - artefact upload;
  - the issue creation;
  - schedules;
- **Cloudflare:**
  - token scopes (including D1 Read for the `d1_migrations` query);
  - `whoami` with an account-owned token;
  - `wrangler deploy` with the pinned config;
  - the real `Current Version ID` output and the deployments JSON;
  - custom-domain survival on deploy;
  - every `cf.mts` operation against the real API (dry-run and execute);
- **storage:** conditional writes, checksum responses, `head-bucket`;
- **restore:** any restore into a real Cloudflare restore database;
- **staging:** any staging deployment.

## 8. GitHub owner actions outstanding

1. Apply `SMA_STAGE_3B_GITHUB_PROTECTION_GUIDE.md`: the `main` ruleset with the three checks, the `v*` tag ruleset and Actions settings.
2. Create the `production` environment (owner as required reviewer, `main` only) with:
   - the variables `APPROVED_ACCOUNT_ID`, `APPROVED_D1_UUID`, `APPROVED_KV_ID`, `SITE_URL`, **`CSP_MODE`**, `PAYSTACK_APPROVED=false`, `R2_APPROVED=false` and the `NEXT_PUBLIC_*` values;
   - the secret `CLOUDFLARE_DEPLOY_TOKEN`.
3. Create the `backups` environment (`main` only), when backups are approved.
4. Add `.github/CODEOWNERS` with the owner's GitHub username.
5. Decide GitHub Pages (§10).

## 9. Cloudflare owner actions outstanding

1. **F1 (revised in Stage 3B.2): look, read-only,** at Workers & Pages → `skillmountainacademy` → Settings → Build, and record the build command, deploy command and production branch. **Do not disconnect anything**: this integration is the intended production route.
2. Record the custom domain's target: Worker → *Domains & Routes*, and DNS records.
3. Create the deploy token (Workers Scripts Edit, D1 Read, Account Settings Read; no DNS, KV, R2 or D1 Edit) and test it on staging first.
4. Pin `wrangler.jsonc` with `npm run deploy:pin -- … --write` through a reviewed pull request.
5. Backups, when approved: create the backup token (D1 Read) and choose the storage provider and retention.
6. Staging, when approved: create its database and namespace (environment-separation document §3).

## 10. Production hosting and the Pages decision

**Findings:**

| Question | Answer |
|---|---|
| Does Pages still deploy on every push to `main`? | **Yes.** `deploy.yml`: `on.push.branches: [main]` plus manual dispatch. |
| Can Pages and Cloudflare publish different versions? | **Yes.** Pages builds with Node 20 and repository secrets on every push. The Worker is built by Workers Builds (if connected) with Cloudflare build variables, or by the gated workflow with environment variables, on a release tag. Different times, toolchains and variables mean they can diverge. |
| Does the custom domain have a known target? | **Stage 3B.2: yes, the Worker.** A read-only request to `/api/status` returned the Worker's JSON. Originally: **no, not from the repository.** There is no `CNAME` in `public/`, and an Actions-based Pages custom domain lives in repository settings. `docs/CLOUDFLARE-DEPLOY.md` instructs moving the domain to the Worker and removing it from Pages, but whether that was done is unverified. |
| Could the API and frontend be served by different paths? | **Yes.** If the domain points at Pages, pages come from Pages and every `/api/*` call (sign-in, forms, payments, LMS) fails. The `*.github.io` address always serves the API-less copy. |
| Does `_headers` have any effect? | **On GitHub Pages: none** (Pages ignores `_headers` and `_redirects`, so it serves no CSP and no security headers). **On Workers static assets: yes**, for static pages. `/api/*` responses set their own headers. |
| Does retiring Pages need a DNS or hosting change? | **Only if the domain still points at Pages.** If the Worker already serves the domain, retiring Pages changes nothing for visitors of the domain. |

**Recommendation: retire Pages deliberately, in this order, each step owner-approved:**
1. **Establish the facts** (read-only):
   - `curl -s https://skillmountainacademy.com/api/status` returns Worker JSON;
   - Cloudflare DNS shows the Worker custom domain;
   - GitHub → Settings → Pages shows **no custom domain**.
2. **If the Worker serves the domain:**
   - change `deploy.yml` to `workflow_dispatch` only, in one reviewed pull request (stops automatic publishing; reversible);
   - after one release cycle, unpublish Pages and delete the workflow.
3. **If the domain still points at Pages:** do **not** retire Pages first.
   - First migrate the domain to the Worker. This is a DNS change with email records at stake (`docs/CLOUDFLARE-DEPLOY.md`), and it needs separate approval.
   - Verify `/api/status`.
   - Then follow step 2.
4. **Do not keep both** as automatic publishers. If a static mirror is wanted, keep it deliberately separate: manual dispatch, no custom domain, a clear "mirror" banner.

## 11. Backup and recovery limitations

- **The backup automation has never run.** It is inactive until `BACKUP_ENABLED=true`, and storage, keys and tokens do not exist yet.
- **No off-Cloudflare copy exists today.** Until backups run, the only recovery options are D1 Time Travel (7 days on the Workers Free plan, 30 days on Paid) and manual encrypted exports.
- **Conditional-write support** depends on the provider (untested). If it is unsupported, the job fails safely rather than overwriting.
- **The private key is a single point of failure.** Without it, no backup can be restored; two offline copies are required.
- **Silent schedule stop.** Scheduled jobs stop after 60 days of repository inactivity, so the monthly drill must check the newest backup's age.
- **Never rehearsed end to end.** Restore into a real Cloudflare restore database (`d1-create-restore` → `restore-import` → `restore-reset`) has not been rehearsed; Stage 3C should do it on staging.
- **Owner decisions.** RPO/RTO targets and retention periods remain undecided.

## 12. Stage 3C entry criteria (supervised staging activation)

Stage 3C may begin when all of these hold:
1. The owner approves Stage 3C explicitly. Creating staging resources is a Cloudflare change.
2. **F1 (revised):** the owner has recorded, read-only, the Cloudflare build and deploy commands (Stage 3B.2 report §5). Nothing is disconnected.
3. **The domain target recorded** (§10 step 1, read-only).
4. The owner decides whether staging lives in the production account or a separate one, and creates a **staging-only** token.
5. GitHub environments are not required for staging. The `main` ruleset (§8.1) is strongly recommended first, so staging tests reviewed code.

Stage 3C should include:
- staging creation;
- `staging:check`;
- a staging deployment with the same gate design;
- a staging Turnstile key (F16);
- an audited `end-sessions` (F18);
- a wrapped staging deploy (F19);
- a full restore rehearsal into a staging restore database;
- a first supervised run of `backup.yml` against staging storage.

**Stage 3B.2:** `deploy-worker.yml` is **not** part of the production route; it stays dormant and optional. `backup.yml` stays inactive until the owner sets it up (§8–9).

## 13. Closure verdict

**CONDITIONALLY CLOSED.**
- All local Stage 3B requirements are implemented and verified.
- Every confirmed local defect found by this audit (F3–F15) is corrected and covered by tests.
- No unresolved Critical or High **engineering** defect remains in the repository.

The conditions are owner actions and decisions:
- F1, revised in Stage 3B.2 to Informational: the integration is intended; only its exact commands need read-only recording;
- F2, the GitHub Pages decision;
- the GitHub and Cloudflare set-up in §8–9;
- retention and storage choices.

Stage 3B being closed does **not** make the system production-ready.
