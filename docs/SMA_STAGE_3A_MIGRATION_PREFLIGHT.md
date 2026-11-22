# SMA Stage 3A: Migration Preflight

Date: 22 November 2026. Revised in Stage 3A.1 (exact database identity, bound records, rollback compatibility).

**Status:** the preflight, rehearsal and approval-gate tools are **[Implemented + tested locally]**. Running them against production is **[Requires Cloudflare access] [Requires owner approval]** and was not done.

## 1. Principles

1. **Fail closed.** If the database's migration state cannot be established, nothing is pending and the result is FAIL.
2. **No naive parsing.** SQL is never split on `;`.
3. **Destructive statements need a written review** tied to the file's exact SHA-256, and some need the owner's own decision.
4. **No migration without a verified backup** of the current database at its current version.
5. **Rehearse on a copy first.** Migrations are applied to an isolated copy of that backup before production.
6. **Production only behind an explicit gate.** The production command is reachable only through `npm run db:migrate`, which checks every gate and does nothing without `--execute`.

## 2. SQLite-aware parsing (`scripts/db/sql.mts`)

A tokenizer that understands:
- `'…'` strings (with `''` escapes);
- `"…"`, `` `…` `` and `[…]` identifiers;
- `--` and `/* */` comments;
- `CREATE [TEMP|TEMPORARY] TRIGGER … BEGIN … END` bodies, including nested `CASE … END`.

It is **conservative**: an unterminated string, identifier, comment or trigger body, or a trigger without `BEGIN`, raises `SqlParseError`, and the preflight fails ("could not be parsed safely"). Ambiguous input is never guessed.

**Tests:**
- 0010 parses to exactly six statements, with its four triggers whole.
- Every migration in the repository parses.
- Semicolons inside strings, identifiers and comments are not statement ends.
- Five ambiguous inputs are refused.

The test harness's own migration runner (`tests/worker-harness.ts`) was made trigger-aware in Stage 2C. Wrangler itself is used for every real D1 operation in these tools.

## 3. Classification of statements

| Severity | Statements | Effect |
|---|---|---|
| safe | `CREATE TABLE/INDEX/VIEW/VIRTUAL TABLE`, `INSERT`, `INSERT OR IGNORE`, `ALTER TABLE … ADD [COLUMN]`, `SELECT`, triggers whose bodies do not write | none |
| review | `UPDATE … WHERE` (backfill), `REPLACE` / `INSERT OR REPLACE`, upserts (`ON CONFLICT … DO UPDATE`), `PRAGMA`, `WITH …`, triggers whose bodies write, unrecognised statements | needs a review entry |
| destructive | `DROP TABLE/INDEX/VIEW/TRIGGER`, `ALTER TABLE … DROP [COLUMN]`, `ALTER TABLE … RENAME` (table or column), `DELETE`, `TRUNCATE`, `UPDATE` without `WHERE` | review + `destructiveAcknowledged` |
| forbidden | `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`/`RELEASE`/`END`, `ATTACH`, `DETACH`, `VACUUM` | never allowed |

**Reviews** live in `db/migration-reviews.json`:

```json
{ "0012_example.sql": { "sha256": "<exact file hash>", "reviewedBy": "Name", "reviewedAt": "YYYY-MM-DD", "summary": "what it changes",
  "destructiveAcknowledged": true, "ownerApprovalRequired": true, "ownerApproved": false, "ownerDecision": "what the owner must decide" } }
```

- If the file changes after review, the hash no longer matches and the review is void.
- A test checks that every recorded review matches its file, and that every repository migration with risky statements has a review.

**Existing reviews (Stage 3A):**

| Migration | Risk | Owner decision |
|---|---|---|
| `0002_seed_programmes` | Upserts overwrite programme rows, **including prices** | **Required**, if pending in production |
| `0004_admissions` | `UPDATE users SET verification='approved' WHERE role='instructor'`: every instructor present becomes approved | **Required**, if pending |
| `0005_identity` | Fills the new `staff_no` column only | not required |
| `0006_instructor_profile` | Fills the new `verified_at` column only | not required |
| `0007_refinement` | Upsert would overwrite an existing `ai-automation` row's price and durations | **Required**, if pending |
| `0001`, `0003`, `0008`–`0010` | Additive only | — |

These reviews matter only if a migration is still pending in production. Production state is unknown; see the production checklist.

## 4. Preflight checks (`npm run db:preflight`)

**Input:** a state file from `npm run db:state`, which is read-only:
- `--local-dir <isolated>` for tests;
- `--remote --owner-approved --account-id … --database-uuid …` for production.

For production, the identity is **proven before** any read (runbook §1). The state records the verified identity, the capture time, the tables, `d1_migrations`, the schema and the row totals.

| Check | Fails when |
|---|---|
| files | A bad name; a duplicate number; a gap or renumbering; an empty file; SQL the parser refuses |
| state | No state; tables without `d1_migrations` (unknown history, fail closed); state older than 2 hours; **remote state without a verified account ID and UUID** |
| history | An applied migration has no file; an applied migration is out of order |
| schema | The schema differs from what its applied migrations produce (an isolated build of that prefix) |
| review | A pending risky statement without a matching review, acknowledgement or owner decision; any forbidden statement |
| backup | Only when something is pending:<br>• missing;<br>• file or manifest hash mismatch;<br>• older than 24 hours;<br>• another database;<br>• for remote state, **not the same account ID and UUID**, or **not encrypted**;<br>• another kind (local/remote);<br>• another migration version;<br>• no institutional records;<br>• **restore report not bound to these exact bytes**: the report must carry the SHA-256 of this backup file and of this manifest, so a substituted pair, even a self-consistent one, is refused |

**Record:** every run writes JSON to `backups/preflight/preflight-<UTC>.json` with:
- the result, failures and warnings;
- the applied and pending lists;
- the version this Worker expects;
- each file's SHA-256 and findings;
- the state's kind, identity and capture time;
- the backup: path, file and manifest SHA-256, version, encryption, identity, restore-verified.

## 5. The migration workflow

The exact commands, with identity variables, are in `docs/SMA_STAGE_3A_PRODUCTION_MIGRATION_CHECKLIST.md`.

| Step | Tool | Where |
|---|---|---|
| 0. Prove identity | every remote tool: `--account-id`, `--database-uuid` (live proof) | production, read-only metadata |
| 1. Backup | `db:backup --remote … --encrypt-for` | production, read-only |
| 2. Verify backup | `db:restore:verify` (report bound to the file and manifest hashes) | isolated local D1 |
| 3. Pending list | `db:state --remote …`, then `db:preflight` | production read-only, then offline |
| 4–5. Apply to a copy and verify | `db:rehearse` on **the same backup** (report records the backup and manifest hashes and **every migration file's hash**) | isolated local D1 |
| 6. Operator review | the preflight record and rehearsal report | owner |
| 7. Approved production operation | `db:migrate` (dry run), then `db:migrate --execute` | production, owner only |

### The gate (`scripts/db/migrate-remote.mts`, `planMigration` and `runMigrate`)

The dry run and execution call the **same** `planMigration`; a test proves they report identical refusals.

**Identity:**
- `--approved-account-id` and `--approved-database-uuid` must be well-formed. They come from the owner; nothing is invented, and a placeholder UUID is refused.
- The preflight state, the backup and `wrangler.jsonc` (when it pins `account_id` or `database_id`) must carry exactly that identity.
- **Live**, at the moment of the run:
  1. the signed-in user is a member of the account;
  2. the UUID exists there and is named `skillmountainacademy-db`;
  3. the name resolves to that UUID (a name match never overrides a UUID mismatch).
- An unresolved account or database fails closed.

**State:**
- The preflight PASSED on **remote** state; a local copy has the same name, so the kind is checked.
- It is at most 2 hours old and has something pending.
- The **live** production migration history equals the preflight's applied list. Stale or forged state is refused.

**Files:** byte-identical to those both the preflight and the rehearsal recorded, with none added.

**Backup:**
- restore-verified and encrypted;
- of the approved identity;
- re-hashed now, so the file and manifest are unchanged since the preflight.

**Rehearsal:**
- passed, on the same backup and manifest hashes;
- reached this Worker's version;
- applied exactly the pending list;
- at most 24 hours old.

**Operator:** `--confirm-database skillmountainacademy-db` and `--approved-by "<name>"`.

**Execution:** only with `--execute`, through a temporary Wrangler configuration **pinned to the approved account ID and UUID**. The approval record holds the identity, the live resolution, the record hashes and the approver, and no secrets.

**Limitation:**
- The live identity proof uses `wrangler whoami --json` and `wrangler d1 info --json`. Their parsing is unit-tested against the shapes in Wrangler 4's source, but has **not** been run against the real Cloudflare account, which needs the owner.
- `wrangler.jsonc` does not yet pin `account_id` or `database_id`. The gate warns, and relies on the live name→UUID proof; pinning is a Stage 3B item.

## 6. Worker and schema compatibility

- **What a build expects:** `src/server/schema-version.ts` (`EXPECTED_MIGRATION`) and `db/schema.expected.json`. Tests keep both equal to `migrations/`.
- **What the live database has:** shown in Admin → Platform (`/api/app/admin/platform`, field `schema`).
- **Forward-compatible migration policy:**
  1. additive changes first;
  2. new columns nullable or with defaults;
  3. backfills only `UPDATE … WHERE` on new columns, reviewed;
  4. removal or renaming only in a separate, later, approved stage, after no deployed or rollback-candidate Worker uses it;
  5. migrate first, deploy second.

## 7. Rollback compatibility (`scripts/db/rollback.mts`, `npm run db:rollback-check`)

A lower expected migration number is **not** enough. For every migration, the effect on an **older** Worker is assessed in five areas: schema, data and behaviour, triggers and writes, authentication and sessions, and security. Read-only checks turn the assessment into a verdict: **SAFE**, **CHECK_REQUIRED**, **UNSAFE** or **PROHIBITED** (runbook §4).

| Crossed migration | What an older Worker gets wrong | Check (read-only count) | If the count is not 0 |
|---|---|---|---|
| 0003 | Has no learning platform: sign-in, portals and records are gone | — | **UNSAFE** always |
| 0004 | Ignores admissions modes and capacity, **and instructor verification** | active instructors not `approved`; restricted programmes | UNSAFE (unverified instructors would teach); action (registrations accepted) |
| 0005 | Ignores email opt-outs | users with opt-outs | action (owner accepts) |
| 0006 | Profile fields not shown | — | safe |
| 0007 | Does not know the `ai-automation` programme or the engagement settings | ai-automation enrolments, orders or registrations | **UNSAFE** |
| 0008 | **Treats sessions waiting for the code as signed in**; no idle limit; no MFA | MFA-pending sessions | action: **end all sessions immediately after the rollback** (always required when crossing 0008) |
| 0009 | Can **reactivate removed accounts**; ignores forced re-enrolment | removed accounts | action (owner watches for reactivation) |
| 0010 | Triggers compatible (older Workers never update or delete young audit rows or `owner_record`). But a Stage 2B Worker reads owner set-up from `app_settings`, which 2C no longer writes. | set-up only in `owner_record` | **UNSAFE**: a 2B Worker would re-open owner set-up |

**Fixed rules:**
- **Below the security floor** (candidate expects a migration before `0010_owner_integrity.sql`) the verdict is **PROHIBITED**. An explicit written owner exception lifts it to CHECK_REQUIRED at best, never SAFE.
- Unknown history, a candidate needing newer schema, an unknown candidate, or a crossed migration with no assessment: **UNSAFE**, fail closed.
- A test requires an assessment for every migration file. A new migration therefore cannot be rolled back across until it is assessed.

## 8. Tests (Stage 3A.1, all executed; results in the closure audit)

- **`tests/db-preflight.test.ts`** (18):
  - parser and classifier;
  - every preflight failure path, including **substitution of a restore-verified backup by a self-consistent different backup**;
  - **remote state without identity, a backup of another UUID or account, and an unencrypted backup**;
  - compatibility states, reviews, classification and expected schema version.
- **`tests/db-gate.test.ts`** (14):
  - identity values;
  - Wrangler output parsing;
  - live identity resolution: the right name with the wrong UUID; a UUID only in another account; not a member; not signed in; the name resolving to another UUID; network failure;
  - the gate:
    - **correct name + wrong UUID refused**;
    - **missing UUID refused**, with no live call made;
    - **another or unresolved account refused**;
    - pinned `wrangler.jsonc` mismatch;
    - local, stale or forged state;
    - substituted backup or manifest;
    - unencrypted backup;
    - substituted migration after rehearsal;
    - stale or mismatched rehearsal;
  - `runMigrate`:
    - dry run by default;
    - identical refusals for dry run and execution;
    - execution pinned to the approved account and UUID;
    - approval record without secrets;
  - rollback decisions:
    - SAFE, PROHIBITED, the exception path and CHECK_REQUIRED actions;
    - UNSAFE for unverified instructors, ai-automation records, the LMS, the 2B bootstrap, unknown history, newer schema and unassessed migrations;
    - every check is a read-only `SELECT`.
- **`tests/db-recovery.test.ts`** (11, real isolated D1 via Wrangler):
  - backup;
  - restore;
  - encryption: a wrong key fails **and leaves nothing behind**;
  - empty backups;
  - failed restores;
  - schema mismatch;
  - rehearsal: records file hashes;
  - schema snapshot;
  - **two-phase restore**: phase A identical, phase B only the expected differences, tampering caught, the restore audit entry checked;
  - **rollback facts from a real database**;
  - **a failed rehearsal leaves no copy**.
- **`tests/db-restore-reset.test.ts`** (2, real Worker):
  - the generated reset SQL: three statements, real columns, escaping, no placeholders, owner id from `owner_record`;
  - after the reset, **old sessions and an outstanding magic link are dead**, while **the owner gets back in by authenticator code and by recovery code**;
  - owner record, MFA, recovery codes and audit protections intact;
  - the audit entry has no invented actor.
