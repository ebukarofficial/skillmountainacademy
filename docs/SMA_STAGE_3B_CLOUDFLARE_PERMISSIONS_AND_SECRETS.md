# SMA Stage 3B: Cloudflare Permissions and Secrets Requirements

Date: 22 November 2026.

Status:
- **Documented requirements.** No token was created and no secret was set or changed.
- **The permission sets are untested** against the Academy's account. The owner should create each token and check it on **staging** first.

Permission names follow Cloudflare's API token permission reference (checked 22 Nov 2026). They are Account-level unless marked Zone. Cloudflare also offers granular Workers roles: an *Editor* scoped to one Worker can deploy that Worker. Where available, scope each token to the one Worker and the one account it needs.

## 1. Principles

- **One token per job:** deploy, backup and staging each get their own. Never use a personal Global API Key or the owner's dashboard login in GitHub.
- **Account-scoped, one account only.** Add a client IP restriction only if GitHub runner addresses can be pinned (usually not), and set an expiry date (for example 12 months) with a calendar reminder to rotate.
- **No DNS, no Zone edit, no D1 write, no R2, no Paystack and no account-member permissions** in any automation token.
- Tokens are stored only as **GitHub environment secrets** (`production` or `backups`), never as repository-wide secrets. Both environments are protected (GitHub protection guide §4).
- Production Worker secrets (`wrangler secret put`) are **not** handled by any workflow. Changing them remains a manual owner action.

## 2. Production deploy token: `CLOUDFLARE_DEPLOY_TOKEN` (environment `production`)

| Permission | Level | Why |
|---|---|---|
| Workers Scripts (or Workers *Editor* scoped to `skillmountainacademy`) | Edit | `wrangler deploy`, `deployments list` |
| D1 | **Read** | The gate's live identity proof (`d1 info` by UUID and by name), and (Stage 3B.1) the read-only query of the approved database's `d1_migrations` for compatibility. Never Edit: the workflow cannot migrate or write. |
| Account Settings | Read | Wrangler reads account details during deploy (commonly needed; confirm on staging) |

Not granted:
- **Workers Routes (Zone)**: `wrangler.jsonc` defines no routes. If the custom domain is managed in the dashboard, the deploy should not need to change it. Untested; see the deployment runbook §7.
- **Workers KV Storage**: the KV binding is pinned by id. Without KV Edit, Wrangler also cannot *create* a namespace, which is a second guard alongside the gate.
- **DNS**, **D1 Edit**, **R2**, **Workers Tail**.

The gate also needs `whoami` to list the account. If an account-owned token cannot list memberships, add **Memberships Read** (User level); confirm on staging.

## 3. Backup token: `CLOUDFLARE_BACKUP_TOKEN` (environment `backups`)

| Permission | Level | Why |
|---|---|---|
| D1 | **Read** | `d1 info` (identity proof) and read-only `SELECT` queries for the logical backup |
| Account Settings | Read | As above, if required |

- Cloudflare's API reference lists **D1 Read** among the accepted permissions for the *Query D1 Database* endpoint, so no write permission should be needed. This is untested here.
- The backup tool sends only read-only statements in any case (Stage 3A `query()` refuses anything else remotely).
- No Workers permissions.

## 4. Storage credentials for backups (environment `backups`)

`BACKUP_S3_ACCESS_KEY_ID` and `BACKUP_S3_SECRET_ACCESS_KEY` need:
- a key limited to the one backup bucket;
- permission for `PutObject`, `GetObject`, `ListBucket` (on the prefix) and `HeadObject`/`GetObjectAttributes`;
- **no** `DeleteObject`, no bucket-policy, lifecycle or lock changes.

Retention and lock are set by the owner in the provider console. See the backup automation doc §2–3.

## 5. Staging (when approved)

Use a separate token with Workers Scripts Edit, D1 Edit and KV Edit (for its own database and namespace). If staging lives in a separate account, scope the token to that account only, so it cannot touch production at all. Do not put it in the `production` environment.

## 6. Complete list of GitHub secrets and variables

| Name | Kind | Environment | Set by | Notes |
|---|---|---|---|---|
| `CLOUDFLARE_DEPLOY_TOKEN` | secret | production | owner | §2 |
| `APPROVED_ACCOUNT_ID` | variable | production, backups | owner | 32 hex characters, from the dashboard |
| `APPROVED_D1_UUID` | variable | production, backups | owner | Exact UUID of `skillmountainacademy-db` |
| `APPROVED_KV_ID` | variable | production | owner | Production KV namespace id |
| `SITE_URL` | variable | production | owner | `https://skillmountainacademy.com` |
| `NEXT_PUBLIC_SHEET_URL`, `NEXT_PUBLIC_WHATSAPP` | variable | production | owner | Public build values |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | variable | production | owner | **Empty** until Paystack is approved |
| `PAYSTACK_APPROVED`, `R2_APPROVED` | variable | production | owner | `false` until approved |
| `CSP_MODE` | variable | production | owner | `report` or `enforce`: the mode production uses now. Required; the build must match it. |
| `CLOUDFLARE_BACKUP_TOKEN` | secret | backups | owner | §3 |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | secret | backups | owner | §4 |
| `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_PREFIX` | variable | backups | owner | Provider details |
| `BACKUP_ENABLED` | variable | repository | owner | `true` starts the daily schedule |

The existing GitHub Pages workflow keeps its own repository secrets, unchanged.

**Never in GitHub:**
- the backup private key;
- Worker runtime secrets: `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, `TURNSTILE_SECRET`, `HOLD_SIGNING_KEY`, `MFA_ENCRYPTION_KEY`, `SHEET_WEBHOOK_URL`. These live only in Cloudflare (`wrangler secret put`).

## 7. Rotation and revocation

- **Rotate** each token on its expiry, or at once if a runner log, a fork or a person may have exposed it.
- **Steps:** create the new token, update the environment secret, run the workflow once (backup: on demand; deploy: the next release), then delete the old token in the dashboard.
- **If a token leaks:** delete it in Cloudflare first, then investigate with the Cloudflare audit log and the GitHub Actions run history.
