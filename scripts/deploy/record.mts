// Deployment record and post-deployment verification (Stage 3B). Runs after `wrangler deploy` (also when it failed).
//   - reads the gate result, the GitHub environment approvals and the deploy step's outcome;
//   - finds the deployed Worker version (deployments list, pinned to the approved account);
//   - verifies the live site: /api/status answers ok and reports this build's expected migration as "compatible";
//   - writes the record (commit, tag, version, approver(s), gate, verification, outcome) and exits non-zero unless the
//     outcome is "success". There is NO automatic rollback: on failure it prints the manual, gated rollback procedure.
//   npm run deploy:record -- --gate gate.json --deploy-log deploy.log --out deployment-record.json [--approvals approvals.json]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isMain, parseArgs } from "../db/args.mts";
import { EXPECTED_MIGRATION } from "../../src/server/schema-version.ts";
import { pinnedConfig, PROD_WORKER, type CfRunner } from "../cf.mts";
import type { DeployGate, StatusFetch } from "./gate.mts";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ROOT } from "../db/d1.mts";

export type Outcome = "success" | "deployed-unverified" | "deploy-failed" | "not-deployed";
export type DeploymentRecord = { at: string; outcome: Outcome; tag: string | null; commit: string | null; worker: string; accountId: string | null; versionId: string | null;
  deployedVersionId: string | null; cspMode: string | null;
  approver: string | null; environmentApprovals: { user: string; state: string; comment?: string }[]; workflowRun: string | null;
  gate: { ok: boolean; compatibility: string; databaseMigration: string | null; failures: string[]; notes: string[] } | null;
  verification: { ok: boolean; attempts: number; detail: string }; rollbackGuidance?: string };

export function latestVersion(deploymentsJson: string): string | null {
  try {
    const at = deploymentsJson.search(/[[{]/);
    const list = JSON.parse(deploymentsJson.slice(at)) as { created_on?: string; versions?: { version_id?: string; percentage?: number }[] }[];
    const d = [...list].sort((a, b) => String(b.created_on ?? "").localeCompare(String(a.created_on ?? "")))[0];
    const v = (d?.versions ?? []).sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))[0];
    return v?.version_id ?? null;
  } catch { return null; }
}
// The version id `wrangler deploy` itself printed (Wrangler 4: "Current Version ID: <uuid>").
export function deployedVersion(log: string): string | null {
  return log.match(/Current Version ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1]?.toLowerCase() ?? null;
}
export function parseApprovals(text: string): DeploymentRecord["environmentApprovals"] {
  try {
    const list = JSON.parse(text) as { user?: { login?: string }; state?: string; comment?: string }[];
    return list.map((a) => ({ user: a.user?.login ?? "?", state: a.state ?? "?", ...(a.comment ? { comment: a.comment } : {}) }));
  } catch { return []; }
}

export async function makeRecord(o: { gate: DeployGate | null; deployOutcome: string; approvalsText?: string; workflowRun?: string; siteUrl: string; deployLog?: string },
  deps: { runner?: CfRunner; fetchStatus?: StatusFetch; attempts?: number; waitMs?: number } = {}): Promise<DeploymentRecord> {
  const g = o.gate;
  const rec: DeploymentRecord = { at: new Date().toISOString(), outcome: "not-deployed", tag: g?.tag ?? null, commit: g?.commit ?? null, worker: PROD_WORKER,
    accountId: g?.identity?.accountId ?? null, versionId: null, deployedVersionId: o.deployLog ? deployedVersion(o.deployLog) : null, cspMode: g?.cspMode ?? null, approver: g?.approver ?? null, environmentApprovals: o.approvalsText ? parseApprovals(o.approvalsText) : [],
    workflowRun: o.workflowRun ?? null, gate: g ? { ok: g.ok, compatibility: g.compatibility, databaseMigration: g.databaseMigration, failures: g.failures, notes: g.notes } : null,
    verification: { ok: false, attempts: 0, detail: "not run" } };
  if (!g?.ok) { rec.verification.detail = "gate did not pass; nothing was deployed"; return rec; }
  if (o.deployOutcome !== "success") rec.outcome = "deploy-failed";
  if (rec.accountId) {
    const runner: CfRunner = deps.runner ?? ((args, x) => { const r = spawnSync(join(ROOT, "node_modules", ".bin", "wrangler"), [...args, "-c", x.config], { cwd: tmpdir(), encoding: "utf8", env: { ...process.env, ...x.env, CI: "1" } }); return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }; });
    const dl = runner(["deployments", "list", "--name", PROD_WORKER, "--json"], { config: pinnedConfig(rec.accountId, { worker: PROD_WORKER }), env: { CLOUDFLARE_ACCOUNT_ID: rec.accountId } });
    rec.versionId = dl.status === 0 ? latestVersion(dl.stdout)?.toLowerCase() ?? null : null;
  }
  if (rec.outcome === "deploy-failed") { rec.rollbackGuidance = guidance(); return rec; }
  // Stage 3B.1: the live version must be the one THIS run deployed. Anything else means another deployment path (for
  // example a Git-connected Cloudflare build) published in between, and this release is not what visitors get.
  if (!rec.deployedVersionId || rec.versionId !== rec.deployedVersionId) {
    rec.outcome = "deployed-unverified";
    rec.verification.detail = !rec.deployedVersionId ? "the deployed version id could not be read from wrangler deploy's output"
      : `the live version (${rec.versionId ?? "unknown"}) is not the version this run deployed (${rec.deployedVersionId}): another deployment may have published`;
    rec.rollbackGuidance = guidance();
    return rec;
  }
  const fetchStatus: StatusFetch = deps.fetchStatus ?? (async (u) => { const r = await fetch(u, { headers: { "cache-control": "no-store" } }); return { status: r.status, body: await r.json().catch(() => null) }; });
  const attempts = deps.attempts ?? 6;
  let detail = "";
  for (let i = 1; i <= attempts; i++) {
    rec.verification.attempts = i;
    try {
      const st = await fetchStatus(`${o.siteUrl.replace(/\/+$/, "")}/api/status`);
      const b = st.body as { ok?: boolean; schema?: { expected?: string; status?: string } } | null;
      if (st.status === 200 && b?.ok === true && b.schema?.expected === EXPECTED_MIGRATION && b.schema?.status === "compatible") { rec.verification = { ok: true, attempts: i, detail: `ok; schema ${EXPECTED_MIGRATION} compatible` }; break; }
      detail = `status ${st.status}, ok=${String(b?.ok)}, expected=${b?.schema?.expected ?? "none"}, schema=${b?.schema?.status ?? "none"}`;
    } catch (e) { detail = (e as Error).message.split("\n")[0].slice(0, 160); }
    if (i < attempts) await new Promise((r) => setTimeout(r, deps.waitMs ?? 10_000));
  }
  if (!rec.verification.ok) rec.verification.detail = detail || "not verified";
  rec.outcome = rec.verification.ok ? "success" : "deployed-unverified";
  if (!rec.verification.ok) rec.rollbackGuidance = guidance();
  return rec;
}
const guidance = () => "No automatic rollback. Follow docs/SMA_STAGE_3A_DISASTER_RECOVERY_RUNBOOK.md section 4: npm run db:rollback-check (identity-bound, with --version-id and --record), then npm run cf -- worker-rollback with the owner's approval.";

if (isMain(import.meta.url)) {
  const a = parseArgs();
  const gate = a.str("gate") && existsSync(a.str("gate")!) ? JSON.parse(readFileSync(a.str("gate")!, "utf8")) as DeployGate : null;
  const deployLog = a.str("deploy-log") && existsSync(a.str("deploy-log")!) ? readFileSync(a.str("deploy-log")!, "utf8") : undefined;
  const approvalsText = a.str("approvals") && existsSync(a.str("approvals")!) ? readFileSync(a.str("approvals")!, "utf8") : undefined;
  const rec = await makeRecord({ gate, deployOutcome: process.env.DEPLOY_OUTCOME ?? "unknown", approvalsText, workflowRun: process.env.WORKFLOW_RUN_URL, deployLog, siteUrl: process.env.SITE_URL ?? "https://skillmountainacademy.com" });
  writeFileSync(a.str("out") ?? "deployment-record.json", `${JSON.stringify(rec, null, 2)}\n`);
  console.log(`DEPLOYMENT ${rec.outcome.toUpperCase()}: ${rec.tag ?? "?"} ${rec.commit?.slice(0, 12) ?? ""} version ${rec.versionId ?? "?"}; ${rec.verification.detail}`);
  if (rec.rollbackGuidance) console.log(rec.rollbackGuidance);
  process.exit(rec.outcome === "success" ? 0 : 1);
}
