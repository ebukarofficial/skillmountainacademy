# SMA Stage 3A → Stage 3B Handover

Date: 22 November 2026.

Stage 3A built and locally proved the backup, restore, preflight, rehearsal and approval-gate tooling. Stage 3B should make it routine and automatic, without weakening any gate. **Stage 3B has not been started.**

## 1. GitHub and CI findings (verified directly)

`.github/workflows/deploy.yml` (the only workflow), as read on 22 Nov 2026:
- **Name and target:** "Deploy to GitHub Pages". It runs on **every push to `main`** and on manual dispatch.
- **Steps:**
  1. `actions/checkout@v4`;
  2. `actions/setup-node@v4` with **Node 20**;
  3. `npm ci`;
  4. `npm run build` with repository secrets `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`, `NEXT_PUBLIC_SHEET_URL` and `NEXT_PUBLIC_WHATSAPP`;
  5. `touch out/.nojekyll`;
  6. upload the `out/` artifact;
  7. `actions/deploy-pages@v4`.
- **What it does not do:** no tests, no type checks, no lint, no `npm audit`, no secret scan, no migration checks. It **does not deploy the Cloudflare Worker** and never touches D1.

**Risks of keeping it:**
1. **A second, partial copy of the site.** Pages serves only the static export: no `/api/*`, sign-in, LMS, admissions, payments or owner console. If DNS, or a visitor via `*.github.io`, reaches Pages, every form and sign-in fails, and visitors may see outdated content.
2. **Every push to `main` publishes.** There are no tests and no review gate, so a broken or unreviewed commit goes live on Pages at once.
3. **Node version mismatch.** `package.json` `engines` requires Node `>=22 <23`, but the workflow uses Node 20. The build may fail or behave differently from local and Cloudflare builds.
4. **The CSP postbuild runs**, but the `_headers` file it writes is ignored by GitHub Pages, so Pages visitors get **no security headers** at all.
5. **The public Paystack key** is injected at build time. That is fine for a public key, but a second distribution channel to maintain.
6. **Unknown DNS target.** It is unverified whether `skillmountainacademy.com` points to the Worker or to Pages. The owner checks with production checklist A5 (`curl https://skillmountainacademy.com/api/status`, which must return JSON from the Worker).

As instructed, the workflow was **not deleted or changed** and nothing was deployed.

**Repository state:** this working copy is not a git repository. Changes are delivered as ZIP packages, so branch protection, Actions settings and secrets on GitHub could not be inspected. **[Requires owner access to GitHub]**

## 2. Recommended Stage 3B scope

### 2.1 Pull-request checks (`.github/workflows/ci.yml`, on `pull_request` and `push` to `main`)
- Node 22 (`actions/setup-node` with `node-version-file: .nvmrc` or `22`), `npm ci`.
- `npx tsc -p tsconfig.json --noEmit` and `npx tsc -p src/tsconfig.json --noEmit`.
- `npx eslint .`.
- `npm test`, which includes:
  - the Stage 2/2B/2C security tests;
  - `tests/db-preflight.test.ts`;
  - `tests/db-recovery.test.ts`, about 3.5 minutes; it needs no Cloudflare access because it uses Wrangler local.
- `npm run build` (with `CSP_MODE=report`) plus the CSP hash check.
- `npm audit --audit-level=high`.
- Secret scanning: GitHub secret scanning and push protection, plus `gitleaks` in CI with an allow-list for `.dev.vars.example` placeholders and the public Turnstile site key.
- **Migration validation:** for every changed file in `migrations/`, run the file and parser checks and the review check against `db/migration-reviews.json`, through a small `db:preflight --files-only` mode to be added in 3B. Verify `db/schema.expected.json` and `EXPECTED_MIGRATION` are regenerated (tests already enforce this).
- Required status checks on `main`.

### 2.2 Protected production branch
- `main` protected: pull requests only, one approving review (the owner), required checks, no force pushes, linear history.
- Tag releases (`vYYYY.MM.DD-n`). Deploy only tags.

### 2.3 Worker deployment with an approval gate (`deploy-worker.yml`)
- Trigger: manual `workflow_dispatch` or a tag push.
- Environment `production` with **required reviewer: the owner**, and a wait timer if wanted.
- Steps:
  1. checks (§2.1);
  2. **schema guard:** read the database's latest migration with a read-only query and refuse if it is older than `EXPECTED_MIGRATION` (deploy order: migrate first);
  3. `npx wrangler deploy --message "<tag> <commit>"`;
  4. smoke test `/api/status`;
  5. on failure, print the exact `wrangler rollback` command; no automatic rollback without review.
- **No migrations in CI.** Production migrations stay manual through `npm run db:migrate` (Stage 3A gates). Moving them into CI would need its own approved design.

### 2.4 Scheduled backups (`backup.yml`): the architecture document §8, after owner approval
- Daily at 02:17 UTC, environment `backups`.
- Encrypted with the owner's public key; uploaded to off-Cloudflare, write-only, versioned storage.
- Manifest comparison against the previous day; failure emails; retention lifecycle.
- A monthly restore-drill reminder for the owner.

### 2.5 Cloudflare API tokens (least privilege, one per purpose)

| Token | Permissions | Used by |
|---|---|---|
| deploy | Account → *Workers Scripts: Edit*, limited to this account. Add *D1: Read* only if the schema guard needs it. No DNS, no zone settings. | `deploy-worker.yml` (environment `production`) |
| backup | Account → *D1* with the least permission that allows read queries. Confirm whether *Read* suffices for `d1 execute` with `SELECT`; otherwise *Edit*, limited to the account and stored only in environment `backups`. | `backup.yml` |
| owner (interactive) | `wrangler login` on the owner's machine | migrations, restores, rollbacks |

Tokens are stored as GitHub **environment** secrets, never in files, and rotated every 90 days.

### 2.6 Retire or repurpose the Pages workflow [Requires owner approval]
1. Confirm DNS serves the Worker (A5).
2. Change the Pages workflow to run only on manual dispatch.
3. After the owner confirms, delete it and unpublish the Pages site.

### 2.7 Other 3B items
- **`database_id` and `account_id`.** The migration gate warns while they are unpinned (Stage 3A.1). Add the owner-approved account ID and the production database's UUID to `wrangler.jsonc` (from `wrangler d1 list`), so `wrangler deploy` can never create or bind a different database by name.
- **Staging.** Add a staging environment (`env.staging` with its own D1 and Worker name) for release rehearsals with restored, anonymised data. That needs owner approval of data handling.
- **Files-only preflight.** Add `db:preflight --files-only` for CI (no database state).
- **Restore drill.** Turn the monthly restore drill into a checklist item with a recorded result.

## 3. State of the tooling (for the 3B engineer)

| Command | Purpose | Production use |
|---|---|---|
| `npm run db:schema` | Regenerate `db/schema.expected.json` (Wrangler, isolated) | — |
| `npm run db:backup` | Logical backup and manifest (plus `--encrypt-for`) | `--remote --owner-approved` (read-only) |
| `npm run db:restore:verify` | Restore into a new isolated D1 and run 10 checks; removes the copy and any decrypted SQL afterwards (`--keep` to inspect) | local only |
| `npm run db:compare` | Compare two manifests | verifies remote restores |
| `npm run db:decrypt` | Decrypt an encrypted backup, verified against its manifest | deliberate remote restore only |
| `npm run db:post-restore-sql` | Generate the exact post-restore security reset (3A.1) | restored database only |
| `npm run db:rollback-check` | Worker rollback verdict: SAFE / CHECK_REQUIRED / UNSAFE / PROHIBITED (3A.1) | read-only, identity-verified |
| `npm run db:state` | Capture migration state and schema | `--remote --owner-approved` (read-only) |
| `npm run db:preflight` | Fail-closed preflight and record | offline |
| `npm run db:rehearse` | Apply pending migrations to a restored copy and verify | local only |
| `npm run db:migrate` | **The only production migration route**: gate checks, dry run by default | `--execute`, owner only |

**Design constraints to keep:**
- `scripts/db/d1.mts` refuses remote writes and allows only read-only remote queries, and only with `ownerApproved`.
- Since 3A.1, **every remote target is pinned to an owner-approved account ID and D1 UUID**, proven live (account membership, UUID lookup, name→UUID lookup). The scheduled backup job in §2.4 must pass `--account-id` and `--database-uuid` from environment secrets, and fail if the proof fails.
- Imports and migrations go to isolated local targets only, and an isolated directory is never reused for a restore.
- The splitter refuses ambiguous SQL.
- The gate requires remote-sourced preflight state.

## 4. Risks Stage 3B must address
1. No backup has ever been taken of production. The **first owner action** after approval is a backup, a restore verification and Part A of the production checklist.
2. The production migration history and the deployed Worker version are unknown (checklist Part A).
3. The GitHub Pages workflow publishes an API-less copy on every push, with Node 20 and no security headers.
4. There is no CI gate before code reaches production; Worker deployment is manual and unrecorded.
5. There is no `database_id` pin in `wrangler.jsonc`.
6. D1 Time Travel is unverified.
7. Backups are not yet automated or stored off-platform.
8. Encrypted backups depend on the owner's private key: keep two offline copies.
9. Secrets needed for recovery (`MFA_ENCRYPTION_KEY` and others) must be stored by the owner outside Cloudflare.
