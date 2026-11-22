# SMA Stage 3B: GitHub Repository Protection Guide

Date: 22 November 2026.

Status: **documentation only. No repository setting has been changed.** This session had no authorised GitHub access to the repository: the GitHub API answered "GitHub access to this repository is not enabled". The owner applies these settings in the GitHub web interface (Settings). Each step says what to click and what to check afterwards.

> **Stage 3B.2 (owner instruction).** The owner pushes directly to `main`, and Cloudflare publishes from it. **Do not turn on "Require a pull request", required approvals or required status checks** for `main`: they would block that route, and a sole maintainer cannot approve their own pull requests. If anything is applied, the minimum that keeps the route unchanged is **Block force pushes** and **Restrict deletions** only. CI still runs on every push and reports problems without blocking publication. The `production` environment (§4) is needed only if the optional `deploy-worker.yml` is ever used.

## 1. Branch protection for `main` (Settings → Rules → Rulesets → New branch ruleset)

| Setting | Value |
|---|---|
| Name | `main protection` |
| Enforcement status | Active |
| Target branches | Default branch (`main`) |
| Bypass list | **Empty.** If the owner keeps an emergency bypass, use "Pull requests only", never "Always". |
| Restrict deletions | On |
| Block force pushes | On |
| Require linear history | On (optional, keeps history readable) |
| Require a pull request before merging | On. Required approvals: **1**. Dismiss stale approvals when new commits are pushed: On. Require approval of the most recent reviewable push: On. Require conversation resolution: On. |
| Require review from Code Owners | On, **after** adding `.github/CODEOWNERS` with the owner's GitHub username (`* @<owner-username>`). The username is not recorded in this repository, so the file was not created. |
| Require status checks to pass | On. Require branches to be up to date: On. Required checks, exactly as the CI job names: **`CI static checks`**, **`CI tests`**, **`CI build and security headers`** |
| Block commits that are not signed | Optional |

A check name only appears in the picker after CI has run once on a pull request. So open a first pull request containing `.github/workflows/ci.yml`, let it run, then add the three checks.

**Single-maintainer note.** GitHub does not let an author approve their own pull request. If the owner is the only reviewer, changes are prepared by someone else (or by Claude) and approved by the owner. Alternatively, the owner temporarily uses a bypass. Do not weaken the required checks for this.

## 2. Release tags (Settings → Rules → Rulesets → New tag ruleset)

| Setting | Value |
|---|---|
| Name | `release tags` |
| Target tags | Include by pattern `v*` |
| Bypass list | Owner only (needed to create tags if creation is restricted) |
| Restrict creations | On (only the bypass list can create release tags) |
| Restrict updates | On (a release tag can never be moved) |
| Restrict deletions | On |

**Convention:** `vYYYY.MM.DD-N` (for example `v2026.12.01-1`), annotated, on a commit already on `main`. The deployment workflow refuses any other format and any commit not on `main`.

## 3. Actions settings (Settings → Actions → General)

| Setting | Value |
|---|---|
| Actions permissions | Allow the repository's own actions and selected non-GitHub actions. Allow actions created by GitHub. All workflows pin actions by full commit SHA. |
| Require actions to be pinned to a full-length commit SHA | On, if offered |
| Fork pull request workflows | Require approval for all outside collaborators |
| Workflow permissions | **Read repository contents** (default token read-only). Each workflow raises only what it needs: issues for the backup/drill reminders, checks/actions read for deployment. |
| Allow GitHub Actions to create and approve pull requests | Off |

## 4. Environments (Settings → Environments)

**`production`** (used by `deploy-worker.yml`):
- **Required reviewers:** the owner. Leave "Prevent self-review" off if the owner both starts and approves deployments; the approver is still recorded.
- **Wait timer:** optional (for example 5 minutes, a last chance to cancel).
- **Deployment branches and tags:** Selected → `main`. The workflow is started from `main` and deploys the tagged commit after checking that it is on `main`.
- **Allow administrators to bypass:** Off.
- **Secrets and variables:** see `docs/SMA_STAGE_3B_CLOUDFLARE_PERMISSIONS_AND_SECRETS.md` §6.

**`backups`** (used by `backup.yml`):
- **Required reviewers:** none (the scheduled job must run unattended).
- **Deployment branches:** Selected → `main` only. A pull request or other branch cannot reach the backup credentials.
- **Secrets and variables:** as in the permissions document.

## 5. Other repository settings

- **Code security:** turn on Dependabot alerts, secret scanning and push protection.
- **Private vulnerability reporting:** On.
- **Collaborators:** the minimum. Anyone with write access can open pull requests but cannot deploy or merge without the owner.

## 6. Check after applying

1. Push to a branch and open a pull request. CI runs, and merging is blocked until all three checks pass and the owner approves.
2. Try `git push --force` to `main`. It is rejected.
3. Try to create `v2026.01.01-1` as a non-owner. It is rejected.
4. Run "Deploy Worker (production)". It stops at "Waiting for review" until the owner approves. Before Cloudflare is set up, the run then fails safely at the gate.

## 7. Not changed in Stage 3B

- The existing GitHub Pages workflow (`deploy.yml`) and the Pages site were **not** modified, disabled or deleted. Whether to retire them is an owner decision (Stage 3A handover §1).
- No repository, branch, tag, environment, secret or Actions setting was changed.
