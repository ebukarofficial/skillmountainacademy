# SMA Stage 3B: Backup Automation

Date: 22 November 2026.

Status:
- **The workflow is implemented, but INACTIVE.** It runs only when the owner sets the repository variable `BACKUP_ENABLED=true`.
- **Tested locally:** the shipping checks and stored-copy verification (`scripts/backup/ship.mts`, tests in `tests/stage3b-gates.test.ts`), and the backup and encryption tool itself (Stage 3A).
- **Not tested** against Cloudflare, GitHub or any storage provider.
- **Not done:** no storage account was created or activated, and no secret was changed.

## 1. What the daily job does

`.github/workflows/backup.yml` runs at 02:17 UTC every day (and on demand) in the GitHub environment `backups`:

1. **Backup.**
   - Creates a read-only, identity-proven logical backup of `skillmountainacademy-db`: `npm run db:backup -- --remote --owner-approved --account-id … --database-uuid …`.
   - Wrangler is pinned to the approved account and the exact D1 UUID.
   - A database with the right name but a different UUID is refused (Stage 3A.1).
2. **Encryption before anything is stored.**
   - The backup is encrypted with the owner's public key `db/keys/owner-backup-public.pem` (RSA-OAEP-wrapped AES-256-GCM, Stage 3A).
   - The plaintext never leaves the runner, and the shipping check refuses to continue if any plaintext `.sql` exists.
   - The private key **never enters GitHub**.
3. **Shipping checks** (`npm run backup:ship -- inspect`). The job stops if any of these fail:
   - exactly one encrypted file plus its manifest;
   - the encrypted file's SHA-256 equals the manifest;
   - the source is production with the approved account and UUID;
   - the backup is under 2 hours old;
   - it contains institutional records;
   - those records did not fall by more than 5% since the previous stored manifest.

   A migration change since the previous backup is reported as a warning.
4. **Write-once upload** to S3-compatible storage outside Cloudflare.
   - The key is `<prefix>/YYYY/MM/<backup name>.sql.enc` plus `.manifest.json`.
   - The upload uses `put-object --if-none-match '*'`, so an existing object is never overwritten, and `--checksum-algorithm SHA256`.
5. **Stored-copy verification.** `head-object --checksum-mode ENABLED` is read back, and the stored size and SHA-256 must equal the local encrypted file (`backup:ship -- verify`).
6. **Local copies are removed** from the runner, whether the job passed or failed.
7. **Failure notification.** The job fails, which makes GitHub notify watchers, and an issue titled "Database backup FAILED <date>" is opened.

The job reads production only. It never writes to D1 and never deletes anything in storage.

## 2. Owner set-up (none of this has been done)

1. **Key pair**, generated on the owner's computer (Stage 3A backup architecture §6):
   ```sh
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out owner-backup-private.pem
   openssl pkey -in owner-backup-private.pem -pubout -out owner-backup-public.pem
   ```
   - Commit **only** `owner-backup-public.pem`, as `db/keys/owner-backup-public.pem`, through a reviewed pull request. The secret scan allows exactly this file.
   - Keep the private key in two offline places (for example, a password manager plus an encrypted USB drive).
   - Without the private key, no backup can ever be restored.
2. **Storage outside Cloudflare.** Choose an S3-compatible provider; **this is an owner decision and may be paid**. Requirements:
   - a dedicated bucket, not public;
   - **versioning on**;
   - **object lock or retention** (overwrite and delete protection) where the provider offers it;
   - support for conditional writes (`If-None-Match`) and SHA-256 checksums.

   Untested: AWS S3 documents both; other providers must be checked before use. If the conditional put is unsupported, the upload step fails. It does not silently overwrite.
3. **Storage credentials:** an access key limited to that bucket, with permission to put, get, list and head objects, and **no delete permission**.
4. **Cloudflare backup token:** see `docs/SMA_STAGE_3B_CLOUDFLARE_PERMISSIONS_AND_SECRETS.md` §3.
5. **GitHub `backups` environment:**

   | Kind | Names |
   |---|---|
   | Secrets | `CLOUDFLARE_BACKUP_TOKEN`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` |
   | Variables | `APPROVED_ACCOUNT_ID`, `APPROVED_D1_UUID`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT` (blank for AWS), `BACKUP_S3_REGION`, `BACKUP_S3_PREFIX` (default `sma-d1`) |

   Restrict the environment to the `main` branch (GitHub protection guide §4).
6. **Start:**
   - run the workflow once by hand (Actions → "Database backup (scheduled)" → Run workflow), then check the run, the issue list and the bucket;
   - then set the repository variable `BACKUP_ENABLED=true`.

## 3. Retention (owner approval required)

The workflow never deletes. Retention is set in the storage provider's lifecycle and lock settings, so a compromised GitHub token cannot shorten it. Options for the owner:

| Option | Daily copies | Monthly copies (first of month) | Storage, very roughly |
|---|---|---|---|
| A (minimum) | 35 days | 12 months | ~47 objects |
| B (recommended for an academy with financial and academic records) | 35 days | 7 years | ~119 objects |
| C | 90 days | 7 years | ~174 objects |

- Financial-record retention obligations depend on the jurisdiction; the owner should confirm with an accountant or lawyer.
- The backups contain personal data, so retention should not be longer than needed.
- Object-lock retention cannot be shortened later, so start with a lock no longer than the shortest chosen tier.

## 4. Failure handling

When an issue "Database backup FAILED" appears, open the run and find the first failed step:

| Failed step | Usual cause | Action |
|---|---|---|
| Require the owner's public key | Key not committed | §2.1 |
| Encrypted, identity-proven backup | Token, account or UUID wrong, or Cloudflare unavailable | Check environment values and token (never paste them into the issue); run again |
| Shipping checks: "fell from X to Y" | Records really dropped, or a deletion happened | **Treat as a possible incident.** Do not override. Compare with the application, then follow the DR runbook |
| Shipping checks: age, identity, encryption | Clock or configuration problem | Fix, then run again |
| Write-once upload | Key exists (re-run in the same minute), credentials, or provider without conditional writes | Re-run later. Never switch to an overwriting upload |
| Verification | Stored copy differs | Treat as storage corruption. Keep the evidence and contact the provider |

Two consecutive failed days means the recovery-point objective is at risk: take a manual encrypted backup (DR runbook §1) the same day.

## 5. Restore procedure

1. In the storage console, download a chosen `….sql.enc` and its `….manifest.json` into a new, empty folder on the owner's computer.
2. Check the SHA-256: `shasum -a 256 <file>.sql.enc` must equal `encrypted.sha256` in the manifest.
3. Verify the restore in an isolated local database:
   ```sh
   npm run db:restore:verify -- <file>.sql.enc --key <path to owner-backup-private.pem>
   ```
   It must print RESTORE VERIFIED.
4. For production recovery, follow `docs/SMA_STAGE_3A_DISASTER_RECOVERY_RUNBOOK.md` §6.2. That means a restore into a **separate** database with the identity-bound commands (`npm run cf -- d1-create-restore …`, `restore-import`, `restore-reset`), then the switch-over decision. Never import over the live database.

## 6. Monthly restore drill

`.github/workflows/restore-drill.yml` opens an issue "Monthly restore drill YYYY-MM" on the 1st of each month, unless one is already open. It touches nothing else. The owner then:
- carries out §5 steps 1–3 on the newest backup;
- notes the restore time (recovery-time objective) and the backup's age (recovery-point objective);
- confirms both private-key copies can be read;
- records the result in the issue and closes it.

A drill that cannot restore is a priority-one incident.

## 7. Not tested

- the job against real Cloudflare (token scope, Wrangler output on the runner);
- the storage provider's conditional writes and checksum responses;
- the issue creation;
- the schedule itself.

The local tests cover the decision logic only: what is shipped, what is refused, and how the stored copy is verified.
