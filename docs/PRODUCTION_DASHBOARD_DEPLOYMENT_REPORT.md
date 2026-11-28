# Production Deployment Report: Skill Mountain Academy Dashboard Redesign

Date: 2026-11-28
Target: `skillmountainacademy.com` (Cloudflare Worker, production D1 `skillmountainacademy-db`)

## 1. Outcome

**DEPLOYMENT STOPPED. Nothing was deployed to production.**

I did not run any production command. Specifically:

- no `wrangler deploy`;
- no remote D1 query, backup, export or migration;
- no change to KV, secrets, environment variables, DNS or the Owner email;
- no emails sent;
- no payment operations.

The live site is in exactly the state it was before this brief.

The mandatory inspection triggered four of the brief's stop conditions (section 3). The brief says to stop rather than work around a blocker, so I stopped.

## 2. Pre-deployment inspection performed

| Check | Result |
|---|---|
| `git status` / commit history in `/home/claude/src/sma-site` | **Not a git repository.** There is no `.git`, no commit history and no record of which commit production runs. |
| Cloudflare credentials (`npx wrangler whoami`) | **Not authenticated.** There is no API token or account in this environment. |
| Established deploy path (`.github/workflows/deploy-worker.yml`) | Production deployment runs from GitHub Actions. It needs the owner-configured "production" environment, a required reviewer and the owner's typed approval name. It cannot be run from this workspace. |
| Deploy gate (`scripts/deploy/gate.mts`) | It reads the production `d1_migrations` table and **refuses** if the latest applied migration is not exactly `EXPECTED_MIGRATION`. |
| Build's expected schema (`src/server/schema-version.ts`) | `EXPECTED_MIGRATION = "0017_execution_fencing.sql"` |
| Production schema (from earlier stage records) | Migrations 0010–0017 have been applied only locally and on staging, **not in production**. |
| Backup procedure (`scripts/db/backup.mts`) | It needs `--remote --owner-approved --account-id … --database-uuid … --encrypt-for <public.pem>` and Cloudflare credentials. None of these are available to me. |
| Production config (`wrangler.jsonc`) | `OWNER_EMAIL` is `bookebukar@gmail.com`. I did not change it. |

## 3. Stop conditions triggered

**1. The dashboard changes cannot be safely isolated from unreviewed changes.**
- There is no git baseline, so there is no reliable diff between what production runs and the dashboard redesign.
- The working tree also contains all of Stages B through E.3, none of which has been deployed to production: institution and approvals routes, payment-release policy, invitations, execution fencing, the owner-transition tooling and others.
- The new admin dashboard (`app/app/admin-home.tsx`) calls Stage E and D.1.1 endpoints, such as `/api/app/admin/approvals` and `/api/app/admin/payments/attempts`. Those endpoints do not exist in the production Worker.
- Deploying this tree would therefore deploy unfinished, unreviewed functionality. The brief explicitly forbids that ("Do not deploy the entire working tree simply because it builds successfully").

**2. A migration would be required.**
- The build expects schema 0017. The Worker's schema gate and the deploy gate both compare against it.
- Payment and registration integrity checks depend on columns added in 0012–0014.
- The brief forbids applying 0010–0017. A Worker built from this tree would either be refused by the gate or run against a schema it does not expect.

**3. A recoverable production D1 backup cannot be created or verified.**
- The established procedure needs owner-held Cloudflare credentials, the D1 UUID and the owner's encryption public key. None are present, and I may not ask for secrets.
- Without a verified backup, the brief's backup requirement is not met.

**4. Rollback safety cannot be established.**
- With no record of the currently deployed commit or Worker version, I cannot name a known-good version to roll back to.

None of these was bypassed. I did not loosen security settings, raise the bundle limit, change the Owner identity, apply migrations or create credentials.

## 4. What would have been deployed (scope, for reference)

These dashboard-only UI files were reviewed in the Dashboard Redesign and Hardening stages:

- `app/app/shell.tsx`: sidebar layout.
- `app/app/dash.tsx`: shared dashboard components.
- `app/app/admin-home.tsx`: role-aware admin home.
- Dashboard edits in `app/app/student.tsx`, `app/app/instructor.tsx`, `app/app/admin.tsx`, `app/app/page.tsx` and `app/app/ui.tsx`.

## 5. Deliberately excluded (would not be deployed under any plan)

- Migrations 0010–0017, and any other pending migration.
- Stage E–E.3 server functionality:
  - departments, assignments, invitations and approvals;
  - approval and payment-release policies;
  - execution fencing.
- Any HR, advertising or content-publishing workflows.
- The owner email transition tooling (`src/server/owner-transition.ts`, `scripts/owner/transition-email.mts`). The production Owner remains `bookebukar@gmail.com`.
- The `.dev.vars.example` local `OWNER_EMAIL` override, which is local only.
- Paystack activation, R2 and real staff accounts.

## 6. Tests: production vs local

**Production tests executed: none.** Nothing was deployed, so there was nothing in production to test.

**Local verification**, from the Dashboard Final Hardening pass and unchanged since:
- Full suite: 455 tests, 454 pass, 1 fail, 0 skipped. The one failure is the known, pre-existing "3B.1 staging configuration … account_id is not pinned" test. It was kept visible, not weakened.
- TypeScript (both configs), ESLint, `db:check`, build, CSP check, secret scan and `npm audit` (0 vulnerabilities) all pass.
- Worker bundle is 368,119 bytes against the 368,640-byte (360 KiB) test budget, which leaves 521 bytes of headroom. The budget was not raised; that is Owner decision D-UI6.

## 7. Production state after this attempt

Unchanged:
- Worker version;
- D1 schema and data;
- KV;
- secrets and environment variables;
- DNS;
- Owner email (`bookebukar@gmail.com`).

No emails were sent and no payment transactions were created.

## 8. Recommended safe path (needs Owner approval and action)

1. **Establish the baseline.** Provide, or confirm in GitHub, the commit and Worker version currently live in production.
2. **Isolate the dashboard.**
   - Create a branch from that production commit.
   - Port only the dashboard UI files from section 4.
   - In `admin-home.tsx`, remove or feature-guard every call to an endpoint that production does not have, so those panels show "Not available yet".
   - Confirm `EXPECTED_MIGRATION` on that branch still equals the production schema. With no server changes, it will.
3. **Verify the branch.** Run the full local suite, the bundle-size check and the build. Get the branch reviewed, then open a PR so the required CI checks run.
4. **Back up D1 (Owner-run).**
   - Run `npm run db:backup -- --remote --owner-approved --account-id <id> --database-uuid <uuid> --encrypt-for <public.pem>`.
   - Verify the encrypted backup can be restored, for example with the restore-drill workflow.
5. **Deploy (Owner-approved).** Run the `deploy-worker.yml` workflow from the merged commit. The deploy gate will check identity and confirm the schema matches.
6. **Post-deploy checks.**
   - Check `/api/status`.
   - Log in as Owner (`bookebukar@gmail.com`) and as a staff member and a student, and look at each dashboard.
   - Confirm no Stage E routes are exposed.
7. **Rollback.** Because there are no schema changes, rollback is a Worker-only redeploy of the recorded previous version, for example `wrangler rollback <version-id>` by the Owner. No database restore is needed.

I can do step 2 locally (the isolated dashboard patch on a supplied production baseline) once the baseline is available.

## 9. Owner decisions outstanding

- D-E1–D-E13 and D-UI1–D-UI6 are still unresolved. D-UI6 is the bundle budget.
- New: provide the production git baseline, and approve the isolated-dashboard approach in section 8.

## 10. Status

Stopped and waiting for the Owner. No further development or production changes will be made until the Owner reviews this report.
