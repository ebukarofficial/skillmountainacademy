# SMA Stage 3B.2: Existing Deployment Workflow Alignment

Date: 22 November 2026. Scope: inspection and documentation only. Where this report and the Stage 3B/3B.1 documents differ, this report takes precedence.

**Owner's instruction.** The production route is intentional and stays:
1. local Git;
2. push to GitHub;
3. Cloudflare, connected to the repository, builds and publishes.

Nothing in Stage 3B.2 disconnects, replaces or adds a mandatory step to it.

## 1. The existing workflow and its verified status

| Item | Status | Evidence |
|---|---|---|
| The production domain is served by the Cloudflare Worker | **Verified (read-only)** | One request to `https://skillmountainacademy.com/api/status` returned the Worker's JSON (`ok: true`). |
| GitHub → Cloudflare publishing works and is publishing recent code | **Verified (read-only)** | The live `/api/status` contains a `schema` field. That field was added to `src/worker.ts` in Stage 3B (absent in the Stage 3A.1 package), so the live Worker was built from a recent push. |
| Paystack is off in production | **Verified (read-only)** | `ready.payments: false` |
| The exact Cloudflare build settings (build command, deploy command, production branch, build variables) | **Not verified** | Visible only in the Cloudflare dashboard. The repository documents: build `npm run build`, deploy `npx wrangler deploy`, `NODE_VERSION=22` (`docs/CLOUDFLARE-DEPLOY.md`). Owner read-only check: §5.1. |
| GitHub Pages conflicts with the live site | **No** | The domain is answered by the Worker. Pages publishes only its own `github.io` copy. Left in place, unchanged. |

## 2. Stage 3B deployment pieces: conflicts and complexity

| Piece | Effect on the owner's route | Assessment | Smallest safe adjustment |
|---|---|---|---|
| `.github/workflows/deploy-worker.yml` (tag-based, gated) | **None while dormant.** It runs only by manual dispatch, and only once a `production` GitHub environment and `CLOUDFLARE_DEPLOY_TOKEN` exist. | Unnecessary for this route. If ever configured *alongside* the integration, there would be two publishers. | Leave it dormant; it is now documented as optional and not the production route. Do not create its environment or token. Removing it later is optional. |
| `npm run deploy` (gate added in Stage 3B.1) | **Not on the route.** Cloudflare runs `npx wrangler deploy` directly, not `npm run deploy`. | It now needs release-tag and approval variables, so any manual laptop deployment would require the tag process the owner has declined. Older guides that say `npm run deploy` (for example the CSP-enforcement step) no longer work as written. | **Recommended (not executed):** restore the one line in `package.json` to `"deploy": "wrangler deploy"` in a normal commit. The gate remains available separately as `npm run deploy:gate`. Alternatively leave it; it affects nothing unless run. To enforce CSP on the route, set the Cloudflare build variable `CSP_MODE=enforce` (an owner decision). |
| `.github/workflows/ci.yml` | Runs on every push to `main`. **It does not block Cloudflare**, which builds independently. | Advisory only: a red CI run warns but publishing still happens. No conflict. | None. |
| GitHub protection guide (require PRs, approvals, required checks) | **Would block direct pushes to `main`.** A sole maintainer cannot approve their own pull request. | Conflicts with the route. | Do not apply those rules. If anything, only *block force pushes* and *restrict deletions* (the guide now says so). |
| `deploy:pin` (pins `account_id`, `database_id` and KV `id` in `wrangler.jsonc`) | Optional. If used, Cloudflare's builds use the pinned values too. | Exact values keep publishing working and stop Wrangler from auto-creating resources. A wrong value would break publishing. | Not required. Owner decision; if done, read the values from the dashboard and push as a normal commit. |
| `backup.yml`, `restore-drill.yml` | None: independent and inactive until `BACKUP_ENABLED=true` | No conflict | None |
| `cf.mts`, `db:migrate`, recovery tools | None: run by hand, owner-approved | No conflict | None |

## 3. How production D1 migrations are handled

- **`wrangler deploy` does not apply D1 migrations.** Verified in the installed Wrangler 4.156.0 source: the deploy and provisioning code contains no migration step. Migrations run only through `wrangler d1 migrations apply` or the gated `npm run db:migrate`.
- **The Cloudflare route is publishing code without migrating** (strong inference; the deploy command itself is unverified).
  - The live Worker expects `0010_owner_integrity.sql`, but production reports `0009_owner.sql` (`status: "database_older"`).
  - Had the deploy command applied migrations, 0010 would be in place.
  - Had it been the formerly suggested `npm run db:migrate && npx wrangler deploy`, the gated `db:migrate` (which refuses and exits 1 without approvals since Stage 3A) would have stopped the deploy, and the recent code would not be live.
- **Current production state (observation, not changed).** Migration 0010 is pending.
  - **What is affected:** the owner-integrity features report "migration required" and fail closed. That covers the `owner_record`-based owner console actions, such as appointing Super Administrators and approving permanent removals. The audit log's append-only protection triggers are also not installed.
  - **What is not affected:** students and the public site.
  - **How to apply it:** through the existing owner-approved procedure (`docs/SMA_STAGE_3A_PRODUCTION_MIGRATION_CHECKLIST.md`: backup, preflight, rehearsal, gated `npm run db:migrate --execute`). **Not run here.**
- **Still unknown:**
  - the exact Cloudflare deploy command;
  - who applied migrations up to 0009, and how.

## 4. Documentation changes made in Stage 3B.2 (documentation only)

- `docs/SMA_STAGE_3B_1_CLOSURE_AUDIT.md`:
  - F1 revised from Critical to **Informational**: the integration is intended, and only its commands need read-only recording;
  - F2 revised to **Low**: Pages does not serve the domain;
  - disconnect and replacement recommendations withdrawn.
- `docs/SMA_STAGE_3B_DEPLOYMENT_RUNBOOK.md`: §0 "disconnect first" removed; the workflow is marked optional and not the production route.
- `README.md`, `docs/CLOUDFLARE-DEPLOY.md`, `docs/upgrade/OWNER-CHECKLIST.md`: the Stage 3B.1 "superseded" notices are replaced by a note that the GitHub → Cloudflare route is the production route, that it publishes code only, and that migration commands must never be added to the deploy command.
- `docs/SMA_STAGE_3B_GITHUB_PROTECTION_GUIDE.md`: a note not to require pull requests, approvals or status checks on `main`.

No code, workflow, configuration or test file was changed in Stage 3B.2.

## 5. Minimum adjustments (recommendations; none executed)

1. **Owner, read-only (5 minutes).** In Cloudflare → Workers & Pages → `skillmountainacademy` → Settings → Build, record:
   - the connected repository and production branch;
   - the build command;
   - the **deploy command**: expected `npx wrangler deploy`, with no migration command;
   - the names (not values) of the build variables.

   If the deploy command contains `db:migrate` or `migrations apply`, tell me before the next push.
2. **Owner decision:** apply pending migration 0010 through the gated checklist, at a time you choose.
3. **Optional, one line:** restore `"deploy": "wrangler deploy"` in `package.json` if you want manual laptop deployments without the tag process.
4. **Do not** create the `production` GitHub environment or the deploy token, and do not apply the pull-request rules, unless you later choose the optional workflow.

## 6. Confirmation

- No deployment, migration, rollback or restore was run.
- Nothing was disconnected.
- DNS, hosting, Cloudflare settings, production D1 and KV, Paystack, R2, secrets and GitHub Pages were not touched.
- The only contact with production was one read-only `GET /api/status` on the public website.
- `wrangler.jsonc`, the workflows and all code are unchanged since the Stage 3B.1 package; only the documents in §4 changed.
