# SMA Stage 3B: Environment Separation (Local, Test, Staging, Production)

Date: 22 November 2026.

Status:
- **Designed, with the configuration and checks implemented and tested locally.** The isolation check and the anonymiser are tested; the anonymiser runs end to end on a local D1 copy.
- **No staging resource exists.** No staging Worker, database, namespace or secret was created; that needs the owner's separate approval.
- **Production configuration (`wrangler.jsonc`) is unchanged.**

## 1. The four environments

| | Local development | Automated tests / CI | Staging | Production |
|---|---|---|---|---|
| Worker | `wrangler dev` (local) | Miniflare in tests | `skillmountainacademy-staging` (workers.dev only) | `skillmountainacademy` |
| Config | `wrangler.jsonc` with `--local` | Test harness | **`wrangler.staging.jsonc`** | `wrangler.jsonc` (pinned by `deploy:pin`) |
| Database | Local D1 file | Fresh local D1 per test | `skillmountainacademy-staging-db` (own UUID) | `skillmountainacademy-db` |
| KV | Local | Local | Own namespace | Production namespace |
| Secrets | `.dev.vars` (never committed) | Test values in code | Staging-only values (`wrangler secret put … -c wrangler.staging.jsonc`) | Production values (owner only) |
| Data | Seed/test data | Generated fixtures | **Empty by default**; an anonymised copy only with approval | Real records |
| Schedule (cron) | n/a | n/a | **Off** | On |
| Email | Off unless a test key | Mocked | Off (no Resend key) unless a staging sender is approved | On |
| Payments | Paystack test keys only | Mocked | **Off** (no Paystack keys) | Off until the owner activates it |
| Domain | localhost | n/a | `*.workers.dev`, **no routes, no custom domain** | skillmountainacademy.com |
| Deployed by | Developer | n/a | Owner-approved manual command | `deploy-worker.yml` with the production gate |

## 2. Staging configuration and its check

`wrangler.staging.jsonc` is a separate file. It gives staging:
- its own Worker name;
- its own D1 database name;
- its own KV binding;
- no cron, no routes, `workers_dev: true`;
- empty production-specific settings and `ENVIRONMENT=staging`.

Its ids are left empty **on purpose**: the owner creates the resources and fills them in.

`npm run staging:check -- --production-uuid <prod D1 UUID> --production-kv <prod KV id>` (`scripts/deploy/staging-check.mts`) must pass before any staging deployment. It refuses the configuration when:
- the Worker or database name is production's, or lacks "staging";
- the D1 `database_id` is missing, not a UUID, or **equal to production's UUID**;
- the KV id is missing or **equal to production's**;
- the account is not pinned;
- there are routes or custom domains, cron schedules or an R2 binding;
- `SITE_URL` is empty, is production's, or is on `skillmountainacademy.com`;
- `OWNER_EMAIL` is the production owner address;
- there is a Paystack key, or `ENVIRONMENT` is not `staging`.

Stage 3B.1: when production's `wrangler.jsonc` does not pin a KV id, `--production-kv` is required, just as `--production-uuid` is.

As shipped, it reports the four unfilled ids and nothing else. That is the expected "not ready" state, tested in `tests/stage3b-gates.test.ts`.

## 3. Creating staging (owner, after separate approval)

Each step creates a Cloudflare resource, so each needs approval. In the account the owner chooses (a separate account isolates staging best):

```sh
npx wrangler d1 create skillmountainacademy-staging-db           # note the database_id it prints
npx wrangler kv namespace create skillmountainacademy-staging-cache
```

1. Paste both ids, and the account ID, into `wrangler.staging.jsonc`. Then:
   - deploy once to learn the workers.dev address, and set it as `SITE_URL`;
   - set a staging owner address (not a student's) as `OWNER_EMAIL`.
2. Run `npm run staging:check -- --production-uuid … --production-kv …` until it passes.
3. Apply migrations to the **staging** database only:
   ```sh
   npx wrangler d1 migrations apply skillmountainacademy-staging-db --remote -c wrangler.staging.jsonc
   ```
   This is the staging database by name, inside the staging config with its pinned `database_id`.
4. Set staging secrets with `-c wrangler.staging.jsonc`. Every value must be new and staging-only:
   - Turnstile test keys;
   - a new `HOLD_SIGNING_KEY`;
   - a new `MFA_ENCRYPTION_KEY`;
   - **no** `PAYSTACK_SECRET_KEY`;
   - no `RESEND_API_KEY` unless a staging sender is approved.
5. Build and deploy: `npm run build && npx wrangler deploy -c wrangler.staging.jsonc`.
6. Check `https://<staging>.workers.dev/api/status`, then set up the staging owner account.

The production deployment workflow cannot deploy staging (the gate requires the production names), and staging cannot be deployed by it.

## 4. Data in staging

**Default: no production records.** Staging starts empty, with migrations only, and test data is created through the application.

When realistic data is genuinely needed, the owner may approve an **anonymised copy** (`scripts/db/anonymise.mts`):

1. Choose a backup and download it with its manifest. It stays encrypted; the private key is used locally only.
2. Run:
   ```sh
   npm run db:anonymise -- --backup <file>.sql.enc --manifest <file>.manifest.json --private-key <owner-backup-private.pem> --out <new empty folder>
   ```
   The tool then works in four steps:
   - **Restore.** It restores the backup into an **isolated local** database with the full Stage 3A verification: checksums, manifest, schema and counts. It refuses a remote target outright.
   - **Rules.** It applies an explicit rule to **every column of every table**:
     - person-identifying fields get fake values (`Test`, `Person N`, `anon-…@staging.invalid`, `+000…`);
     - free text written by people becomes `[anonymised]`;
     - IP hashes, meeting links and file keys are cleared;
     - payment references are replaced;
     - sign-in links, sessions, two-step secrets, recovery codes, rate-limit keys, error records, payment-provider events and the owner record are emptied;
     - the IP-hashing key and the production owner bootstrap are removed from settings.

     If a migration adds a column without a rule, the tool **stops**, and a test fails.
   - **Triggers.** The append-only and owner-record triggers are dropped **only in the isolated copy**, then re-created exactly as the migrations define them. The test proves the audit log is append-only again afterwards.
   - **Verification.** It checks that:
     - no original value from a replaced column remains anywhere;
     - every email address left is in `staging.invalid`;
     - the emptied tables are empty;
     - the protective triggers exist.

     Only then does it write the anonymised SQL and manifest, plus `anonymise-report.json`.
3. Owner review of the report.
4. Import into the **staging** database only, after separate approval.
   - The copy contains the full schema and migration history, so it goes into a **new, empty** staging database (§3, skipping step 3) and never over an existing one.
   - Run `staging:check` first. Then:
     ```sh
     npx wrangler d1 execute skillmountainacademy-staging-db --remote --file <anonymised>.sql -c wrangler.staging.jsonc
     ```
5. Delete the local decrypted and isolated copies (`rm -rf <folder>/isolated`).

**What anonymisation keeps:** ids, dates, statuses, amounts, programme references, teaching content (courses, lessons, quizzes, resources) and the relationships between records. Staging therefore behaves like production.

**What it does not hide:** the *shape* of the data, meaning how many students, payments and enrolments exist and when. Treat an anonymised copy as internal and confidential, and delete it when no longer needed.

## 5. Known staging limitations (Stage 3B.1 audit)

- **Turnstile (resolved in Stage 3C).** A staging build supplies its own site key through the build variable `NEXT_PUBLIC_SMA_TURNSTILE_SITE_KEY`; production does not set it and keeps the key in `lib/config.ts`. The staging secret is set with `npx wrangler secret put TURNSTILE_SECRET -c wrangler.staging.jsonc`. See `docs/SMA_STAGE_3C_STAGING_AND_MIGRATION_REHEARSAL_REPORT.md`.
- **No automatic enforcement.** Nothing forces `npm run staging:check` before `npx wrangler deploy -c wrangler.staging.jsonc`. The owner runs it by hand (Stage 3C may wrap both in one command).
- **Quasi-identifiers.** Student and staff numbers are kept by the anonymiser, so staging behaves like production. Someone who knows a real student's number could still recognise that record. Treat anonymised copies as confidential.

## 6. Not done in Stage 3B

- No staging resources, secrets or deployments.
- No import of any data.
- No change to production configuration, DNS, routes, GitHub Pages, Paystack or R2.
