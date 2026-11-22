// Production deployment gate (Stage 3B). Run by .github/workflows/deploy-worker.yml immediately before `wrangler deploy`,
// and usable locally. It refuses (exit 1) unless EVERY check passes:
//   release    the tag matches vYYYY.MM.DD-N; a named approver is given
//   identity   wrangler.jsonc pins exactly: Worker name skillmountainacademy, account_id = APPROVED_ACCOUNT_ID, and the DB
//              binding database_name skillmountainacademy-db with database_id = APPROVED_D1_UUID. Missing or different
//              values, other Worker or database names: refused. A name never substitutes for the UUID.
//   live       the signed-in token belongs to the approved account; the approved UUID exists there under the expected name
//              and the name resolves to that UUID (resolveIdentity); the Worker exists in that account (deployments list)
//   database   (Stage 3B.1) the latest applied migration is read READ-ONLY from the APPROVED D1 UUID itself (identity-bound
//              query, the same pinned account and UUID), and must EQUAL the migration this build expects
//              (src/server/schema-version.ts). Older: migrate first through the gated procedure; newer: this is a
//              rollback, use the rollback procedure; unreadable: refused. The public /api/status is NOT used for this
//              decision (it reports whatever Worker and database currently answer at the domain).
//   scope      no database migration here; Paystack must not be activated (NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY empty, also in
//              wrangler.jsonc "define") and no R2 binding unless the owner set PAYSTACK_APPROVED / R2_APPROVED = "true";
//              CSP_MODE must be stated ("report" or "enforce") so a deployment cannot silently change the policy mode.
//   npm run deploy:gate -- --out gate.json      (inputs from environment variables; see docs/SMA_STAGE_3B_DEPLOYMENT_RUNBOOK.md)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMain, parseArgs } from "../db/args.mts";
import { identityProblems, parseWhoami, PROD_DB, query, remoteTarget, resolveIdentity, ROOT, type Identity, type ResolvedIdentity } from "../db/d1.mts";
import { configuredIdentity, stripJsonc } from "../db/migrate-remote.mts";
import { EXPECTED_MIGRATION } from "../../src/server/schema-version.ts";
import { pinnedConfig, PROD_WORKER, type CfRunner } from "../cf.mts";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

export const TAG_RE = /^v\d{4}\.(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])-\d{1,3}$/;
export type GateEnv = Partial<Record<"APPROVED_ACCOUNT_ID" | "APPROVED_D1_UUID" | "APPROVED_KV_ID" | "RELEASE_TAG" | "COMMIT_SHA" | "APPROVER"
  | "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY" | "PAYSTACK_APPROVED" | "R2_APPROVED" | "SITE_URL" | "CSP_MODE", string>>;
export type StatusFetch = (url: string) => Promise<{ status: number; body: unknown }>; // used by the deployment record
// latestMigration: reads the newest d1_migrations row of the APPROVED UUID (identity-bound); null when there is none.
export type DeployGateDeps = { resolve?: (i: Identity) => ResolvedIdentity; runner?: CfRunner; latestMigration?: (i: Identity) => string | null; wranglerConfig?: string };
export type DeployGate = { ok: boolean; at: string; failures: string[]; notes: string[]; tag: string | null; commit: string | null; approver: string | null;
  identity: (Identity & { worker: string; database: string }) | null; expectedMigration: string; databaseMigration: string | null; compatibility: "verified" | "refused"; cspMode: string | null };

const realRunner: CfRunner = (args, o) => {
  const r = spawnSync(join(ROOT, "node_modules", ".bin", "wrangler"), [...args, "-c", o.config], { cwd: tmpdir(), encoding: "utf8", env: { ...process.env, ...o.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1", CI: "1" } });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
const realLatest = (i: Identity): string | null => {
  const rows = query(remoteTarget(i, { ownerApproved: true }), "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1")[0] ?? [];
  return rows.length ? String(rows[0].name) : null;
};

export async function deployGate(env: GateEnv, deps: DeployGateDeps = {}): Promise<DeployGate> {
  const failures: string[] = [], notes: string[] = [];
  const approved: Identity = { accountId: (env.APPROVED_ACCOUNT_ID ?? "").trim().toLowerCase(), databaseUuid: (env.APPROVED_D1_UUID ?? "").trim().toLowerCase() };
  const out: DeployGate = { ok: false, at: new Date().toISOString(), failures, notes, tag: env.RELEASE_TAG ?? null, commit: env.COMMIT_SHA ?? null, approver: env.APPROVER?.trim() || null,
    identity: null, expectedMigration: EXPECTED_MIGRATION, databaseMigration: null, compatibility: "refused", cspMode: env.CSP_MODE?.trim() || null };
  // release
  if (!env.RELEASE_TAG || !TAG_RE.test(env.RELEASE_TAG)) failures.push("release: RELEASE_TAG must be a release tag vYYYY.MM.DD-N.");
  if (!env.COMMIT_SHA || !/^[0-9a-f]{40}$/.test(env.COMMIT_SHA)) failures.push("release: COMMIT_SHA must be the full 40-character commit.");
  if (!out.approver || out.approver.length < 3) failures.push("release: APPROVER must name the owner approving this deployment.");
  // identity: approved values and the pinned configuration
  const bad = identityProblems(approved, "approved identity");
  failures.push(...bad.map((b) => `identity: ${b} (APPROVED_ACCOUNT_ID / APPROVED_D1_UUID, set by the owner in the production environment).`));
  const cfgFile = deps.wranglerConfig ?? join(ROOT, "wrangler.jsonc");
  let cfg: { name?: string; r2_buckets?: unknown[]; define?: Record<string, string>; vars?: Record<string, string>; d1_databases?: { binding?: string; database_name?: string }[]; kv_namespaces?: { binding?: string; id?: string }[] } = {};
  try { cfg = JSON.parse(stripJsonc(readFileSync(cfgFile, "utf8"))); } catch { failures.push("identity: wrangler.jsonc could not be read."); }
  const pinned = (() => { try { return configuredIdentity(cfgFile); } catch { return { accountId: null, databaseUuid: null }; } })();
  if (cfg.name !== PROD_WORKER) failures.push(`identity: unexpected Worker name ${cfg.name ?? "(none)"} in wrangler.jsonc; expected ${PROD_WORKER}.`);
  const dbs = cfg.d1_databases ?? [];
  const db = dbs.find((d) => d.binding === "DB");
  if (dbs.length !== 1 || !db) failures.push("identity: wrangler.jsonc must have exactly one D1 binding, DB.");
  else if (db.database_name !== PROD_DB) failures.push(`identity: unexpected database name ${db.database_name ?? "(none)"}; expected ${PROD_DB}.`);
  if (!pinned.accountId) failures.push("identity: wrangler.jsonc does not pin account_id (npm run deploy:pin, owner action).");
  else if (!bad.length && pinned.accountId.toLowerCase() !== approved.accountId) failures.push("identity: wrangler.jsonc account_id differs from the approved account.");
  if (!pinned.databaseUuid) failures.push("identity: wrangler.jsonc does not pin the DB binding's database_id (npm run deploy:pin, owner action).");
  else if (!bad.length && pinned.databaseUuid.toLowerCase() !== approved.databaseUuid) failures.push("identity: wrangler.jsonc database_id differs from the approved UUID.");
  // Wrangler 4 creates a NEW resource for a binding without an id when it cannot inherit one (automatic provisioning,
  // also in CI). The KV binding must therefore be pinned to the owner-approved namespace too.
  const approvedKv = (env.APPROVED_KV_ID ?? "").trim().toLowerCase();
  const kvs = cfg.kv_namespaces ?? [];
  const kv = kvs.find((k) => k.binding === "KV");
  if (!/^[0-9a-f]{32}$/.test(approvedKv)) failures.push("identity: the approved KV namespace id is missing or not 32 hexadecimal characters (APPROVED_KV_ID).");
  if (kvs.length !== 1 || !kv) failures.push("identity: wrangler.jsonc must have exactly one KV binding, KV.");
  else if (!kv.id) failures.push("identity: wrangler.jsonc does not pin the KV binding's id; Wrangler could create a new namespace (npm run deploy:pin -- --kv-id, owner action).");
  else if (/^[0-9a-f]{32}$/.test(approvedKv) && kv.id.toLowerCase() !== approvedKv) failures.push("identity: wrangler.jsonc KV id differs from the approved namespace.");
  // scope
  if ((env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "").trim() && env.PAYSTACK_APPROVED !== "true") failures.push("scope: NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY is set but Paystack activation is not approved (PAYSTACK_APPROVED).");
  const definedKey = (cfg.define?.["process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY"] ?? '""').replace(/^"|"$/g, "").trim();
  if (definedKey && env.PAYSTACK_APPROVED !== "true") failures.push("scope: wrangler.jsonc \"define\" sets a Paystack public key but Paystack activation is not approved (PAYSTACK_APPROVED).");
  if (out.cspMode !== "report" && out.cspMode !== "enforce") failures.push("scope: CSP_MODE must be stated as \"report\" or \"enforce\" (the owner's current decision), so a deployment cannot change the policy mode silently.");
  if ((cfg.r2_buckets ?? []).length && env.R2_APPROVED !== "true") failures.push("scope: wrangler.jsonc binds R2 but R2 activation is not approved (R2_APPROVED).");
  if (failures.length) return out;
  out.identity = { ...approved, worker: PROD_WORKER, database: PROD_DB };
  // live identity
  try {
    const r = (deps.resolve ?? ((i) => resolveIdentity(i, { ownerApproved: true })))(approved);
    if (!r.ok) failures.push(...r.failures.map((f) => `identity (live): ${f}`));
  } catch (e) { failures.push(`identity (live): could not be verified (${(e as Error).message.split("\n")[0].slice(0, 160)}).`); }
  if (!failures.length) {
    const runner = deps.runner ?? realRunner;
    const env2 = { CLOUDFLARE_ACCOUNT_ID: approved.accountId };
    const who = runner(["whoami", "--json"], { config: pinnedConfig(approved.accountId, { worker: PROD_WORKER }), env: env2 });
    if (who.status !== 0 || !parseWhoami(who.stdout).accounts.includes(approved.accountId)) failures.push("identity (live): the deployment token cannot use the approved account.");
    else {
      const dl = runner(["deployments", "list", "--name", PROD_WORKER, "--json"], { config: pinnedConfig(approved.accountId, { worker: PROD_WORKER }), env: env2 });
      if (dl.status !== 0) failures.push(`identity (live): Worker ${PROD_WORKER} was not found in the approved account.`);
    }
  }
  if (failures.length) return out;
  // database compatibility, read from the approved D1 UUID itself (read-only, identity-bound)
  try {
    const applied = (deps.latestMigration ?? realLatest)(approved);
    out.databaseMigration = applied;
    if (!applied) failures.push("database: the approved database has no migration history (database state unknown).");
    else {
      const a = Number(applied.slice(0, 4)), e = Number(EXPECTED_MIGRATION.slice(0, 4));
      if (applied === EXPECTED_MIGRATION) out.compatibility = "verified";
      else if (Number.isNaN(a)) failures.push(`database: unrecognised latest migration ${applied}.`);
      else if (a < e || (a === e && applied < EXPECTED_MIGRATION)) failures.push(`database: the production database is at ${applied}; this build needs ${EXPECTED_MIGRATION}. Migrate first (gated procedure), then deploy.`);
      else failures.push(`database: the production database is at ${applied}, newer than this build (${EXPECTED_MIGRATION}): that is a rollback; use the rollback procedure.`);
    }
  } catch (e) { failures.push(`database: the migration history of the approved database could not be read (${(e as Error).message.split("\n")[0].slice(0, 160)}).`); }
  out.ok = failures.length === 0;
  return out;
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  const g = await deployGate(process.env as GateEnv);
  if (a.str("out")) writeFileSync(a.str("out")!, `${JSON.stringify(g, null, 2)}\n`);
  for (const n of g.notes) console.log(`NOTE     ${n}`);
  for (const f of g.failures) console.log(`REFUSED  ${f}`);
  console.log(g.ok ? `DEPLOY GATE PASSED: ${g.tag} (${g.commit?.slice(0, 12)}) -> ${PROD_WORKER}, database ${g.databaseMigration} (${g.compatibility}).` : "DEPLOY GATE FAILED: deployment NOT started.");
  process.exit(g.ok ? 0 : 1);
}
