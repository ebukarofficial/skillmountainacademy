# SMA Stage 3A: Production Migration Checklist

Revised in Stage 3A.1, 22 November 2026.

**Status:** owner actions for later. Every step requires Cloudflare account access and the owner's approval. **Nothing here has been run.**

**The production migration history is UNKNOWN** until the owner performs Part A. Do not assume that 0007, 0008, 0009 or 0010 have, or have not, been applied.

**Prerequisites:**
- Run from a clean checkout of the approved commit, with `npm ci` done and `npx wrangler login` completed as the owner.
- Values the owner supplies go in shell variables. Every command refuses to run while one is empty (`${VAR:?}`).

## Part A: establish identity and history (read-only)

### A0. Production identity (first, always)

```sh
npx wrangler whoami                         # the signed-in user and the accounts it can use
npx wrangler d1 list                        # find skillmountainacademy-db and its UUID
```

The owner confirms, and **records in writing**, the two values:

```sh
export SMA_ACCOUNT_ID=""   # owner fills in: 32-character Cloudflare account ID
export SMA_DB_UUID=""      # owner fills in: UUID of skillmountainacademy-db
```

Every later tool **proves** them live before reading anything:
1. the user is a member of that account;
2. that UUID exists there and is named `skillmountainacademy-db`;
3. the name resolves to that same UUID.

A mismatch, a missing value or an unresolved identity fails closed. A matching name never overrides a different UUID.

### A1. Migration history and schema (identity-verified, read-only)

```sh
npm run db:state -- --remote --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database-uuid "${SMA_DB_UUID:?}" --out backups/prod-state.json
```

This prints the table count, total rows and the applied migrations, or `UNKNOWN (no d1_migrations)`. The file records the verified identity and the capture time, but no row data.

### A2. Stage 2C objects and owner set-up (read-only)

```sh
npx wrangler d1 execute skillmountainacademy-db --remote --command "SELECT type, name FROM sqlite_master WHERE name IN ('owner_record','staff_removal_requests','mfa_factors','mfa_recovery_codes','app_settings') OR type = 'trigger' ORDER BY type, name"
```

If `owner_record` is listed:

```sh
npx wrangler d1 execute skillmountainacademy-db --remote --command "SELECT o.email, o.bootstrapped_at, u.role, u.status FROM owner_record o LEFT JOIN users u ON u.id = o.user_id"
```

If `app_settings` is listed:

```sh
npx wrangler d1 execute skillmountainacademy-db --remote --command "SELECT key, updated_at FROM app_settings WHERE key IN ('owner_bootstrap','owner_policy')"
```

These `wrangler d1 execute` commands resolve the database **by name**. Run them only right after A1 has verified that the name resolves to `$SMA_DB_UUID`.

### A3. Consistency and pending list (offline)

```sh
npm run db:preflight -- --state backups/prod-state.json --record backups/preflight/prod-inspection.json
```

Without a backup it fails if anything is pending; that is expected here. Read:
- the applied and pending lists;
- any `history:` or `schema:` failures;
- any `review:` failures, which are owner decisions for 0002, 0004 or 0007 if pending.

### A4. Deployed Worker

```sh
npx wrangler deployments list --name skillmountainacademy
npx wrangler versions list --name skillmountainacademy
curl -s https://skillmountainacademy.com/api/status        # JSON from the Worker; GitHub Pages would answer 404 HTML
```

### A5. Interpret

| Finding | Next step |
|---|---|
| `UNKNOWN (no d1_migrations)` but tables exist | **Stop.** The engineer analyses the schema against each prefix and proposes a reviewed plan. |
| `schema:` differences, or applied names not in the repository | **Stop.** Runbook §7. |
| Applied list = a clean prefix | Part B for the pending list |
| `owner_record` + 4 triggers present | Stage 2C database; nothing pending for 2C |
| `owner_bootstrap` in `app_settings`, no `owner_record` | Stage 2B set-up; 0010 will carry it into `owner_record` (rehearsal shows `owner_record (1 rows)`) |

**Send** the A1 summary, the A3 record and the A4 output to the engineer for review. Do not send backups.

## Part B: apply pending migrations

Run Part B only after Part A has been reviewed and the owner has approved the migration.

| # | Step | Command | Pass criteria |
|---|---|---|---|
| B0 | Prerequisites | — | Part A reviewed. Owner decisions recorded in `db/migration-reviews.json` for any pending 0002, 0004 or 0007. Backup key pair exists (`SMA_KEY_PUB`, `SMA_KEY_PRIV`). Quiet time (not minutes :00–:02, not 05:00 UTC). |
| B1 | Fresh state | `npm run db:state -- --remote --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database-uuid "${SMA_DB_UUID:?}" --out backups/prod-state.json` | Identity verified. Applied list as in Part A. **Under 2 hours old at B4.** |
| B2 | Encrypted backup of the same database | `npm run db:backup -- --remote --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database-uuid "${SMA_DB_UUID:?}" --encrypt-for "${SMA_KEY_PUB:?}"` | `.sql.enc` and manifest written. The manifest records the same identity and the same migration as B1. |
| B3 | Restore verification | `npm run db:restore:verify -- "${SMA_BACKUP:?the .sql.enc from B2}" --key "${SMA_KEY_PRIV:?}"` | `RESTORE VERIFIED`. The report is bound to the exact file and manifest hashes. |
| B4 | Preflight on the remote state | `npm run db:preflight -- --state backups/prod-state.json --backup "${SMA_BACKUP:?}"` | `PREFLIGHT PASS`. It refuses local state, state without a verified identity, a backup of another account or UUID, an unencrypted backup, a backup at another migration version, or a replaced backup or manifest. |
| B5 | Rehearsal on the same backup | `npm run db:rehearse -- "${SMA_BACKUP:?}" --key "${SMA_KEY_PRIV:?}"` | `REHEARSAL PASSED`. The report records the backup and manifest hashes and every migration file's hash. Read each `REVIEW data changed in …` line. |
| B6 | Owner review | Read the B4 record and the B5 report | Owner agrees in writing |
| B7 | Gate, dry run | `npm run db:migrate -- --preflight "${SMA_PREFLIGHT:?backups/preflight/<B4 record>.json}" --rehearsal "${SMA_BACKUP:?}.rehearsal.json" --approved-account-id "${SMA_ACCOUNT_ID:?}" --approved-database-uuid "${SMA_DB_UUID:?}" --confirm-database skillmountainacademy-db --approved-by "${SMA_APPROVER:?owner's full name}"` | "All gates passed (identity verified live). Dry run only." |
| B8 | **Production migration** ⚠ irreversible | the B7 command plus `--execute`; answer Wrangler's prompt | "Migration command finished" |
| B9 | Post-migration checks | Part C | All pass |

**The gate (`npm run db:migrate`).** The dry run and `--execute` run **identical** checks. The gate:
- requires the approved account ID and UUID to match the preflight state, the backup, and `wrangler.jsonc` if it pins them;
- proves the identity **live**, and re-reads the production migration history live, which must equal the preflight's;
- re-hashes the backup and manifest;
- refuses any migration file that differs from the preflighted or the rehearsed one;
- refuses a preflight older than 2 hours or a rehearsal older than 24 hours;
- refuses without `--confirm-database skillmountainacademy-db` and a named approver.

It applies the migrations through a temporary configuration **pinned to the approved account ID and UUID**, and writes an approval record holding the identity and no secrets.

**If B8 fails:** do not retry blindly. Capture state (B1), run the preflight on it, and follow runbook §7. The B2 backup is the recovery point.

## Part C: after migrating

1. Run `npm run db:state -- --remote --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database-uuid "${SMA_DB_UUID:?}" --out backups/post-state.json`. The latest migration must equal the Worker's `EXPECTED_MIGRATION`, which at Stage 2C is `0010_owner_integrity.sql`.
2. Run `npm run db:preflight -- --state backups/post-state.json`. It must PASS with nothing pending and no schema failures.
3. Re-run the A2 queries: `owner_record` is present and the 4 triggers are listed.
4. Deploy the matching Worker, under the Stage 3B approval gate, **after** the migration. Admin → Platform then shows "(matches)".
5. Take a fresh encrypted backup and verify it (B2 and B3). This is the post-migration recovery point.
6. Record the time, the backup name and SHA-256, the identity, the approver and the migrations applied.
