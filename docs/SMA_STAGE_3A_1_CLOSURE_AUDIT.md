# SMA Stage 3A.1: Disaster-Recovery Corrections, Migration-Gate Hardening and Stage 3A Closure Audit

Date: 22 November 2026. Auditor: Claude (engineering), for the owner (`bookebukar@gmail.com`).

**Method:**
- I re-read the actual repository rather than earlier reports: `scripts/db/*`, migrations 0001–0010, `wrangler.jsonc`, the tests, the five Stage 3A documents, and Wrangler 4's own source for `d1 info`, `whoami`, `rollback` and how it resolves databases by name.
- Every claim below is tied to a file or an executed test.

**Status labels:**
- **Verified:** implemented and exercised by executed tests on isolated local resources.
- **Implemented, not adequately tested:** built, but not run against the real service.
- **Documented only.**
- **Not implemented.**
- **Needs Cloudflare:** requires Cloudflare account access.
- **Needs owner:** requires the owner's explicit approval.

---

## A. Findings

| # | Severity | Finding (as found in the code) | Correction | Evidence | Status |
|---|---|---|---|---|---|
| F1 | **Critical** | The production gate checked only the database **name** (`--confirm-database`). `--execute` ran `wrangler d1 migrations apply` with the project's `wrangler.jsonc`. That file pins **neither `account_id` nor `database_id`**, so Wrangler resolved the database by name in whatever account it chose. A same-named database in another account, or a renamed one, could have been migrated. | Every remote operation now runs through a temporary config **pinned to an owner-approved account ID and D1 UUID** (`remoteTarget`). `resolveIdentity` proves the identity live in three ways: account membership (`whoami --json`), the UUID exists there under the expected name (`d1 info`, pinned by UUID), and the name resolves to the same UUID (`d1 info`, by name). The gate requires `--approved-account-id` and `--approved-database-uuid`, and checks them against the preflight state, the backup and `wrangler.jsonc` (if pinned). It re-proves them live; the dry run and execution use the same `planMigration`; execution is pinned; the approval record stores the identity. Missing, malformed or placeholder values, a mismatch, or an unresolved identity all fail closed. A name match never overrides a UUID mismatch. `db:state` and `db:backup` refuse remote access without the identity. | `tests/db-gate.test.ts`: identity values; parsing; resolution (8 refusal cases); the right name with the wrong UUID refused at three layers; a missing UUID refused **with no live call**; another or unresolved account refused (5 ways); `runMigrate` dry run vs execute give identical refusals; execution config pinned; approval record without secrets. `tests/db-preflight.test.ts`: remote state needs identity; a backup with another UUID or account refused. | Verified (logic). The live Wrangler calls are **Implemented, not adequately tested** (need Cloudflare). |
| F2 | **High** | The rollback rule was "candidate's expected migration ≤ database's", which is not sufficient. In the code: 0004 makes an older Worker treat **unverified instructors** as active; 0007's `ai-automation` records are unknown to older Workers; 0008 makes an older Worker treat **sessions waiting for the authenticator code as signed in** and drops idle limits; 0009 lets an older Worker **reactivate removed staff**; since 2C the owner set-up is recorded **only in `owner_record`**, so a Stage 2B Worker would offer set-up again and identify the owner by email. | `scripts/db/rollback.mts` assesses every migration for older Workers in five areas (schema, data and behaviour, triggers and writes, authentication and sessions, security), with read-only checks. Verdicts are **SAFE / CHECK_REQUIRED / UNSAFE / PROHIBITED**. Below the Stage 2C floor (`0010_owner_integrity.sql`) the verdict is PROHIBITED unless the owner gives a written exception, and even then never SAFE. An unassessed migration makes any rollback across it UNSAFE. Command: `npm run db:rollback-check`. Runbook §4 is rewritten around it. | `tests/db-gate.test.ts`: 6 rollback tests (SAFE only at the same version; PROHIBITED; exception path; actions; UNSAFE cases; every check is a read-only `SELECT`; every migration assessed). `tests/db-recovery.test.ts`: facts gathered from a real D1, and the decision driven by them. | Verified |
| F3 | **High** | The restore procedure verified the restored database **after** clearing sessions and adding an audit entry, then still expected "IDENTICAL", which cannot be true. Its audit-entry SQL used real columns, but omitted `actor_id` and `target_id`, carried `<placeholders>` inside runnable SQL, and linked the restore to no verifiable owner. Its only cross-reference was the broken `§0`. | Two phases. **Phase A:** compare the import with the backup, which must be IDENTICAL, before any change. **Phase B:** a generated reset (`npm run db:post-restore-sql`, exact escaped SQL with no hand edits). It does `DELETE FROM auth_sessions`, invalidates unused `auth_tokens` and inserts one `system.restore` entry: `actor_id` NULL (no invented actor), `target_type 'database'`, `target_id` = the new UUID, and `approving_owner_user_id` read from the restored `owner_record`. Then `npm run db:compare -- … --post-reset` confirms that only those differences exist. Owner record, MFA and settings are untouched. | `tests/db-restore-reset.test.ts` (real Worker): old sessions and an outstanding magic link are dead; the owner gets back in by email link + **authenticator code** and by **recovery code**; owner record, MFA factors and recovery codes intact; audit protections still active; the entry's fields checked. `tests/db-recovery.test.ts` (real D1): phase A identical; phase B differs only as expected; tampering caught. | Verified |
| F4 | **High** | **Backup substitution.** A restore report identified its backup by **path** only. Swapping the file and manifest for a self-consistent different pair at the same path kept "restore-verified" status. | Restore reports record the **SHA-256 of the backup file and of the manifest** that were verified. The preflight requires both to match. The rehearsal records both, hashed *before* rehearsing. The gate re-hashes the backup and manifest at run time. | `tests/db-preflight.test.ts` (substitution refused); `tests/db-gate.test.ts` (backup or manifest changed after the preflight; rehearsal on a different backup). | Verified |
| F5 | Medium | Remote backups could be unencrypted, and nothing required encryption. | The preflight on remote state and the gate both refuse an unencrypted backup. | `db-preflight.test.ts`, `db-gate.test.ts` | Verified |
| F6 | Medium | The rehearsal did not record which migration files it applied, so a different file could be substituted after rehearsal. | The rehearsal records every migration file's SHA-256. The gate refuses any file that differs from the rehearsed one, as well as from the preflighted one. | `db-gate.test.ts` (substituted 0010 refused twice); `db-recovery.test.ts` (rehearsal records the hashes) | Verified |
| F7 | Medium | No live re-check at execution, so stale or edited state could pass while young enough. | The gate reads the live `d1_migrations` (read-only, pinned) and requires it to equal the preflight's applied list. Preflight age ≤ 2 hours; rehearsal age ≤ 24 hours. | `db-gate.test.ts` | Verified (logic). Live read: **Implemented, not adequately tested.** |
| F8 | Medium | The architecture document stated RPO "≤ 24 hours" and RTO "2–4 hours" as if decided. They were proposals, and the architecture could not support them yet. | Withdrawn. Section 9 is now an owner-decision table (options A, B, C) showing the backup frequency, storage and operations each requires, and what cannot be guaranteed. | `docs/SMA_STAGE_3A_BACKUP_RESTORE_ARCHITECTURE.md` §9 | Documented; **Needs owner** |
| F9 | Medium | The runbook held placeholder commands that looked runnable. One, `npx wrangler rollback <version-id>`, would **roll back to the previous version** if the id were left empty. Destructive steps were not consistently marked. | Every owner value is a shell variable guarded with `${VAR:?…}`, so commands refuse to run while a value is empty. A **register of destructive operations** (runbook §3) gives for each: what it changes, its target, whether it is reversible, the backup required, the approval and the verification. Each destructive command carries a ⚠ marker. All section references were renumbered and checked. Every documented command and flag was checked against the scripts' actual argument parsing. | Runbook, checklist and preflight documents; the cross-reference check | Documented (verified by inspection) |
| F10 | Low | Clean-up after failures was untested. Each pinned config left a temporary directory. | A failed restore (wrong key) leaves no directory or decrypted file, and a failed rehearsal leaves no copy. Pinned configs (account ID and UUID only, no secrets) are removed when the process exits. | `db-recovery.test.ts` (2 assertions) | Verified |
| F11 | Low | `scripts/seed.mts` advertised `wrangler d1 execute … --remote --file db/seed-programmes.sql`. That is an **ungated production write** that upserts programme rows (prices, durations). | The comment now forbids running it against production by hand and points to the gated procedure. Whether to keep the generator is left to the owner and Stage 3B. | `scripts/seed.mts` header | Documented |

**Inspected and found correct (no change):**
- Backups and manifests are associated by SHA-256: plaintext and ciphertext hashes, plus per-table row hashes.
- A local state file cannot pass as production state: it has kind `local` and no identity, and both the gate and the preflight refuse it.
- The four Stage 2C triggers allow the restore audit `INSERT`; they block only `UPDATE` and the deletion of entries younger than 365 days.
- `auth_tokens.used_at` and `auth_sessions` match the reset SQL. Sign-in verification refuses used links (proved by test).
- `db/seed-programmes.sql` and `lib/config.ts` were last changed on 21 November, before this stage. The test confirms they agree.

## B. Test results

Commands executed in this stage, all on isolated local resources:

| Command | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| `node --test tests/db-preflight.test.ts` | 18 | 18 | 0 | 0 |
| `node --test tests/db-gate.test.ts` | 14 | 14 | 0 | 0 |
| `node --test tests/db-restore-reset.test.ts` | 2 | 2 | 0 | 0 |
| `node --test tests/db-recovery.test.ts` (real isolated D1 via Wrangler, about 6 minutes) | 11 | 11 | 0 | 0 |
| `npm test` (all 30 test files, including every Stage 2, 2B, 2C and 3A test): first full run | 263 | 263 | 0 | 0 (cancelled 0, todo 0) |
| `npm test`: final full run after the last edits (comments, one log message, documents) | 263 | 263 | 0 | 0 (cancelled 0, todo 0; 429 s) |
| `npx tsc -p tsconfig.json --noEmit`; `npx tsc -p src/tsconfig.json --noEmit` | — | clean | — | — |
| `npx eslint .` | — | clean | — | — |
| `npm run build` (plus CSP postbuild, report mode) | — | success; 30 pages, 0 hash mismatches, 0 unsafe in `script-src` | — | — |
| `npm audit`; `npm audit --omit=dev` | — | 0 vulnerabilities | — | — |
| Secret scan (live key patterns, private keys, tokens) | — | only the `sk_test_xxxxxxxxxxxxxxxx` placeholder in `.dev.vars.example`; no `.env` or `.dev.vars` | — | — |

**Coverage of the brief's §9 list:**

| Area | Result | Tests |
|---|---|---|
| Backup generation | ✔ | db-recovery |
| Encryption and decryption | ✔ | db-recovery |
| Manifest integrity | ✔ | db-recovery, db-preflight |
| Restore verification | ✔ | db-recovery |
| Database comparison, both phases | ✔ | db-recovery |
| Preflight | ✔ | db-preflight, db-recovery |
| Rehearsal | ✔ | db-recovery |
| Gate logic | ✔ | db-gate |
| Identity verification | ✔ logic; live calls not run | db-gate, db-preflight |
| Rollback logic | ✔ | db-gate, db-recovery |
| Restore security reset | ✔ | db-restore-reset, db-recovery |

**Not run:**
- The production migration command line. The auto-mode classifier blocked even a dry-run invocation in Stage 3A, and this stage forbids production access. Its logic was run through `planMigration` and `runMigrate` with injected fakes instead.
- Any command against Cloudflare.

### B.1 Final full run

`npm test` after every Stage 3A.1 change: **263 tests, 263 passed, 0 failed, 0 skipped, 0 cancelled.** Exit code 0, 429 seconds. No temporary directories from the database tools were left behind.

## C. Production status

During Stage 3A.1:
- **No production database was read or modified.** No remote Wrangler command was run, and no Cloudflare API was contacted. Identity resolution ran only against injected fakes.
- **No production migration was executed.**
- **No Worker was deployed or rolled back.**
- **No production secrets were changed or read.**
- **No DNS, route, domain or hosting configuration was changed.** The GitHub Pages workflow is untouched.
- Paystack and R2 remain inactive. No institutional record was changed. Stage 3B has not been started.

## D. Outstanding owner decisions

1. **Production identity:** confirm and record the Cloudflare **account ID** and the D1 **UUID** of `skillmountainacademy-db` (checklist A0). Decide whether to pin both in `wrangler.jsonc` (Stage 3B; until then the gate warns and relies on the live name→UUID proof).
2. **RPO and RTO:** choose option A, B or C, or other values (architecture §9). None is in force.
3. **Recovery key custody:**
   - generate the backup key pair;
   - keep **two offline copies** of the private key;
   - name a deputy holder, if any;
   - store `MFA_ENCRYPTION_KEY` and the other recovery secrets outside Cloudflare.
4. **Backup storage destination:** an off-Cloudflare, versioned, write-only target for scheduled backups (architecture §8), and the retention lifecycle (personal data).
5. **Migration-specific decisions,** only if they turn out to be pending in production:
   - 0002: programme price overwrite;
   - 0004: every instructor then present becomes "approved";
   - 0007: overwrite of the `ai-automation` price and durations.
6. **Production migration approval:** Part A of the checklist (read-only inspection, establishing the still **UNKNOWN** history), then explicit approval of any Part B run.
7. **Rollback below the security floor:** pre-2C rollbacks are PROHIBITED unless the owner gives a written exception.
8. **`scripts/seed.mts`:** keep the generator with its warning, or remove the remote instruction entirely (F11).
9. **Live site host:** confirm that the domain serves the Worker, not GitHub Pages (checklist A4).

## E. Stage 3B readiness

**Stage 3A is ready to close,** subject to the owner's review of this audit.

The four controls the brief names as closure conditions are implemented and verified by executed tests on isolated resources:
- the database UUID and account gate;
- rollback compatibility;
- two-phase restore verification with the security reset;
- the protections against substitution and staleness.

The documents now match the scripts' real interfaces.

**What remains is outside what can be verified without the owner:**
- The live identity proof and live migration-history read have never run against Cloudflare. Their logic and output parsing are tested; their first real run is checklist A0 and A1.
- Production's migration history is **still UNKNOWN** until the owner runs Part A.
- No production backup or restore has been taken or rehearsed, so RPO is unbounded and RTO unknown until the owner acts.

**Stage 3B can begin once the owner approves this closure.** Its first tasks should be:
1. the owner's read-only Part A and first verified encrypted backup, which are owner actions and not engineering;
2. pinning `account_id` and `database_id`;
3. CI with these tests on every pull request;
4. the approved scheduled-backup job.

**Stage 3B has not been started.**
