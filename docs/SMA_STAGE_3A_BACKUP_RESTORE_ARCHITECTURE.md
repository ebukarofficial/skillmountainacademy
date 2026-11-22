# SMA Stage 3A: Backup and Restore Architecture

Date: 22 November 2026. Revised in Stage 3A.1 (identity flags; recovery objectives withdrawn pending the owner's decision).

**Scope:**
- Production database `skillmountainacademy-db`, D1 binding `DB`.
- Worker `skillmountainacademy`.

**Status labels used throughout:**
- **[Implemented + tested locally]**: built and exercised against isolated local D1 databases.
- **[Documented, not implemented]**
- **[Requires Cloudflare access]**
- **[Requires owner approval]**
- **[Not tested]**

Nothing in Stage 3A touched production:
- no deployment, migration or export;
- no secret or DNS change;
- no Paystack or R2 activation.

---

## 1. What the repository had (inspection)

**Inspected**
- `wrangler.jsonc`, `package.json`, `migrations/0001–0010`, `src/worker.ts`, `src/server/cron.ts`, `src/server/env.ts`
- `.github/workflows/deploy.yml`
- `tests/` (harness, 26 files), `db/`
- `scripts/` (including the partly built `scripts/db/` tools found at the start of this stage)
- `.gitignore`
- the Stage 2, 2B and 2C reports, `docs/upgrade/OWNER-CHECKLIST.md`, `docs/upgrade/HANDOVER.md`

| Area | Finding |
|---|---|
| D1 | One database, `skillmountainacademy-db`, binding `DB`, `migrations_dir: migrations`. **No `database_id` in `wrangler.jsonc`**: Wrangler resolves the database by name, and `wrangler deploy` would create one if none exists. No staging or preview database. |
| KV / AI / R2 | `KV`: exchange-rate cache only. `AI`: Workers AI. `BUCKET` (R2): **commented out, unbound**. |
| Cron | `*/5 * * * *`. Class reminders every run. Exchange rates 05:00/17:00 UTC. Instalments, sessions and retention at 05:00 UTC. |
| Migrations | 10 files, `0001`–`0010`, consecutive. `0010` contains four `CREATE TRIGGER … BEGIN … END` blocks. `0003` contains an FTS5 virtual table (`resource_chunks`). |
| Migration scripts | `npm run db:migrate` was `wrangler d1 migrations apply … --remote`, with **no checks at all**. `db:seed-sql` generates programme SQL. |
| Backup scripts | None wired into `package.json`. Only manual `wrangler d1 export` advice in earlier reports, and **that command does not work for this database** (§2). |
| Environment separation | None. Production only. Tests use Miniflare in-memory D1 with their own migration runner (`tests/worker-harness.ts`, already trigger-aware since Stage 2C). |
| Foreign keys | Declared with `REFERENCES` throughout (for example `orders.registration_id`, `instalments.order_id`, `payments.order_id/instalment_id`, `enrolments.student_id/instructor_id`, `owner_record.user_id`). D1 enforces foreign keys. |
| CI | `.github/workflows/deploy.yml` deploys the static export to **GitHub Pages**, not Cloudflare (see the Stage 3B handover). |

The partly built `scripts/db/` tools found at the start were kept, reviewed line by line and completed. No second system was created.

**Gaps found and fixed during review:**
1. **Production gate.** The gate accepted a preflight made from a *local* copy, because local copies carry the production database's name. It now requires state captured from the remote database.
2. **Stale state.** There was no age limit on captured state; it now has a 2-hour limit.
3. **"No records" check.** It could never fire on a real database, because migrations seed reference rows. It is now based on a formal data classification (§4).
4. **Wrong target.** A database with no tables at all was accepted as a valid backup source; it is now refused.
5. **Node types.** `import.meta.main` is not typed by the project's Node 20 type definitions, so the repository's existing main-module check is used instead.
6. **Schema version.** The Worker exposed no expected schema version; it now does (§6 of the preflight document).

## 2. Why a logical backup tool, not `wrangler d1 export`

Running `wrangler d1 export` against an isolated copy of this database fails with:

> `D1 Export error: cannot export databases with Virtual Tables (fts5)`

This was verified locally on 22 Nov 2026. Cloudflare documents the same limitation for remote exports. Its workaround is to drop the virtual table first, which would be a production change.

`resource_chunks` (FTS5, the learning-assistant search index) therefore makes the native export unusable. The repository's own tool, `scripts/db/dump.mts`, reads everything through ordinary **read-only `SELECT`** statements instead.

## 3. Manual backup [Implemented + tested locally]

**Command:**

```sh
npm run db:backup -- --local-dir <isolated-dir> [--out backups/] [--encrypt-for owner-backup-public.pem]   # local / test
npm run db:backup -- --remote --owner-approved --account-id <owner-supplied account ID> --database-uuid <owner-supplied D1 UUID> --encrypt-for owner-backup-public.pem   # production [Requires Cloudflare access] [Requires owner approval]
```

**What it writes:**
- `backups/skillmountainacademy-db-<UTC yyyymmddThhmmssZ>-m<NNNN>.sql`
  - The timestamp is UTC; `NNNN` is the latest applied migration.
  - The file name holds no data and no credentials. The file mode is `0600`.
- **SQL content, in order:**
  1. `PRAGMA defer_foreign_keys = TRUE`;
  2. every `CREATE TABLE`, including `d1_migrations` and the FTS5 table (its shadow tables are left out because SQLite recreates them);
  3. every row of every table, in rowid order, including `owner_record`, `audit_log`, `mfa_factors`, `mfa_recovery_codes` and `staff_removal_requests`;
  4. every index;
  5. every trigger, last.
- **`<file>.manifest.json`**:
  - format, creation time, source (local/remote and database name);
  - migration version and count;
  - full schema;
  - per table: row count, column list and SHA-256 of all rows;
  - per class (§4): table and row counts, and institutional row count;
  - critical figures: owner record, audit log, users by role, enrolments, timetables, classes, attendance completed/missed, assignments, submissions graded, quiz attempts, orders, instalments and payments (counts and kobo totals), webhook events, registrations, messages, notifications, MFA factors and codes, removal requests;
  - triggers;
  - file size and SHA-256.

  **The manifest contains no data values**: a test checks that the MFA secret, recovery-code hashes, names, emails and removal reasons never appear. It can be shared for review.

**Built-in checks:**
- Refuses a database with no tables (wrong target).
- Refuses BLOBs, integers beyond 2^53 and `WITHOUT ROWID` tables, rather than writing a lossy file.
- Refuses non-FTS5 virtual tables.
- Refuses if a table's row count changes while it is being read; the operator must retake the backup.
- Warns when there are no institutional records.
- Warns if a single row is over 100 KB, which a remote import may refuse.

**A backup is not trusted until its restore is verified:** `npm run db:restore:verify -- <file>` (section 5).

**Consistency limitation:** tables are read in batches, not inside one transaction. The changed-row-count check catches inserts and deletes during the read, but not updates.
- Take production backups when the platform is quiet.
- Avoid minutes :00–:02 of each hour (cron) and 05:00 UTC (daily jobs).
- For a guaranteed point-in-time copy, combine with D1 Time Travel (§7) once it has been verified.

**What a backup does NOT contain:** secrets, which live in Wrangler and not in D1:
- `MFA_ENCRYPTION_KEY`: without it, the restored `mfa_factors` secrets cannot be decrypted, and administrators must use recovery codes or a reset;
- `IP_HASH_SALT`, `RESEND_API_KEY`, `TURNSTILE_SECRET`, `HOLD_SIGNING_KEY`, `OWNER_RECOVERY_TOKEN`.

The owner must keep these in a password manager, separately from the backups. Uploaded files (R2) are not in D1. R2 is unbound today, so there are no files to back up yet.

## 4. Backup classification [Implemented + tested locally]

The source of truth is `scripts/db/classification.mts`. A test fails if any table in the expected schema is unclassified, and checks that the disposable class contains exactly the four operational tables. **Every table is backed up in full**; the class describes the impact of loss and how the data is handled.

| Class | Tables | Treatment |
|---|---|---|
| Identity | `users` (including removed staff), `registrations`, `id_sequences` (issued numbers; loss could reissue numbers), `instructor_programmes` | Critical, confidential |
| Academic | `enrolments`, `timetables`, `class_sessions` (**attendance** = `status` completed/missed), `assignments`, `submissions` (**grades** = `score`, `graded_at`), `quizzes`, `quiz_attempts` (assessment history), `lesson_progress`, `weekly_items`, `courses`, `lessons`, `resources`, `resource_chunks` (FTS5 index), `instructor_ratings` | Critical, permanent record |
| Financial | `orders`, `instalments`, `payments`, `webhook_events` (prevents double crediting), `holds` | Critical; legal and accounting retention |
| Admissions | `programme_admissions`, `admission_periods`, `call_bookings`, `assistant_enquiries`, `children_enquiries` | Important, confidential |
| Communications | `messages`, `notifications`, `ai_messages`, `contact_log` | Important, confidential |
| Security | `audit_log`, `owner_record`, `mfa_factors` (encrypted secrets), `mfa_recovery_codes` (hashes), `staff_removal_requests`, `app_settings` (owner policy, retention, used recovery tokens) | Critical; integrity-protected |
| Reference | `programmes` (catalogue), `d1_migrations` (schema version: required to know what a database is) | Required for restore |
| **Disposable** | `auth_tokens`, `auth_sessions`, `rate_limits`, `error_log` | Safe to lose. Still backed up. **After a restore, sessions are cleared** (runbook §6.2 step 7) so restored session hashes cannot be reused. |

"Institutional records" are rows in every class except reference and disposable, excluding migration-seeded tables. A backup with zero institutional records is flagged, and the preflight refuses it unless the operator passes `--allow-empty-backup`.

## 5. Restore verification [Implemented + tested locally]

```sh
npm run db:restore:verify -- backups/<file>.sql            # or <file>.sql.enc --key owner-backup-private.pem
```

This always restores into a **new, empty, isolated local D1** in its own temporary directory. It refuses any directory that already holds a database, and it never touches production. For encrypted backups, the decrypted SQL is deleted immediately after import. The restored copy holds confidential records, so it is removed when verification ends unless `--keep` is given for inspection. The report (`<file>.restore-report.json`) is PASS only if every check passes:

| # | Check | Detail |
|---|---|---|
| 1 | integrity | File SHA-256 equals the manifest. Encrypted files: the ciphertext hash, then authenticated decryption. |
| 2 | import | `wrangler d1 execute --local --file` into the empty database, without errors |
| 3 | schema | Every table, index, view and trigger identical (normalised SQL) to the backup |
| 4 | triggers | `owner_record_no_update`, `owner_record_no_delete`, `audit_log_no_update`, `audit_log_min_retention` present |
| 5 | foreign keys | `PRAGMA foreign_key_check` reports no violations |
| 6 | records | Every table: same row count **and** same SHA-256 of rows (identical content) |
| 7 | critical | All critical figures identical, including `owner_record` → an existing administrator, `audit_log`, `users`, `enrolments`, `class_sessions` (attendance), `assignments`, `submissions` (grades), `orders`, `payments`, `instalments`, `webhook_events`, `mfa_factors`, `mfa_recovery_codes` |
| 8 | search index | FTS5 `integrity-check` on `resource_chunks` |
| 9 | migration history | `d1_migrations` restored, same latest version |
| 10 | compatibility | Restored schema vs `db/schema.expected.json`: `compatible` / `older_schema` (lists pending) / `newer_schema` / `schema_drift` / `unknown` |

**Executed** (tests in `tests/db-recovery.test.ts`, all passing):
- A seeded database was backed up and restored with every check passing. Awkward text (quotes, semicolons, `--`, `/*`, `END;`, Unicode, multi-line, a 5,600-character message) survived byte for byte.
- After the restore, direct queries returned the owner, the payment, the grade, the full-text search hit and the removed-staff reason.
- In the restored copy, an `UPDATE audit_log` and a `DELETE FROM owner_record` were still refused, so the protections survived the restore.
- An encrypted backup restored only with the matching key: a missing key and a wrong key were both refused.
- A backup with no institutional records was flagged, and the preflight refused it.
- A database with no tables was refused.
- A truncated file failed the checksum.
- A "consistent-looking" incomplete file, whose manifest hash had been regenerated, failed four checks: schema, triggers, counts and critical figures.
- Corrupt SQL failed the import.
- A restore over an existing database was refused.
- A database at 0009 was reported as `older_schema` with 0010 pending.
- Verification by manifest comparison (`npm run db:compare`) reported a restored copy as identical and pinpointed a single added row.

## 6. Encryption, access and storage

**[Implemented + tested locally]** `--encrypt-for <public.pem>`:
- Each backup gets a fresh AES-256-GCM key, wrapped with the owner's RSA public key (RSA-OAEP-SHA-256).
- The plaintext is deleted and the manifest records the ciphertext hash.
- The **private key never leaves the owner's control** (offline, password manager or hardware key). The machine producing backups needs only the public key.

Generating the key pair is an owner action:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out owner-backup-private.pem
openssl pkey -in owner-backup-private.pem -pubout -out owner-backup-public.pem
```

- **In transit:** Wrangler talks to the Cloudflare API over HTTPS. Copies to off-platform storage must also use HTTPS or SFTP.
- **Access:** `backups/` and `*.sql.enc` are git-ignored, and files are written with mode `0600`. Backups hold every student's identity, grades and payments: only the owner, plus one named deputy if approved, may hold decryption keys.
- **Never in reports or logs:** tool output shows only file names, sizes, counts and checksums. Wrangler error messages are reduced to their first line, with no SQL or data echoed.

## 7. D1 Time Travel [Requires Cloudflare access] [Not tested]

Time Travel is Cloudflare's point-in-time recovery for D1. Stage 3A **did not verify** that it is available or configured for this account. The owner checks it read-only with:

```sh
npx wrangler d1 time-travel info skillmountainacademy-db
```

**Limitations to plan around:**
- **Restores in place:** it rewinds the *whole* database, discarding every write after the chosen point (payments, attendance, audit entries). It cannot restore one table or one row.
- **Window:** the retention window depends on the Cloudflare plan and must be confirmed for this account. Outside the window there is nothing to restore.
- **Not independent:** it lives in the same Cloudflare account. An account compromise, a deleted database or a billing problem takes it away too.
- **No integrity proof:** it gives no checksum, manifest or classification, so a restore must still be verified (`db:backup` of the result, then `db:compare`).
- **The audit log rewinds too.** Record the restore itself afterwards (runbook §6.2 step 7: the generated reset adds a `system.restore` audit entry).

Treat Time Travel as a fast first resort for recent mistakes. **Independent logical backups remain mandatory.**

## 8. Automated backup design [Documented, not implemented] [Requires owner approval]

**Recommended: a scheduled GitHub Actions job writing encrypted backups to storage outside Cloudflare.** No new paid service is required, but it must not be activated without owner approval.

1. **Schedule:** daily at 02:17 UTC, a quiet minute away from cron slots. Plus a manual run before any migration.
2. **Credentials:** a Cloudflare API token limited to the one account and to D1 only, stored as a GitHub *environment* secret (environment `backups`, required reviewer for any workflow change). Confirm the least permission that lets `d1 execute` run `SELECT`, and prefer read-only if Cloudflare offers it for queries. No Worker-deploy permission.
3. **Job steps:**
   1. `npm ci`;
   2. `npm run db:backup -- --remote --owner-approved --account-id … --database-uuid … --encrypt-for owner-backup-public.pem` (identity proven before reading; the public key is committed; the private key never enters CI);
   3. upload `*.sql.enc` and `*.manifest.json`.
4. **Off-platform storage:** a private, versioned bucket at a provider other than Cloudflare (for example S3 or Backblaze B2 with object lock), or the owner's Google Drive through a service account. The bucket:
   - refuses public access;
   - is write-only for CI (no delete permission), so a leaked token cannot erase history;
   - is encrypted at rest by the provider, in addition to our own encryption.
5. **Integrity:**
   - **In CI:** the job re-hashes the uploaded file against the manifest, and compares the new manifest with yesterday's. It alerts if the institutional row count drops by more than 5%, or if the migration version changes unexpectedly.
   - **Monthly, owner:** a full restore drill with the private key (`db:restore:verify`).
6. **Retention:** 35 daily, 12 monthly (first of the month) and 7 yearly copies. Encrypted backups older than this are deleted by a lifecycle rule. That needs owner approval, because it is personal data subject to the privacy policy.
7. **Failure notification:** GitHub emails the repository owner on job failure. The workflow also sends a Resend email to the admission address on failure or on a warning (empty backup, row drop). There is no notification on success; a weekly summary is optional.
8. **Monitoring:** the newest backup's age is shown in a weekly summary; alert if older than 36 hours.
9. **Audit log recovery:** `audit_log` is in every backup, so every daily copy is an independent, off-platform record of the log. This is the mitigation for the Stage 2C limitation that a privileged database operator could alter the log.

**Not recommended as the only copy:** a Worker cron writing to R2. R2 is in the same Cloudflare account, so it is not independent, and R2 activation is out of scope.

## 9. Recovery objectives (RPO and RTO): owner decision required

**Current state (Stage 3A.1 audit):**
- **No RPO or RTO has been approved for the Academy.**
- The Stage 3A version of this section showed "≤ 24 hours" and "2–4 hours". Those were the engineer's proposals, not approved targets, and they have been withdrawn.
- What is true today:
  - **RPO is unbounded.** No production backup has ever been taken.
  - **RTO is unknown.** No production restore has ever been rehearsed.
  - The local tooling restores a seeded test database in well under a minute, but that is not evidence for production, whose size and import time are unknown.

**Options for the owner to choose from** (each needs the owner's approval; none is in force):

| Option | RPO (data that can be lost) | Backup frequency needed | RTO (time to working service) | Storage and operations | What cannot be guaranteed today |
|---|---|---|---|---|---|
| A. Minimal | ≤ 7 days | Weekly encrypted backup, plus before every migration (manual) | ≤ 1 working day | ~52 copies a year; about 30 minutes a week of owner time | Anything between weekly backups. Restore time not yet measured on production data. |
| B. Standard | ≤ 24 hours | Daily scheduled encrypted backup (architecture §8, Stage 3B), plus before every migration | ≤ 4 hours | 35 daily + 12 monthly + 7 yearly copies off-Cloudflare; failure alerts; a monthly restore drill | Requires the Stage 3B job and storage. Requires one measured production restore to confirm the 4 hours. |
| C. Enhanced | Minutes, for recent mistakes; ≤ 24 hours otherwise | B plus **verified** D1 Time Travel | ≤ 1 hour for an in-place rewind; ≤ 4 hours for a restore | As B. Time Travel window and plan must be confirmed. | Time Travel not yet verified for this account. An in-place rewind loses every later write. |

**Recovery dependencies (all options):**
- Cloudflare account access with 2FA.
- The backup file and its manifest.
- The owner's private key, held in two offline copies.
- The unchanged `MFA_ENCRYPTION_KEY`, stored by the owner outside Cloudflare.
- The repository at a commit whose `migrations/` matches the backup.
- Node 22 and Wrangler 4.

**Decision needed:** the owner chooses an option, or other values, in writing. Only then do RPO and RTO become commitments, and Stage 3B builds the schedule to meet them.

## 10. Remaining limitations

- **Never run against production.** Remote backup, Time Travel, remote restore and the scheduled job all need Cloudflare access and owner approval.
- **Not transactional.** Logical backups are not taken inside one transaction (§3).
- **Remote import limit.** A remote import refuses any single statement over about 100 KB. The tool warns, but none exists today; the largest test row was about 5.6 KB.
- **Encrypted backups depend on the owner's key.** Losing the private key makes those backups unusable: keep two offline copies.
