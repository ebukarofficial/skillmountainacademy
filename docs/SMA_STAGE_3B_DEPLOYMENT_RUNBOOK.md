# SMA Stage 3B: Production Deployment Approval and Verification Runbook

Date: 22 November 2026.

Status: **implemented and tested locally with fakes. It has never been run against Cloudflare or GitHub.** Nothing here has deployed anything. The first real use is an owner decision.

The owner (bookebukar@gmail.com) approves every production deployment. This runbook covers:
- how a release is approved;
- what the workflow checks before deploying;
- how a deployment is verified and recorded;
- what to do if it fails.

It never migrates the database and never rolls back automatically.

## 1. What runs, and what never runs

| Workflow | Starts | Does | Never does |
|---|---|---|---|
| `ci.yml` | Every pull request to `main` and every push to `main` | Type checks, lint, all tests, migration-file checks, build, CSP/header check, `npm audit`, secret scan | Deploy, touch Cloudflare, use secrets |
| `deploy-worker.yml` | **Manually only** (Actions → "Deploy Worker (production)" → Run workflow), with a release tag | Verifies the release, then gates and deploys the Worker, verifies it and writes a record | Migrations, rollback, DNS/routes, D1 writes, Paystack or R2 activation |
| `deploy.yml` (existing) | Unchanged: GitHub Pages | Unchanged | Not modified or disabled in Stage 3B (owner decision) |

## 2. One-time preparation (owner)

None of these steps has been done; each needs the owner.

1. **GitHub setup.** Apply `docs/SMA_STAGE_3B_GITHUB_PROTECTION_GUIDE.md`:
   - branch protection on `main` with the three required checks;
   - the `production` environment with the owner as required reviewer;
   - tag protection for `v*`.
2. **Cloudflare deploy token.** Create the token in `docs/SMA_STAGE_3B_CLOUDFLARE_PERMISSIONS_AND_SECRETS.md` §2 and store it as the `production` environment secret `CLOUDFLARE_DEPLOY_TOKEN`.
3. **Production environment variables** (not secrets):

   | Variable | Value |
   |---|---|
   | `APPROVED_ACCOUNT_ID` | Account ID |
   | `APPROVED_D1_UUID` | Exact UUID of `skillmountainacademy-db` |
   | `APPROVED_KV_ID` | Id of the production KV namespace bound as `KV` |
   | `SITE_URL` | `https://skillmountainacademy.com` |
   | `NEXT_PUBLIC_SHEET_URL`, `NEXT_PUBLIC_WHATSAPP` | As today |
   | `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | **Leave empty** until Paystack is approved. The gate refuses a key unless `PAYSTACK_APPROVED=true`. |
   | `PAYSTACK_APPROVED`, `R2_APPROVED` | `false` until the owner decides otherwise |

   Read every value from the Cloudflare dashboard; never copy them from this repository or from a message.
4. **Pin the identity in `wrangler.jsonc`** through a reviewed pull request:
   ```sh
   npm run deploy:pin -- --account-id "<account>" --database-uuid "<d1 uuid>" --kv-id "<kv id>"          # dry run: shows WOULD PIN
   npm run deploy:pin -- --account-id "<account>" --database-uuid "<d1 uuid>" --kv-id "<kv id>" --write  # applies; comments kept
   ```
   Why each value is needed:
   - **`account_id`** stops Wrangler from choosing an account itself.
   - **`database_id`** stops Wrangler from resolving the database by name.
   - **KV `id`** is needed because Wrangler 4 *creates a new resource* for an id-less binding it cannot inherit, even in CI. This was verified in the installed Wrangler source: `provisionBindings`, with non-interactive prompts falling back to "Create new".

   The tool refuses to replace a different existing value.

## 3. Releasing

1. Merge the change into `main` through a reviewed pull request, and wait until CI is green.
2. Tag the merged commit: `git tag -a v2026.12.01-1 -m "<what changed>" <commit> && git push origin v2026.12.01-1`. The format is `vYYYY.MM.DD-N`, with N counting releases that day.
3. **Decide the database question first.**
   - If the release contains a new migration, the migration is applied **before** the deployment, using `docs/SMA_STAGE_3A_PRODUCTION_MIGRATION_CHECKLIST.md`.
   - The deployment workflow never migrates. It refuses to deploy a build whose expected migration differs from the live database.
4. Actions → **Deploy Worker (production)** → Run workflow, with these inputs:
   - `tag`;
   - `approver`: your name;
   - `confirmed_db_migration`: only for the first deployment, see §5.
5. GitHub pauses at the `production` environment. Review and **approve** it as owner (required reviewer). Nobody else can.

## 4. What the workflow checks, in order

Any failure stops the run before `wrangler deploy`. The gate is `scripts/deploy/gate.mts`; its tests are in `tests/stage3b-gates.test.ts`.

1. **Release** (verify job):
   - the tag matches `vYYYY.MM.DD-N`;
   - the tagged commit is on `main`;
   - all three required CI checks (`CI static checks`, `CI tests`, `CI build and security headers`) **succeeded on that exact commit**. The latest run of each counts.
2. **Approval:** the `production` environment's required reviewer.
3. **Build:** a clean `npm ci`, the build and the CSP/security-header check.
4. **Identity (configuration):**
   - `wrangler.jsonc` must name the Worker `skillmountainacademy`;
   - it must have exactly one D1 binding `DB` named `skillmountainacademy-db`;
   - it must pin `account_id`, `database_id` and the KV `id`, each **equal to the approved values**.

   Refusals: a missing or mismatched account ID, D1 UUID or KV id; an unexpected Worker or database name. A matching database *name* is never accepted in place of the UUID.
5. **Identity (live), with the account pinned twice:** in a temporary config and in `CLOUDFLARE_ACCOUNT_ID`.
   - The token can use the approved account (`whoami`).
   - `d1 info` by UUID returns `skillmountainacademy-db`, and `d1 info` by name returns the same UUID.
   - The Worker `skillmountainacademy` exists in that account (`deployments list`).
6. **Database compatibility:** `GET $SITE_URL/api/status` reports `schema.applied`.

   | Live database | Result |
   |---|---|
   | Same migration this build expects (`0010_owner_integrity.sql`) | **verified** |
   | Older | Refused: migrate first |
   | Newer | Refused: this is a rollback, use the rollback procedure |
   | Unreadable | Refused |

7. **Scope:** no Paystack public key unless `PAYSTACK_APPROVED=true`; no R2 binding unless `R2_APPROVED=true`.
8. **Deploy:** `npx wrangler deploy --message "release <tag> <commit> approved by <name>"`.
9. **Verify and record:**
   - poll `/api/status` until it reports `ok: true` and `schema.status: "compatible"` (up to 6 attempts);
   - read the new version id;
   - write `deployment-record.json` with tag, commit, Worker, account, version id, approver, environment approvals, gate result, verification and outcome;
   - upload the record and gate result as a workflow artefact, kept for 90 days.

   Download the record and keep it with the release notes.

## 5. First deployment from a Worker without schema reporting

The Worker now live in production predates Stage 3B, so its `/api/status` has no `schema` field. The gate refuses with "does not report its database migration" unless the owner attests the state:

1. Run the identity-verified, read-only state capture locally:
   ```sh
   npm run db:state -- --remote --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database-uuid "${SMA_DB_UUID:?}"
   ```
2. If its latest migration is `0010_owner_integrity.sql`, enter that exact name as `confirmed_db_migration` when running the workflow.
3. The record marks compatibility **attested** (not machine-verified) and names the approver.
4. From then on, the deployed Worker reports its schema, and the input must be left empty. The attestation is ignored whenever the live Worker reports its state.

## 6. Outcomes and what to do

| Outcome in the record | Meaning | Action |
|---|---|---|
| `not-deployed` | A gate refused. Nothing changed. | Read `gate.json` failures, fix the cause, run again. |
| `deploy-failed` | `wrangler deploy` itself failed. The previous version normally stays live. | Check `/api/status` and `npm run cf -- worker-deployments ...`; fix and re-run. |
| `deployed-unverified` | Deployed, but `/api/status` did not confirm health and compatibility | **Treat as an incident.** Follow `docs/SMA_STAGE_3A_DISASTER_RECOVERY_RUNBOOK.md` §4. The record prints rollback guidance only. |
| `success` | Deployed and verified | Keep the record. |

**No automatic rollback.** A rollback is an owner decision taken with the rollback-compatibility check and `npm run cf -- worker-rollback ...` (DR runbook §4), never by the workflow.

## 7. What has not been tested

This runbook has not been exercised against GitHub or Cloudflare. None of these has been tested:
- the required-reviewer pause;
- the token permissions;
- `wrangler deploy` with the pinned configuration;
- the deployment record against real Wrangler output;
- whether Wrangler keeps dashboard-configured custom domains or routes on a deploy with none in `wrangler.jsonc`.

Recommendation before the first production use: deploy the staging Worker with the same steps (`docs/SMA_STAGE_3B_ENVIRONMENT_SEPARATION.md`). Then confirm in the dashboard that the production Worker's custom domain is listed under the Worker's *Domains & Routes* before running the workflow.
