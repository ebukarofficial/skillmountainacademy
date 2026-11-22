# SMA Stage 3B: Implementation Report

Date: 22 November 2026. Scope: engineering implementation and local testing only.

> **Read with `docs/SMA_STAGE_3B_1_CLOSURE_AUDIT.md`.** The Stage 3B.1 audit corrected several items described here. Most notably, the first-deployment attestation no longer exists: compatibility is read from the approved D1 UUID. The audit also records the hosting findings (Workers Builds, GitHub Pages).

**Nothing was deployed, migrated, rolled back, created or changed in Cloudflare, GitHub, DNS, storage, Paystack or R2.** No production data was accessed. Production `wrangler.jsonc`, the GitHub Pages workflow, `app/globals.css`, logos and icons are unchanged.

**Handover note:** the brief refers to `docs/SMA_STAGE_3A_1_CLOSURE_REPORT.md`. The Stage 3A.1 document is actually named **`docs/SMA_STAGE_3A_1_CLOSURE_AUDIT.md`**, and that file was used.

## 1. Identity-bound execution (brief §1)

Every Wrangler command in the DR runbook and the production migration checklist was reviewed.

**Verified in the installed Wrangler 4 source** (`node_modules/wrangler/wrangler-dist/cli.js`):
- The account is chosen in this order: OAuth temporary account → config `account_id` → `CLOUDFLARE_ACCOUNT_ID` → **an account cached from an earlier session**.
- D1 commands use the config `database_id` and otherwise look the database up by name.

So an identity check followed by a bare command could act on a different account or database.

**Implemented:** `scripts/cf.mts` (`npm run cf -- <operation>`). For every remote operation it:
1. proves the identity live: `whoami` membership, `d1 info` by UUID equals the name, and `d1 info` by name equals the UUID;
2. runs Wrangler **in the same process** with a temporary config pinning `account_id` and `database_id` (or the Worker name), plus `CLOUDFLARE_ACCOUNT_ID`.

| Kind | Operations | Requirements |
|---|---|---|
| Read-only | `d1-query`, `time-travel-info`, `worker-deployments`, `worker-versions` | Identity proof |
| Changing | `time-travel-restore`, `end-sessions`, `worker-rollback`, `d1-create-restore`, `restore-import`, `restore-reset` | Dry run unless `--execute --approved-by`. Plus evidence: an encrypted backup of the same identity under 2 h old; a rollback-compatibility record; a manifest SHA; the exact generated reset |

Also:
- `scripts/db/d1.mts` and `migrate-remote.mts` now also set `CLOUDFLARE_ACCOUNT_ID` on remote runs.
- All production commands in both documents now go through `npm run cf` or `npm run db:*` with `--account-id`/`--database-uuid`. The only bare Wrangler lines left are `login`, `whoami` and an account-pinned `d1 list`, each marked **discovery only**.
- Only flags present in the installed Wrangler were used.

**New finding.** Wrangler 4 **creates a new resource** for a binding without an id that it cannot inherit (`provisionBindings`). The hidden `--experimental-auto-create` defaults to true, and in CI the prompt falls back to "Create new". Production `wrangler.jsonc` has an id-less KV binding. So:
- the deployment gate also requires the KV id to be pinned to `APPROVED_KV_ID`;
- `deploy:pin --kv-id` writes it;
- the deploy token is given no KV permission.

## 2. What was built

| Brief item | Delivered |
|---|---|
| A. CI | `.github/workflows/ci.yml`. Triggers: PRs and pushes to `main`. Node 22. Three jobs: **CI static checks** (tsc ×2, ESLint, migration files, `npm audit`, secret scan), **CI tests** (full suite, which includes DB preflight, recovery and restore tests), **CI build and security headers** (build plus CSP/header check). Actions are pinned to full SHAs, the token has `contents: read`, and credentials are not persisted. |
| B. Repository protection | `docs/SMA_STAGE_3B_GITHUB_PROTECTION_GUIDE.md`: rulesets for `main` and `v*` tags, required checks, owner review, environments, Actions settings. |
| C. Deployment workflow | `.github/workflows/deploy-worker.yml`: manual only, release tag `vYYYY.MM.DD-N`, commit on `main`, CI success on that exact commit, `production` environment with owner approval, then `scripts/deploy/gate.mts` → `wrangler deploy` → `scripts/deploy/record.mts`. The gate covers identity, live proof, database compatibility via `/api/status` and scope. The record covers commit, tag, version, approver, approvals and outcome. No migrations, no rollback, no DNS. `src/worker.ts` `/api/status` now reports `schema` (expected/applied/status). |
| D. Backups | `.github/workflows/backup.yml` (daily, **inactive** until `BACKUP_ENABLED=true`): encrypted identity-proven backup → `scripts/backup/ship.mts` checks → write-once upload (`--if-none-match '*'`, SHA-256) → stored-copy verification → failure issue. `.github/workflows/restore-drill.yml` (monthly reminder). `docs/SMA_STAGE_3B_BACKUP_AUTOMATION.md`: set-up, retention options, failures, restore and drill. |
| E. Staging | `wrangler.staging.jsonc`: own Worker, D1, KV and variables; no routes or cron; Paystack off. `scripts/deploy/staging-check.mts`. `scripts/db/anonymise.mts`: a rule for every column; isolated local copy only; verified. `docs/SMA_STAGE_3B_ENVIRONMENT_SEPARATION.md`. |
| F. Identity pinning | `scripts/deploy/pin.mts` (dry run by default; keeps comments). The gate rejects a missing or mismatched account ID, D1 UUID or KV id, an unpinned config, unexpected Worker or database names, and a name that resolves to a different UUID. |
| Permissions and secrets | `docs/SMA_STAGE_3B_CLOUDFLARE_PERMISSIONS_AND_SECRETS.md` |
| Deployment runbook | `docs/SMA_STAGE_3B_DEPLOYMENT_RUNBOOK.md` |
| DR docs | Both Stage 3A documents updated for identity-bound commands |
| Security scripts | `scripts/security/csp-check.mts`, `scripts/security/secret-scan.mts` |

## 3. Status by category

**Implemented and tested locally:**
- the identity-bound operations (`cf.mts`, fake Wrangler);
- the deployment gate, every refusal case and both pass paths;
- identity pinning;
- the CI-status check;
- the deployment record and its four outcomes;
- backup shipping checks and stored-copy verification;
- the secret scan and the CSP check;
- the staging isolation check;
- the anonymiser, end to end on a real local D1 copy;
- the workflow policies (YAML parsed and asserted);
- `/api/status` schema reporting (covered by the full suite).

**Implemented, not tested against the real service:**
- all four workflows on GitHub runners;
- `wrangler deploy` with the pinned config;
- live identity proofs against Cloudflare;
- Cloudflare token scopes;
- S3 conditional writes and checksums at the chosen provider;
- issue creation;
- environment approval pauses.

**Documented only:**
- GitHub settings;
- token creation;
- retention choices;
- staging resource creation;
- the anonymised-copy import;
- key generation.

**Requires GitHub access:**
- branch and tag rulesets;
- `production` and `backups` environments and their secrets and variables;
- CODEOWNERS (the owner's GitHub username is not recorded);
- the first CI run to register check names.

**Requires Cloudflare:**
- deploy and backup tokens;
- the approved account, D1 UUID and KV id values;
- staging resources;
- checking that the custom domain survives a deploy without routes in config.

**Requires owner approval:**
- every item in the four groups above;
- pinning `wrangler.jsonc`;
- choosing and paying for backup storage;
- retention period;
- enabling backups;
- creating staging;
- any anonymised import;
- the first production deployment (with the attested migration);
- whether to retire GitHub Pages.

**No workflow is production-ready** merely because its YAML passes validation. Each needs the GitHub and Cloudflare set-up above and a first supervised run, staging first.

## 4. Verification (22 November 2026, this environment)

| Check | Result |
|---|---|
| `npm test` (full suite, 292 tests) | **292 passed, 0 failed** |
| `npx tsc -p tsconfig.json --noEmit` | Pass |
| `npx tsc -p src/tsconfig.json --noEmit` | Pass |
| `npx eslint .` | Pass |
| `npm run build` | Pass |
| `npm run security:csp` | CSP CHECK PASSED: 30 pages, mode report |
| `npm run security:secrets` | SECRET SCAN PASSED |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `npm run db:check` (migration files) | MIGRATION FILES PASS (10 files); the existing owner note on `0007` is unchanged |
| `actionlint .github/workflows/*.yml` (1.7.12, with shellcheck 0.11.0) | No findings |
| `npm run staging:check` | Expected "NOT READY": the staging ids are unfilled by design |
| `npm run deploy:pin` (dry run, sample values) | WOULD PIN ×3; `wrangler.jsonc` unchanged |

**New Stage 3B test files:**

`tests/cf-operations.test.ts` (9 tests, all passing). Every Wrangler call pins account and config; read-only operations; dry-run default; evidence requirements; rollback-record rules; restore name and SHA rules; reset must match exactly.

`tests/stage3b-gates.test.ts` (17 tests, all passing):
1. pinning keeps comments, is idempotent and refuses different values (account, UUID, KV);
2. the gate passes only when verified;
3. the gate rejects a missing or mismatched account, UUID or KV id, unpinned config, unexpected Worker or database name, a name resolving to a different UUID, a token without account access, and a missing Worker;
4. database compatibility: older, newer, unknown, unreachable and missing all refused; attestation is accepted only when the Worker does not report;
5. release, approver and scope (Paystack, R2);
6. CI status on the exact commit, latest run counts;
7. deployment record: four outcomes, no rollback;
8. backup shipping: twelve refusal and warning cases;
9. stored-copy verification;
10. secret scan: positives, placeholders, forbidden files, the repository passes;
11. CSP check: the build passes, plus five failure cases;
12. workflows: SHA pins, permissions, no inputs in shell, checkout credentials;
13. the CI workflow;
14. the deployment workflow: manual only, production environment, gate before deploy, no migrate, no rollback, no DNS;
15. the backup workflow: gated, encrypted, write-once, verified, failure issue;
16. the Pages workflow is untouched;
17. the staging isolation check.

`tests/db-anonymise.test.ts` (3 tests, all passing):
1. full column coverage, and a new column or table is refused;
2. a remote target is refused;
3. end to end on local D1: restore-verified → anonymised → original names, emails, phones, free text, references and secrets absent from the output; triggers enforced again; a non-empty output folder is refused.

## 5. Changed files (compared with the Stage 3A.1 package)

**New:**
- `.github/workflows/`: `ci.yml`, `deploy-worker.yml`, `backup.yml`, `restore-drill.yml`
- `scripts/`:
  - `cf.mts`
  - `deploy/`: `gate.mts`, `pin.mts`, `ci-status.mts`, `record.mts`, `staging-check.mts`
  - `backup/ship.mts`
  - `security/`: `csp-check.mts`, `secret-scan.mts`
  - `db/anonymise.mts`
- `tests/`: `cf-operations.test.ts`, `stage3b-gates.test.ts`, `db-anonymise.test.ts`
- `wrangler.staging.jsonc`
- `docs/`:
  - `SMA_STAGE_3B_DEPLOYMENT_RUNBOOK.md`
  - `SMA_STAGE_3B_BACKUP_AUTOMATION.md`
  - `SMA_STAGE_3B_ENVIRONMENT_SEPARATION.md`
  - `SMA_STAGE_3B_CLOUDFLARE_PERMISSIONS_AND_SECRETS.md`
  - `SMA_STAGE_3B_GITHUB_PROTECTION_GUIDE.md`
  - `SMA_STAGE_3B_IMPLEMENTATION_REPORT.md`

**Modified:**
- `package.json`: scripts only (`cf`, `db:check`, `db:anonymise`, `staging:check`, `security:csp`, `security:secrets`, `deploy:gate`, `deploy:pin`, `deploy:record`, `backup:ship`); no dependency changes;
- `src/worker.ts` (`/api/status` schema field);
- `scripts/db/d1.mts`, `scripts/db/migrate-remote.mts` (`CLOUDFLARE_ACCOUNT_ID` pin);
- `scripts/db/rollback.mts` (`--version-id`, `--record`);
- `scripts/db/preflight.mts` (`--files-only`);
- `docs/SMA_STAGE_3A_DISASTER_RECOVERY_RUNBOOK.md`, `docs/SMA_STAGE_3A_PRODUCTION_MIGRATION_CHECKLIST.md`.

**Dependencies:** none added. The workflow-policy tests use `js-yaml`, which is already installed as an ESLint dependency. If ESLint ever stops bringing it, add it as a dev dependency.

## 6. Limitations and owner decisions

1. **First deployment needs an attestation.** The live Worker predates schema reporting, so the first deployment needs `confirmed_db_migration` after an identity-verified `db:state` (runbook §5).
2. **Custom domain.** Whether the production custom domain is configured in the dashboard, and kept by `wrangler deploy`, is unverified. Check it before the first deployment.
3. **Token scopes.** The exact minimum token permissions (Account Settings Read, Memberships Read) must be confirmed on staging.
4. **Storage provider.** It must support conditional writes; otherwise the upload fails safely, and that has not been tested.
5. **CODEOWNERS** needs the owner's GitHub username.
6. **GitHub Pages** keeps publishing on every push to `main`, as before. Retiring it is an owner decision (Stage 3A handover §1).
7. **Recovery objectives.** RPO/RTO targets and backup retention remain owner decisions.

Stage 3B work stops here for owner review. No production deployment or migration has been started.
