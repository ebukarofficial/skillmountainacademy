# SMA Stage 3C: Staging Preparation, Migration 0010 Rehearsal and Verification

Date: 22 November 2026.

**Production was not touched.** No deployment, migration, data change, DNS or setting change was made. The production publishing route (push to GitHub → Cloudflare builds and publishes) is unchanged. `wrangler.jsonc` and the GitHub workflows are unchanged.

## 1. Executive summary

- **No Cloudflare credentials exist in this environment** (no token, no Wrangler login). The real staging Worker, D1 database, KV namespace and Turnstile widget therefore could not be created. They are **REQUIRES OWNER APPROVAL**, with exact commands in §3.
- **Everything else ran locally** on isolated, staging-equivalent resources, with synthetic data only:
  - Wrangler local D1, the same tool and SQLite engine as Cloudflare D1;
  - the real Worker in workerd/Miniflare;
  - the staging configuration served by `wrangler dev`.
- **Migration 0010 rehearsal: PASS (local).** A staging database at 0009, exactly production's state, was:
  1. backed up;
  2. rehearsed with the approved tool;
  3. upgraded with `wrangler d1 migrations apply`;
  4. verified: the schema equals the expected schema; owner integrity and append-only audit protections work; every existing table's content is unchanged;
  5. rolled back by restoring the pre-0010 backup into a separate database, followed by the post-restore security reset.
- **The application was tested before and after 0010.** The current code on a 0009 database runs, but owner powers fail closed and the audit log is unprotected. After 0010 in place, the owner is recognised from the carried-over record, and the protections, groups, session revocation and access boundaries are enforced.
- **Defects found and corrected:**
  - **D1 (High):** the disaster-recovery post-restore reset failed on any backup taken before 0010, which is production's current state;
  - **D2 (Medium):** staging could not have its own Turnstile site key.
- **Full suite: 306 of 306 tests pass**, with type checks, lint, build, CSP, migration-file, secret and dependency checks all clean (§8).

## 2. Existing infrastructure inspected

| Item | Finding | Status |
|---|---|---|
| `wrangler.jsonc` (production) | Worker `skillmountainacademy`; D1 `skillmountainacademy-db` and KV binding, both without ids (resolved by Cloudflare); cron every 5 minutes; no routes in the file. **Unchanged.** | Inspected |
| `wrangler.staging.jsonc` (Stage 3B) | Separate Worker, database and KV binding; no routes; no cron; Paystack key empty; `ENVIRONMENT=staging`. Ids are intentionally empty until the owner creates the resources. | Inspected |
| Production build configuration in Cloudflare (build and deploy commands) | Not visible without dashboard access. Recorded as **unknown**. Documented as `npm run build` / `npx wrangler deploy` (Stage 3B.2). | Unknown |
| GitHub → Cloudflare production route | No file it depends on was changed. The only application change, `app/turnstile.tsx`, compiles to the same production behaviour (§4). | Unaffected |
| Existing staging resources in Cloudflare | None known. None can be listed without credentials. | BLOCKED |
| Production state (from Stage 3B.2, read-only) | Database at `0009_owner.sql`; the Worker expects `0010_owner_integrity.sql` | Known |

## 3. Staging resources

| Resource | Status | Exact action (owner, with their Cloudflare login) |
|---|---|---|
| Wrangler sign-in | **DONE** (22 Nov, owner) | `npx wrangler login` |
| Staging D1 | **DONE**: `8a25339e-9dd9-4adb-82da-2950b1905cf5` (WEUR) | `npx wrangler d1 create skillmountainacademy-staging-db --update-config=false`. **Always use `--update-config=false`**: Wrangler otherwise offers to write the binding into the production `wrangler.jsonc` (default answer Yes). |
| Staging KV | **DONE**: `57cc4f7a1ce6427d92ef9aa47f65a10d` | `npx wrangler kv namespace create skillmountainacademy-staging-cache --update-config=false` |
| Staging Turnstile widget | **OWNER ACTION, pending** | Dashboard → Turnstile → Add widget "SMA staging", hostname `skillmountainacademy-staging.ebuka-pascal-solomon.workers.dev`, mode Managed. Send the Site Key; keep the Secret Key private. |
| Account pin | **DONE**: `7d15b62fcb8a05a5611535061b690162` (the production account; the owner has only one) | In `wrangler.staging.jsonc` |
| Staging address | **DONE**: `https://skillmountainacademy-staging.ebuka-pascal-solomon.workers.dev` | `SITE_URL` in `wrangler.staging.jsonc` |
| Isolation check | **PASS** | `npm run staging:check -- --production-uuid 36fb8bde-5fbf-4b6e-9074-cb92775d0e7a --production-kv 2fe87bb433774953a671a2389a7e875c` prints **STAGING CONFIGURATION ISOLATED FROM PRODUCTION** |
| Staging secrets | REQUIRES OWNER APPROVAL | Each with `npx wrangler secret put <NAME> -c wrangler.staging.jsonc`: `TURNSTILE_SECRET` (staging widget), plus **new** values for `MFA_ENCRYPTION_KEY`, `HOLD_SIGNING_KEY` and `OWNER_RECOVERY_TOKEN`. **No** `PAYSTACK_SECRET_KEY`. |
| Staging owner address (`OWNER_EMAIL`) | **Owner decision, pending** | Any address the owner receives mail at that is not a student's (can be the owner's own Gmail; staging is a separate system) |
| Staging email (needed for sign-in links) | **Owner decision, pending** | Sign-in is by email link. Without `RESEND_API_KEY`, nobody can sign in on staging. Options: a Resend key restricted to a staging sender, or accept staging without sign-in. |
| Migrations | After the above | `npx wrangler d1 migrations apply skillmountainacademy-staging-db --remote -c wrangler.staging.jsonc`. This is the staging database by name, inside the staging config with its pinned `database_id`. |
| Build and deploy (staging route only) | After the above | `NEXT_PUBLIC_SMA_TURNSTILE_SITE_KEY=<staging site key> npm run build && npx wrangler deploy -c wrangler.staging.jsonc`. Then set `SITE_URL` to the printed `workers.dev` address and deploy again. |

None of these touches production. None changes the production publishing route.

**Progress record (22 Nov 2026, owner, from the owner's computer):**
- Wrangler signed in as bookebukar@gmail.com (one account, "Ebuka Pascal Solomon", `7d15b62fcb8a05a5611535061b690162`).
- Created, with `--update-config=false` so no config file was edited:
  - staging D1 `skillmountainacademy-staging-db` = `8a25339e-9dd9-4adb-82da-2950b1905cf5` (WEUR);
  - staging KV `skillmountainacademy-staging-cache` = `57cc4f7a1ce6427d92ef9aa47f65a10d`.

  Both are written into `wrangler.staging.jsonc`.
- Production identifiers, read-only from `d1 list` and `kv namespace list`, for the isolation check:
  - production D1 `skillmountainacademy-db` = `36fb8bde-5fbf-4b6e-9074-cb92775d0e7a`;
  - production KV `skillmountainacademy-kv` = `2fe87bb433774953a671a2389a7e875c`.
- `npm run staging:check -- --production-uuid … --production-kv …` passes every isolation check.
- Staging `SITE_URL` = `https://skillmountainacademy-staging.ebuka-pascal-solomon.workers.dev`. `staging:check` now prints **STAGING CONFIGURATION ISOLATED FROM PRODUCTION**.
- **Production hosting, confirmed from the owner's dashboard** (Worker `skillmountainacademy` → Domains): the custom domains `skillmountainacademy.com` and `www.skillmountainacademy.com` are attached to the **Worker** (Production). This settles Stage 3B.1 §10: the domain is not on GitHub Pages.
- **Informational:** the production Worker's `workers.dev` URL and its preview URLs (`*-skillmountainacademy.ebuka-pascal-solomon.workers.dev`) are publicly reachable. This is normal, and no action is taken. The owner may later restrict preview URLs with Cloudflare Access.

## 4. Staging environment configuration

**Completed:**
- **Staging Turnstile key (D2).** `app/turnstile.tsx`, a browser-only file never bundled into the Worker, now uses `NEXT_PUBLIC_SMA_TURNSTILE_SITE_KEY` when a build sets it, and otherwise the production key in `lib/config.ts`. Both builds were verified by inspecting their output:
  - **Production-equivalent build** (variable unset): the production key is present in 3 chunks and the test key in 0. The variable compiles to the same `process.env` lookup production already uses for `NEXT_PUBLIC_SHEET_URL`.
  - **Staging build** (Cloudflare's public always-pass test key `1x00000000000000000000AA`): the test key is inlined; CSP check PASS.
- **Staging bundle.** `npx wrangler deploy --dry-run -c wrangler.staging.jsonc` (nothing uploaded) bundled the Worker and 259 static files, with:
  - the binding `DB` → `skillmountainacademy-staging-db`, KV, AI and assets;
  - staging-only variables (`ENVIRONMENT=staging`);
  - **no routes, no custom domain, no cron, no Paystack key, no R2**.
- **Local staging Worker** (`wrangler dev --local -c wrangler.staging.jsonc`, with its own local D1 and KV and the staging test Turnstile secret). The results are in §7.

**Not changed:** `wrangler.jsonc`. `wrangler.staging.jsonc` has since been completed with the owner's ids (§3).

## 5. Migration 0010 rehearsal results

**Substrate.** Isolated local D1 (Wrangler 4.156.0) and the real Worker in Miniflare, with synthetic staging data. The data covers:
- an owner set up the Stage 2B way;
- a finance administrator and a legacy administrator;
- a student and an instructor;
- an enrolment and a class session;
- an MFA factor, live sessions and an unused sign-in link;
- old and new audit entries.

Evidence: `tests/stage3c-staging.test.ts`.

| # | Step | Result |
|---|---|---|
| C1 | Migration history: 9 applied, latest `0009_owner.sql`; pending exactly `[0010_owner_integrity.sql]`; no `owner_record` table, no triggers | **PASS** |
| C2 | Staging backup taken; file SHA-256 equals the manifest | **PASS** |
| C3 | Approved rehearsal tool (`rehearse`): restore → apply 0010 to the copy → from 0009 to 0010; migration file hash recorded | **PASS** |
| C3 | 0010 applied to the staging database itself with `wrangler d1 migrations apply`, the same mechanism the gated `npm run db:migrate` runs | **PASS** |
| C4 | Resulting schema identical to `db/schema.expected.json`; the 4 triggers present | **PASS** |
| C5 | Owner integrity: the Stage 2B set-up carried into `owner_record`; `UPDATE` and `DELETE` on it refused | **PASS** |
| C6 | Append-only audit log: `UPDATE` refused; deleting an entry younger than 365 days refused | **PASS** |
| C7 | Administrator groups: owner console for the owner only (with code); a legacy administrator cannot change groups; no self-promotion; the owner may regroup (with code); the owner cannot suspend themselves | **PASS** (application, after 0010) |
| C8 | Session revocation: a group change ends that administrator's sessions; an MFA reset ends sessions | **PASS** |
| C8 | Sessions created before the migration keep working after it (no forced sign-out of students) | **PASS** |
| C9 | Compatibility: every existing table's row content hash is unchanged by 0010; student, instructor and admin routes work; boundaries hold (student and instructor refused admin and owner routes; signed out → 401) | **PASS** |
| B1 | **Current code on a 0009 database (production today):** runs; `/api/status` reports `database_older`; owner status `migration_required`; owner set-up refused with **403**; the audit log can be **modified** (no database protection) | **PASS** (gap confirmed) |
| B2 | 0010 applied under the running Worker: status becomes `compatible`; the owner is recognised as `bootstrapped` without a second set-up; the protections take effect at once | **PASS** |
| C10 | Rollback by restoration (next section) | **PASS** |

**Rollback note.** 0010 has no "down" migration. Its rollback is restoring the pre-0010 backup into a separate database (Stage 3A §6.2), which was performed and verified (§6). Because 0010 is additive (one table plus triggers) and the rehearsal shows no data change, a Worker that does not expect 0010 would not need a rollback for compatibility.

## 6. Backup and restore results

| Check | Result |
|---|---|
| Backup created (timestamped `.sql` plus manifest) | **PASS** |
| Backup integrity: file SHA-256 = manifest; restore report bound to the manifest SHA-256 | **PASS** |
| Restore into a **separate** database with every Stage 3A check (checksums, schema, triggers, per-table counts and content hashes) | **PASS** |
| Restored data and schema: back at `0009_owner.sql`; 2 sessions and 1 unused link present (as in the backup) | **PASS** |
| Post-restore reset: all sessions ended, unused links invalidated, exactly one `system.restore` audit entry (actor NULL, target `database`, approving owner = the Stage 2B owner, the backup's SHA-256) | **PASS after correcting D1.** Before the fix, the reset **failed** on this backup. |
| Only the intended differences after the reset (`verifyPostReset`) | **PASS** |
| Backup age and failure reporting: the off-site shipping gate refuses this backup (plaintext, not production) | **PASS** (local). The scheduled job's age and failure alerting is untested on GitHub: NOT TESTED. |
| Restore into a real Cloudflare staging restore database | **BLOCKED** (no credentials). Also needs D3, §9. |

## 7. Security verification (local staging Worker over HTTP, plus Miniflare)

| Check | Result |
|---|---|
| Application build (production-equivalent and staging) | **PASS** |
| Worker deployment to Cloudflare staging | **BLOCKED** (credentials). The dry-run bundle passes. |
| Staging D1 connectivity: `/api/status` → `database: true`, schema `compatible` at 0010 after `migrations apply --local` | **PASS** |
| Staging KV connectivity: a value written through the staging `KV` binding is returned by the Worker (`/api/geo`) | **PASS** |
| API health: `/api/status` `ok: true`; Paystack `payments: false` | **PASS** |
| Security headers on pages: HSTS, CSP (`frame-ancestors 'none'`, `base-uri`, `object-src`, `form-action`), per-page report-only CSP with script hashes, `X-Frame-Options DENY`, `nosniff`, Referrer-Policy, Permissions-Policy; 37 header rules and 23 redirects parsed | **PASS** |
| Error handling: unknown page → 404 page; unknown API → JSON `not_found` 404 | **PASS** |
| Authentication refusals: signed-out admin route 401; `/api/me` 401; forged session cookie 401; cross-origin sign-in request 403 | **PASS** |
| Turnstile, live: the request reached the check, but this sandbox cannot reach `challenges.cloudflare.com`, so it was refused safely with `turnstile` 400 | **BLOCKED** (environment). Logic covered by mocked tests (PASS). |
| Authentication end to end (email link, MFA): Miniflare with a mocked email provider | **PASS**. On real staging: NOT TESTED (needs a staging email decision). |
| Student, instructor and administrator boundaries | **PASS** (C9 and the existing suites) |
| CI checks (`ci.yml` steps run locally) | **PASS** (§8). On GitHub runners: NOT TESTED. |

## 8. Automated test results (executed 22 Nov 2026)

| Check | Result |
|---|---|
| `tests/stage3c-staging.test.ts` (rehearsal, backup, restore, application) | **9 / 9 pass** |
| `npm test` (complete suite) | **306 tests: 306 pass, 0 fail**. A first full run had 2 failures in `db-restore-reset` caused by the first version of the D1 fix, which keyed only on the manifest's table list. Corrected to also use the backup's migration level; rerun clean. |
| `npx tsc` (both configurations) | PASS / PASS |
| `npx eslint .` | PASS |
| `npm run build` (production-equivalent) + `npm run security:csp -- --expect-mode report` | PASS; CSP CHECK PASSED (30 pages); production Turnstile key in 3 chunks, staging test key in 0 |
| `npm run db:check` (migration files) | MIGRATION FILES PASS (10 files) |
| `npm run security:secrets` | SECRET SCAN PASSED |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `actionlint` (all workflows) | No findings |

## 9. Defects discovered and corrected

| ID | Severity | Defect | Correction | Proof |
|---|---|---|---|---|
| D1 | **High** | `scripts/db/post-restore.mts` referenced `owner_record` unconditionally. On any backup taken before 0010 (**production's current state**), the generated reset failed with `no such table: owner_record`, so disaster-recovery Phase B could not complete. | For a pre-0010 backup (migration below 0010, and no `owner_record` in its manifest), the approving owner is read from the Stage 2B location (`app_settings.owner_bootstrap`). Unchanged for 0010+ backups. `cf.mts restore-reset` still accepts only the exact generated file. | 3C-C10 (failed before the fix, by direct reproduction); `db-recovery` and `db-restore-reset` suites still pass |
| D2 | Medium | Staging could not use its own Turnstile site key (Stage 3B.1 F16) | `NEXT_PUBLIC_SMA_TURNSTILE_SITE_KEY` build override, browser file only | §4 build inspection |
| D3 | Medium (open, Stage 3D) | `scripts/cf.mts` (identity-bound remote operations) only allows production and `skillmountainacademy-db-restore-*` names, so remote **staging** backup, restore and reset cannot go through it | Not changed in 3C (scope). Stage 3D: an explicit staging target with the same identity binding. | — |

**Test infrastructure (additive):** `tests/worker-harness.ts` gained `migrationsUpTo` and `applyPending()`, to start the real Worker on an older database state.

**Files changed in Stage 3C:**
- `app/turnstile.tsx`;
- `scripts/db/post-restore.mts`;
- `tests/worker-harness.ts`;
- `tests/stage3c-staging.test.ts` (new);
- `docs/SMA_STAGE_3B_ENVIRONMENT_SEPARATION.md` (one bullet: Turnstile resolved);
- `wrangler.staging.jsonc`: the owner's staging ids and address (after the first version of this report). `wrangler.jsonc` is unchanged.
- this report.

## 10. Outstanding blockers

**Resolved since the first version of this report** (22 Nov, owner):
- Wrangler sign-in;
- staging D1 and KV created;
- `wrangler.staging.jsonc` completed (account, database, cache, address);
- isolation check passing;
- production domain confirmed on the Worker.

**Still open:**
1. **Staging Turnstile widget** (owner, dashboard): Site Key to Claude; Secret Key kept private.
2. **Staging owner address** and **staging email decision** (a restricted Resend key, or staging without sign-in).
3. **How changes reach GitHub.** The owner's local `sma-site` folder is not a Git repository, so the route by which files such as `wrangler.staging.jsonc` reach GitHub must be confirmed. `wrangler.staging.jsonc` is safe to commit: no secrets, and ignored by the production build, which reads `wrangler.jsonc`.
4. **After 1–2:** staging secrets (entered by the owner), migrations on the staging database only, and the first staging deployment.
5. **D3:** identity-bound tooling for remote staging operations (Stage 3D engineering).
6. **Network:** live Turnstile and real Cloudflare behaviour cannot be exercised from this sandbox. They must be verified on real staging.

## 11. Production risks identified (no action taken)

1. **Production runs code that expects 0010 on a 0009 database** (B1 reproduces it).
   - The owner set-up and owner-only powers are refused.
   - The audit log has **no database-level tamper protection**.
   - Students and day-to-day administration are unaffected.

   The rehearsal shows 0010 is additive, preserves every existing row, and takes effect without signing anyone out. Applying it to production remains the owner's decision, through `docs/SMA_STAGE_3A_PRODUCTION_MIGRATION_CHECKLIST.md`.
2. **Before D1 was fixed, a restore of today's production backups would have failed at the security-reset step.** The fix lives in the operator tooling, not the Worker, so it applies once the owner's local checkout includes it.
3. **Whether production ever completed the Stage 2B owner set-up is unknown.**
   - If it did (an `app_settings.owner_bootstrap` row), 0010 carries it over and nothing more is needed (B2).
   - If not, the owner performs the one-time set-up, with the authenticator code, after 0010.

   The migration checklist's read-only state capture will show which applies.
4. **`app/turnstile.tsx` will reach production on the next push.** Its production behaviour is unchanged (verified build), but it is a code change, and the owner should know it is in the push.

## 12. Exact next steps for Stage 3D (recommended, not started)

1. **Owner:** create the staging resources and secrets (§3), decide on staging email, run `npm run staging:check`, then make the first staging deployment through the staging route only.
2. **Engineering (D3):** extend identity-bound tooling to an explicit staging target, so remote staging backup, restore and reset use the same account and UUID proof as production.
3. **Remote rehearsal on real staging D1:**
   1. apply migrations 0001–0009;
   2. load synthetic data;
   3. take an encrypted backup;
   4. apply 0010;
   5. verify;
   6. restore into a staging restore database;
   7. run the post-restore reset;
   8. verify sign-in, MFA, Turnstile and boundaries live.
4. **Owner decision:** after a successful remote rehearsal, schedule production migration 0010 through the gated checklist (backup → preflight → rehearsal → `npm run db:migrate --execute`).
5. **Optional:** wrap `staging:check`, the staging build and the staging deploy in one command, so staging deployments cannot skip the isolation check.

Stage 3C stops here for owner review.
