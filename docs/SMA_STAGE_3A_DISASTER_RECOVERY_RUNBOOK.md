# SMA Stage 3A: Disaster Recovery Runbook

Revised in Stage 3A.1 and Stage 3B (identity-bound execution), 22 November 2026.

**Status of this runbook:**
- **Local tooling** (backup, restore verification, two-phase comparison, post-restore reset SQL, rollback compatibility check, migration gate): **implemented and tested on isolated local databases.**
- **Every production step:** **requires Cloudflare account access and the owner's explicit approval.** None has been run.
- **Not tested at all:** Worker rollback, Time Travel and remote restore. They cannot be exercised without the Cloudflare account.

**Roles:**
- The **owner** (`bookebukar@gmail.com`) approves every destructive step in writing and runs the Cloudflare commands, or watches them being run.
- The **engineer** prepares and reviews but never approves.

---

## 1. Before anything else

1. **Stop and assess.** Do not retry a failed migration or deployment, and do not "fix" production data by hand.
2. **Set the production identity once per terminal.** The values come from the owner. They are never guessed and never committed.

   ```sh
   export SMA_ACCOUNT_ID=""   # owner fills in: the 32-character Cloudflare account ID
   export SMA_DB_UUID=""      # owner fills in: the D1 UUID of skillmountainacademy-db (discovery only, account-pinned: CLOUDFLARE_ACCOUNT_ID="${SMA_ACCOUNT_ID:?}" npx wrangler d1 list)
   ```

   Every command below uses `"${SMA_ACCOUNT_ID:?…}"` and similar, so it **refuses to run** while a value is empty.

   **Identity-bound execution (Stage 3B).** No production or recovery resource is reached with a bare `npx wrangler …` command. Wrangler chooses the account from the config's `account_id`, then `CLOUDFLARE_ACCOUNT_ID`, then **an account cached from an earlier session**; for D1 it uses the config's `database_id`, otherwise it looks the name up. A check followed by an unpinned command is therefore not safe. All operations go through `npm run db:*` or `npm run cf -- <operation>` (`scripts/cf.mts`), which:
   - prove the identity live: account membership; the UUID exists under the expected name; the name resolves to the same UUID; for Workers, the Worker exists in that account;
   - run Wrangler with a temporary config pinned to the account (plus the database UUID or the Worker name), **and** `CLOUDFLARE_ACCOUNT_ID` set to the same account;
   - change nothing without `--execute` and `--approved-by`.
3. **Take an evidence backup of the current, possibly damaged, state.** This is read-only on production. It may hold records written since the last good backup:

   ```sh
   npm run db:backup -- --remote --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database-uuid "${SMA_DB_UUID:?}" --encrypt-for "${SMA_KEY_PUB:?path to owner-backup-public.pem}"
   ```

## 2. Decide what happened

| Symptom | Likely cause | Go to |
|---|---|---|
| Errors right after `wrangler deploy`, database fine | Bad Worker version | §4 |
| Admin → Platform shows the database "behind" or "ahead" | Worker and schema out of step | §5 |
| Errors after a migration | Bad migration or damaged migration state | §7, then §6 |
| Records missing or wrong | Data error | §6 |
| Database deleted or unreachable; account problem | Loss of the database | §6.2 |

## 3. Register of destructive operations

Every operation in this table changes something that cannot simply be undone. **None may run without the owner's written approval.**

| Operation (section) | What it changes | Target | Reversible? | Backup required before | Verification after |
|---|---|---|---|---|---|
| Worker rollback (§4.5) | Which code serves all traffic | Worker `skillmountainacademy` | Yes: roll forward to the previous version id | Not a data operation; record the current version id first | §4.6 |
| Session reset after a rollback across 0008 (§4.5) | Ends every session; everyone signs in again | **Production** `auth_sessions` | No (sessions cannot be recreated); no record is lost | Evidence backup (§1.3) | `SELECT COUNT(*) FROM auth_sessions` returns 0 |
| D1 Time Travel restore (§6.1) | Rewinds the **whole** production database; every later write is lost | **Production** database | Only by another Time Travel restore within the window | Evidence backup (§1.3) **mandatory** | §6.4 |
| Import into a new database (§6.2 step 4) | Writes the backup into a **new, empty** database | **New** database `skillmountainacademy-db-restore-…` | Yes: delete the new database | Verified backup (§6.2 step 1) | Phase A (§6.2 step 5) |
| Post-restore security reset (§6.2 step 7) | Deletes sessions, invalidates unused sign-in links, adds one audit entry | **New** database only | No (by design) | Phase A passed | Phase B (§6.2 step 8) |
| Switch the Worker to the restored database (§6.3) | Production traffic uses the new database | Worker binding plus deployment | Yes: switch back to the old database id and redeploy | Both databases kept; nothing deleted | §6.4 |
| Production migration (production checklist, B8) | Applies pending migrations | **Production** database | **No** (there are no down-migrations) | Encrypted, restore-verified backup (gated) | Production checklist Part C |

## 4. Worker rollback

A lower expected migration number is **not** sufficient to approve a rollback. A migration can be additive in schema yet change data, behaviour, triggers, sessions or security in ways an older Worker does not understand. Each migration's effect on older Workers is recorded in `scripts/db/rollback.mts` and summarised in the preflight document (§7).

1. **Identify the deployed version** (read-only):

   ```sh
   npm run cf -- worker-deployments --owner-approved --account-id "${SMA_ACCOUNT_ID:?}"
   npm run cf -- worker-versions --owner-approved --account-id "${SMA_ACCOUNT_ID:?}"
   ```

2. **Choose the candidate.** It is the last known-good version, by upload time and message, cross-checked against `docs/upgrade/HANDOVER.md`.
3. **Find the candidate's expected migration:**
   - builds from Stage 3A onward: `EXPECTED_MIGRATION` in `src/server/schema-version.ts` at that commit;
   - older builds: the last file in `migrations/` at that commit.
4. **Run the compatibility check and write its record.** It reads the live migration history and runs read-only counts, identity-bound:

   ```sh
   npm run db:rollback-check -- --candidate-expected "${CANDIDATE_EXPECTED:?the candidate's last migration file name}" \
     --remote --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database-uuid "${SMA_DB_UUID:?}" \
     --version-id "${VERSION_ID:?the candidate version id from step 1}" --record backups/rollback-check.json
   ```

   | Verdict | Meaning | What may happen |
   |---|---|---|
   | **SAFE** | Same schema version; nothing crossed; at or above the security floor | Roll back (step 5) with the owner's approval |
   | **CHECK_REQUIRED** | Allowed only after the listed checks pass and the listed **actions** are done (for example, ending all sessions when crossing 0008) | Do the actions, re-run the check, then roll back |
   | **UNSAFE** | Not without an additional migration or code change, or the history is unknown | Do not roll back. Fix forward, or restore (§6). |
   | **PROHIBITED** | Crosses the **Stage 2C security floor** (candidate expects a migration before `0010_owner_integrity.sql`) | Never, unless the owner gives an explicit written exception (`--owner-security-exception "<owner name, date>"`). Even then the verdict is at best CHECK_REQUIRED, and the weaknesses fixed in Stages 2B and 2C return while that Worker runs. |

5. **Roll back.** ⚠ DESTRUCTIVE: changes live code; see §3. The operation refuses unless:
   - the record from step 4 is for this exact version id, the approved account **and the production D1 UUID** (Stage 3B.1), and under 2 hours old;
   - the verdict is SAFE, or CHECK_REQUIRED with the listed actions confirmed (`--actions-confirmed`).

   It always names the version explicitly, never an implicit "previous version". Run it once without `--execute` (dry run), then:

   ```sh
   npm run cf -- worker-rollback --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database-uuid "${SMA_DB_UUID:?}" --version-id "${VERSION_ID:?}" \
     --rollback-record backups/rollback-check.json --reason "${ROLLBACK_REASON:?short reason}" --approved-by "${SMA_APPROVER:?owner's full name}" --execute
   ```

   This does not touch D1, secrets or vars. When the check listed **ending all sessions** (always the case when 0008 is crossed), do it with the identity-bound operation. This is also in §3:

   ```sh
   npm run cf -- end-sessions --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database-uuid "${SMA_DB_UUID:?}" --approved-by "${SMA_APPROVER:?}" --execute
   ```

6. **Verify:**
   - Admin → Platform shows the schema status and no new errors.
   - Each role can sign in.
   - The owner console opens with the authenticator code.
   - A student sees their timetable.
   - Record the rollback (version ids, verdict, approver).

**If the database contains newer additive migrations:** the older Worker ignores the new tables and columns, and rows written by the newer Worker stay unused until it returns. The rollback check decides whether the **data and behaviour** differences matter. Never "undo" a migration, because there are no down-migrations.

## 5. Reconcile the Worker and the database

| Admin → Platform says | Meaning | Action |
|---|---|---|
| matches | Fine | — |
| database is behind | The Worker expects migrations that are not applied | Roll back (§4) to a Worker that the rollback check rates SAFE or CHECK_REQUIRED, or apply the pending migrations through the production checklist |
| database is ahead | The database has migrations this Worker does not know | Normal for a few minutes during a release (migrate first, deploy second). Otherwise deploy the matching Worker. |
| unknown | `d1_migrations` unreadable | §7 |

## 6. D1 recovery

**A restore is never a reverse migration.** It replaces the database's contents with an earlier copy, so every write since that copy is lost unless it is re-entered (payments, attendance, grades, messages, audit entries). Always:
1. take the evidence backup (§1.3);
2. compare what will be lost (`npm run db:compare -- <old manifest> <new manifest>`);
3. get the owner's written approval.

### 6.1 Recent mistake: D1 Time Travel (in place) [not tested]

This applies only if Time Travel has been verified for the account and the mistake is inside its window.

```sh
npm run cf -- time-travel-info --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database-uuid "${SMA_DB_UUID:?}"      # read-only: current bookmark and window
```

⚠ DESTRUCTIVE: rewinds the whole production database; see §3.

```sh
npm run cf -- time-travel-restore --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database-uuid "${SMA_DB_UUID:?}" --timestamp "${RESTORE_TIME:?ISO time before the mistake, agreed with the owner}" \
  --evidence-backup "${SMA_EVIDENCE:?the encrypted evidence backup from §1.3, under 2 hours old}" --approved-by "${SMA_APPROVER:?}" --execute
```

Then verify with §6.4.

### 6.2 Restore from an exported backup into a SEPARATE database (preferred for serious incidents)

**Never import a backup into the live database.** The SQL is meant for an empty database only.

1. **Verify the backup locally** (isolated; the copy and any decrypted data are deleted afterwards):

   ```sh
   npm run db:restore:verify -- "${SMA_BACKUP:?path to backups/<file>.sql.enc}" --key "${SMA_KEY_PRIV:?path to owner-backup-private.pem}" --report "${SMA_RESTORE_REPORT:=backups/restore-report.json}"
   ```

   It must print `RESTORE VERIFIED`. The report (bound to the backup's manifest by SHA-256) is required by the import in step 4.
2. **Create the new database** in the approved account (not destructive). The name must be `skillmountainacademy-db-restore-YYYYMMDD`. The operation reads the new UUID from Wrangler's output and **proves** it (it exists in the approved account under that name) before reporting it:

   ```sh
   export SMA_NEW_DB="skillmountainacademy-db-restore-$(date -u +%Y%m%d)"
   npm run cf -- d1-create-restore --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --name "$SMA_NEW_DB" --approved-by "${SMA_APPROVER:?}" --execute
   export SMA_NEW_UUID=""   # owner fills in: the createdUuid printed above
   ```

3. **Decrypt deliberately for the import.** The output is verified against the manifest. Keep it on an encrypted disk and delete it after step 4:

   ```sh
   npm run db:decrypt -- "${SMA_BACKUP:?}" --key "${SMA_KEY_PRIV:?}" --out "${SMA_PLAINTEXT:?a new path, e.g. /secure/restore.sql}"
   ```

4. **Import into the new database only.** ⚠ This writes to the **new** database; see §3. The operation refuses:
   - any database not named `skillmountainacademy-db-restore-…`;
   - any file whose SHA-256 differs from the backup's manifest;
   - a backup that is not a production backup of the approved account;
   - a missing, failed, older-than-24-hours or different-manifest restore verification report (Stage 3B.1).

   It runs pinned to the new UUID.

   ```sh
   npm run cf -- restore-import --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database "${SMA_NEW_DB:?}" --database-uuid "${SMA_NEW_UUID:?}" --file "${SMA_PLAINTEXT:?}" --manifest "${SMA_BACKUP_MANIFEST:?the original backup's .manifest.json}" --restore-report "${SMA_RESTORE_REPORT:?the report from step 1}" --approved-by "${SMA_APPROVER:?}" --execute
   ```

   Then delete `"$SMA_PLAINTEXT"`.
5. **Phase A: verify the import is IDENTICAL to the backup**, before any intentional change. Take a read-only backup of the new database, which proves its identity, then compare:

   ```sh
   npm run db:backup -- --remote --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database "${SMA_NEW_DB:?}" --database-uuid "${SMA_NEW_UUID:?}" --encrypt-for "${SMA_KEY_PUB:?}" --out backups/phase-a
   npm run db:compare -- "${SMA_BACKUP_MANIFEST:?the original backup's .manifest.json}" "${SMA_PHASE_A_MANIFEST:?the new backups/phase-a/*.manifest.json}"
   ```

   It must print **IDENTICAL** (same version, schema, triggers, and every table's rows and content hash). Otherwise stop.
6. **Owner and MFA checks** (read-only) on the new database:

   ```sh
   npm run cf -- d1-query --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database "${SMA_NEW_DB:?}" --database-uuid "${SMA_NEW_UUID:?}" --sql "SELECT o.user_id, u.email, u.role, u.status, u.removed_at FROM owner_record o JOIN users u ON u.id = o.user_id; SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name; SELECT COUNT(*) AS factors FROM mfa_factors; SELECT COUNT(*) AS codes FROM mfa_recovery_codes WHERE used_at IS NULL"
   ```

   Expected:
   - one owner row: `bookebukar@gmail.com`, `admin`, `active`, not removed;
   - the 4 triggers;
   - MFA counts equal to the manifest's `critical`.

   Authenticators keep working **only if `MFA_ENCRYPTION_KEY` is unchanged**. Otherwise administrators use recovery codes or the owner break-glass procedure (Stage 2C §4).
7. **Phase B: post-restore security reset.** ⚠ DESTRUCTIVE for the **new** database's sessions and unused sign-in links; see §3. Generate the exact SQL (no hand-edited placeholders), review it, then run it:

   ```sh
   npm run db:post-restore-sql -- --backup "${SMA_BACKUP:?}" --database "${SMA_NEW_DB:?}" --database-uuid "${SMA_NEW_UUID:?}" --approved-by "${SMA_APPROVER:?owner's full name}" --out backups/post-restore-reset.sql
   npm run cf -- restore-reset --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database "${SMA_NEW_DB:?}" --database-uuid "${SMA_NEW_UUID:?}" --file backups/post-restore-reset.sql --approved-by "${SMA_APPROVER:?}" --execute
   ```

   `restore-reset` refuses any file that is not an unmodified, generated reset for this UUID. The reset does exactly three things:
   - `DELETE FROM auth_sessions`;
   - marks unused `auth_tokens` as used;
   - inserts one `audit_log` entry, `action = 'system.restore'`. That entry has `actor_id` NULL (no application user is invented), `target_type 'database'`, `target_id` = the new UUID, and a detail holding the backup name and SHA-256, the approver's name and `approving_owner_user_id` read from the restored `owner_record`.

   It does **not** touch `owner_record`, `mfa_factors`, `mfa_recovery_codes` or `app_settings`. The owner signs in again by email link plus the authenticator code, or a recovery code, or break-glass. All tested.
8. **Phase B verification: only the intended differences.** The result is **not** identical to the backup, and must not be described as identical:

   ```sh
   npm run db:backup -- --remote --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database "${SMA_NEW_DB:?}" --database-uuid "${SMA_NEW_UUID:?}" --encrypt-for "${SMA_KEY_PUB:?}" --out backups/phase-b
   npm run db:compare -- "${SMA_PHASE_A_MANIFEST:?}" "${SMA_PHASE_B_MANIFEST:?the new backups/phase-b/*.manifest.json}" --post-reset
   npm run cf -- d1-query --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database "${SMA_NEW_DB:?}" --database-uuid "${SMA_NEW_UUID:?}" --sql "SELECT action, actor_id, target_type, target_id, json_extract(detail, '$.approving_owner_user_id') = (SELECT user_id FROM owner_record) AS owner_ok FROM audit_log WHERE action = 'system.restore'"
   ```

   - It must print `POST-RESET VERIFIED`. The only allowed differences: `auth_sessions` → 0 rows; `auth_tokens` same count with unused links invalidated; `audit_log` exactly one more row. Every other table, the schema and the version must be identical.
   - The audit query must return one row with `owner_ok = 1`.
9. Continue with §6.3.

### 6.3 Switch to the restored database

⚠ This changes production traffic; see §3.
1. The restored database's migration version must be ≤ the Worker's expected version. If it is older, apply the pending migrations to the new database through the production checklist first, with that database's UUID.
2. Set `database_id` = `"$SMA_NEW_UUID"` and `database_name` = `"$SMA_NEW_DB"` for the `DB` binding in `wrangler.jsonc`, then deploy the same Worker version under the Stage 3B deployment approval.
3. Keep the old database untouched as incident evidence until the owner decides.

### 6.4 Verify any restored or rewound database

- `db:compare`: Phase A IDENTICAL, Phase B only the expected differences (for Time Travel, compare against the evidence backup and review every difference).
- `owner_record` holds exactly one row: the owner, an active administrator. The 4 triggers are present.
- The latest `d1_migrations` entry is as expected. The manifest's `critical` figures (payments and instalment totals, attendance, graded submissions) are as expected.
- The owner signs in with the authenticator code, and one test user of each role signs in.
- Records written after the backup are re-entered from emails and payment-provider dashboards. Then take a fresh backup.

## 7. Damaged migration state

**Symptoms:**
- `d1_migrations` missing while tables exist;
- applied names not in `migrations/`;
- schema drift reported by the preflight;
- a failed `migrations apply`.

1. **Do not** edit `d1_migrations`, and **do not** re-run `migrations apply`.
2. Capture the state (read-only, identity-verified):

   ```sh
   npm run db:state -- --remote --owner-approved --account-id "${SMA_ACCOUNT_ID:?}" --database-uuid "${SMA_DB_UUID:?}" --out backups/damaged-state.json
   ```

3. Run `npm run db:preflight -- --state backups/damaged-state.json`. Its failures name the problem: unknown history, missing file, out of order, or the exact schema differences.
4. Take an evidence backup (§1.3).
5. **Preferred fix:** restore the last good backup into a new database (§6.2), apply pending migrations there through the checklist, then switch (§6.3).
6. Correcting `d1_migrations` is only ever proposed when the schema provably equals a known prefix, with zero drift. It needs a written analysis, a rehearsal on a restored copy and the owner's approval.

## 8. Records

Keep an incident log with:
- the time;
- the symptom;
- each action, and the section it came from;
- backups (file name and the SHA-256 from the manifest);
- verdicts and approvals, with names;
- the outcome.

After every incident, take a fresh verified backup and review the recovery objectives (architecture document §9).
