// Stage 3B: deployment gate, identity pinning, CI-status check, deployment record, backup shipping checks, the security
// scripts and the policies the workflows must keep. Pure logic with fakes: nothing remote is contacted.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { deployGate, TAG_RE, type GateEnv, type StatusFetch } from "../scripts/deploy/gate.mts";
import { pinText } from "../scripts/deploy/pin.mts";
import { ciPassed, REQUIRED_CHECKS } from "../scripts/deploy/ci-status.mts";
import { deployedVersion, latestVersion, makeRecord, parseApprovals } from "../scripts/deploy/record.mts";
import { inspectBackup, verifyUploaded } from "../scripts/backup/ship.mts";
import { scan } from "../scripts/security/secret-scan.mts";
import { checkCsp } from "../scripts/security/csp-check.mts";
import { configuredIdentity } from "../scripts/db/migrate-remote.mts";
import { EXPECTED_MIGRATION } from "../src/server/schema-version.ts";
import type { CfRunner } from "../scripts/cf.mts";
import type { Identity, ResolvedIdentity } from "../scripts/db/d1.mts";

const ACC = "0123456789abcdef0123456789abcdef";
const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const SHA = "a".repeat(40);
const D = mkdtempSync(join(tmpdir(), "sma-3b-"));
after(() => rmSync(D, { recursive: true, force: true }));
const REAL_CFG = readFileSync("wrangler.jsonc", "utf8");
const cfgFile = (text: string) => { const f = join(D, `w-${Math.random().toString(36).slice(2)}.jsonc`); writeFileSync(f, text); return f; };
const KVID = "c".repeat(32);
const pin3 = (acc = ACC, uuid = UUID, kv = KVID) => pinText(REAL_CFG, acc, uuid, kv).text;
const pinnedCfg = (acc = ACC, uuid = UUID, kv = KVID) => cfgFile(pin3(acc, uuid, kv));

// ------------------------------------------------------------------ pinning ----
test("deploy:pin pins the real wrangler.jsonc (comments kept), is idempotent, and never replaces a different value", () => {
  const r = pinText(REAL_CFG, ACC, UUID);
  assert.deepEqual(r.failures, []);
  assert.equal(r.changes.length, 2);
  assert.deepEqual(configuredIdentity(cfgFile(r.text)), { accountId: ACC, databaseUuid: UUID });
  assert.equal(r.text.split("\n").length, REAL_CFG.split("\n").length + 1, "one new line for account_id; database_id joins the binding line");
  for (const line of REAL_CFG.split("\n").filter((l) => l.trim().startsWith("//"))) assert.ok(r.text.includes(line), "every comment kept");
  assert.deepEqual(pinText(r.text, ACC, UUID).changes, [], "already pinned: no change");
  assert.ok(pinText(r.text, "b".repeat(32), UUID).failures.some((f) => /DIFFERENT account_id/.test(f)));
  assert.ok(pinText(r.text, ACC, OTHER).failures.some((f) => /DIFFERENT database_id/.test(f)));
  assert.ok(pinText(REAL_CFG, ACC, "").failures.some((f) => /UUID is missing/.test(f)));
  const k = pinText(r.text, ACC, UUID, KVID);
  assert.deepEqual(k.changes, [`KV id = ${KVID}`]);
  assert.match(k.text, new RegExp(`\\{ "binding": "KV", "id": "${KVID}" \\}`));
  assert.ok(pinText(k.text, ACC, UUID, "d".repeat(32)).failures.some((f) => /DIFFERENT id/.test(f)));
  assert.ok(pinText(r.text, ACC, UUID, "not-an-id").failures.some((f) => /32 hexadecimal/.test(f)));
});

// ------------------------------------------------------------------ deployment gate ----
const goodEnv: GateEnv = { APPROVED_ACCOUNT_ID: ACC, APPROVED_D1_UUID: UUID, APPROVED_KV_ID: KVID, RELEASE_TAG: "v2026.11.30-1", COMMIT_SHA: SHA, APPROVER: "Owner Name", SITE_URL: "https://skillmountainacademy.com", CSP_MODE: "report" };
function liveFakes(o: { identityOk?: boolean; member?: boolean; worker?: boolean; migration?: string | null | Error } = {}) {
  const reads: Identity[] = [];
  const resolve = (i: Identity): ResolvedIdentity => ({ ok: o.identityOk ?? true, at: "", approved: i, byId: null, byName: null, accountAccessible: true, failures: o.identityOk === false ? ["database: in the approved account the name resolves to a DIFFERENT UUID"] : [] });
  const runner: CfRunner = (args, x) => {
    assert.equal(JSON.parse(readFileSync(x.config, "utf8")).account_id, ACC);
    assert.equal(x.env.CLOUDFLARE_ACCOUNT_ID, ACC);
    if (args[0] === "whoami") return { status: 0, stderr: "", stdout: JSON.stringify({ loggedIn: true, accounts: [{ id: (o.member ?? true) ? ACC : "f".repeat(32) }] }) };
    return (o.worker ?? true) ? { status: 0, stderr: "", stdout: "[]" } : { status: 1, stderr: "not found", stdout: "" };
  };
  // The approved database's own migration history (identity-bound read in production).
  const latestMigration = (i: Identity) => { reads.push(i); if (o.migration instanceof Error) throw o.migration; return o.migration === undefined ? EXPECTED_MIGRATION : o.migration; };
  return { reads, deps: { resolve, runner, latestMigration } };
}
const gateRefused = async (env: GateEnv, deps: object, re: RegExp) => { const g = await deployGate(env, deps); assert.equal(g.ok, false); assert.ok(g.failures.some((f) => re.test(f)), g.failures.join(" | ")); return g; };

test("deploy gate: passes only with a pinned, live-proven identity and a database at exactly this build's migration", async () => {
  const f = liveFakes();
  const g = await deployGate(goodEnv, { ...f.deps, wranglerConfig: pinnedCfg() });
  assert.deepEqual([g.ok, g.failures, g.compatibility, g.databaseMigration], [true, [], "verified", EXPECTED_MIGRATION]);
  assert.deepEqual(f.reads, [{ accountId: ACC, databaseUuid: UUID }], "compatibility read from the APPROVED account and UUID, not a public URL");
  assert.equal(g.cspMode, "report");
  assert.deepEqual(g.identity, { accountId: ACC, databaseUuid: UUID, worker: "skillmountainacademy", database: "skillmountainacademy-db" });
  assert.ok(TAG_RE.test("v2026.11.30-1") && !TAG_RE.test("v2026.13.01-1") && !TAG_RE.test("main") && !TAG_RE.test("v1.2.3"));
});

test("deploy gate rejects missing or mismatched account IDs and database UUIDs, unpinned configuration, and unexpected Worker or database names", async () => {
  const d = liveFakes().deps;
  await gateRefused({ ...goodEnv, APPROVED_ACCOUNT_ID: "" }, { ...d, wranglerConfig: pinnedCfg() }, /account ID is missing/);
  await gateRefused({ ...goodEnv, APPROVED_D1_UUID: "" }, { ...d, wranglerConfig: pinnedCfg() }, /UUID is missing/);
  await gateRefused(goodEnv, { ...d, wranglerConfig: cfgFile(REAL_CFG) }, /does not pin account_id/);
  await gateRefused(goodEnv, { ...d, wranglerConfig: cfgFile(REAL_CFG) }, /does not pin the DB binding's database_id/);
  await gateRefused(goodEnv, { ...d, wranglerConfig: pinnedCfg("b".repeat(32), UUID) }, /account_id differs from the approved account/);
  await gateRefused(goodEnv, { ...d, wranglerConfig: pinnedCfg(ACC, OTHER) }, /database_id differs from the approved UUID/);
  await gateRefused(goodEnv, { ...d, wranglerConfig: cfgFile(pin3().replace('"name": "skillmountainacademy"', '"name": "skillmountainacademy-staging"')) }, /unexpected Worker name skillmountainacademy-staging/);
  await gateRefused(goodEnv, { ...d, wranglerConfig: cfgFile(pin3().replace('"database_name": "skillmountainacademy-db"', '"database_name": "other-db"')) }, /unexpected database name other-db/);
  // KV: an unpinned binding would let Wrangler create a new namespace during the deployment.
  await gateRefused(goodEnv, { ...d, wranglerConfig: cfgFile(pinText(REAL_CFG, ACC, UUID).text) }, /does not pin the KV binding's id/);
  await gateRefused(goodEnv, { ...d, wranglerConfig: pinnedCfg(ACC, UUID, "d".repeat(32)) }, /KV id differs/);
  await gateRefused({ ...goodEnv, APPROVED_KV_ID: "" }, { ...d, wranglerConfig: pinnedCfg() }, /APPROVED_KV_ID/);
  // A matching NAME with the wrong UUID in the live proof is refused.
  await gateRefused(goodEnv, { ...liveFakes({ identityOk: false }).deps, wranglerConfig: pinnedCfg() }, /identity \(live\): .*DIFFERENT UUID/);
  await gateRefused(goodEnv, { ...liveFakes({ member: false }).deps, wranglerConfig: pinnedCfg() }, /cannot use the approved account/);
  await gateRefused(goodEnv, { ...liveFakes({ worker: false }).deps, wranglerConfig: pinnedCfg() }, /Worker skillmountainacademy was not found/);
});

test("deploy gate: database compatibility read from the approved D1 UUID itself; older, newer, empty or unreadable refused; no attestation path", async () => {
  const at = (migration: string | null | Error) => liveFakes({ migration }).deps;
  const cfg = pinnedCfg();
  await gateRefused(goodEnv, { ...at("0009_owner.sql"), wranglerConfig: cfg }, /Migrate first/);
  await gateRefused(goodEnv, { ...at("0013_future.sql"), wranglerConfig: cfg }, /newer than this build .* rollback procedure/);
  await gateRefused(goodEnv, { ...at(null), wranglerConfig: cfg }, /no migration history/);
  await gateRefused(goodEnv, { ...at(new Error("D1 query refused: permission")), wranglerConfig: cfg }, /could not be read \(D1 query refused: permission\)/);
  await gateRefused(goodEnv, { ...at("garbage.sql"), wranglerConfig: cfg }, /unrecognised latest migration/);
  // The former owner attestation no longer exists: an env value cannot stand in for the database's real state.
  await gateRefused({ ...goodEnv, CONFIRMED_DB_MIGRATION: EXPECTED_MIGRATION } as GateEnv, { ...at("0009_owner.sql"), wranglerConfig: cfg }, /Migrate first/);
  // The database is not read at all when the identity is not proven first.
  const f = liveFakes({ identityOk: false });
  await gateRefused(goodEnv, { ...f.deps, wranglerConfig: cfg }, /identity \(live\)/);
  assert.deepEqual(f.reads, []);
});

test("deploy gate: release, approver and scope (no Paystack or R2 activation through a deployment)", async () => {
  const d = { ...liveFakes().deps, wranglerConfig: pinnedCfg() };
  await gateRefused({ ...goodEnv, RELEASE_TAG: "main" }, d, /release tag vYYYY\.MM\.DD-N/);
  await gateRefused({ ...goodEnv, COMMIT_SHA: "abc" }, d, /full 40-character commit/);
  await gateRefused({ ...goodEnv, APPROVER: "" }, d, /APPROVER must name the owner/);
  await gateRefused({ ...goodEnv, NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: "pk_test_123" }, d, /Paystack activation is not approved/);
  assert.equal((await deployGate({ ...goodEnv, NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: "pk_test_123", PAYSTACK_APPROVED: "true" }, d)).ok, true);
  const r2 = cfgFile(pin3().replace(/\n\}\s*$/, ',\n  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "x" }]\n}\n'));
  await gateRefused(goodEnv, { ...d, wranglerConfig: r2 }, /binds R2 but R2 activation is not approved/);
  // Stage 3B.1: a Paystack key placed in wrangler.jsonc "define" is refused too; CSP_MODE must be stated.
  const defined = cfgFile(pin3().replace('"process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY": "\\"\\""', '"process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY": "\\"pk_live_abc\\""'));
  assert.notEqual(readFileSync(defined, "utf8"), pin3(), "fixture really changed the define");
  await gateRefused(goodEnv, { ...d, wranglerConfig: defined }, /"define" sets a Paystack public key/);
  await gateRefused({ ...goodEnv, CSP_MODE: "" }, d, /CSP_MODE must be stated/);
  await gateRefused({ ...goodEnv, CSP_MODE: "off" }, d, /CSP_MODE must be stated/);
  assert.equal((await deployGate({ ...goodEnv, CSP_MODE: "enforce" }, d)).cspMode, "enforce");
});

// ------------------------------------------------------------------ CI status, record ----
test("CI status: every required check must have succeeded on the exact commit (latest run counts)", () => {
  const run = (name: string, conclusion: string, started = "2026-11-22T10:00:00Z", sha = SHA, app = "github-actions") => ({ name, head_sha: sha, status: "completed", conclusion, started_at: started, app: { slug: app } });
  assert.equal(ciPassed({ check_runs: REQUIRED_CHECKS.map((n) => run(n, "success")) }, SHA).ok, true);
  assert.ok(ciPassed({ check_runs: REQUIRED_CHECKS.slice(1).map((n) => run(n, "success")) }, SHA).failures.some((f) => /CI static checks: no run/.test(f)));
  assert.equal(ciPassed({ check_runs: REQUIRED_CHECKS.map((n) => run(n, n === "CI tests" ? "failure" : "success")) }, SHA).ok, false);
  assert.equal(ciPassed({ check_runs: REQUIRED_CHECKS.map((n) => run(n, "success", undefined, "b".repeat(40))) }, SHA).ok, false, "another commit's success does not count");
  const rerun = [...REQUIRED_CHECKS.map((n) => run(n, "success", "2026-11-22T11:00:00Z")), run("CI tests", "failure", "2026-11-22T10:00:00Z")];
  assert.equal(ciPassed({ check_runs: rerun }, SHA).ok, true, "a later successful re-run counts");
  // Stage 3B.1: a check run with a required name from any other app does not count.
  const spoof = REQUIRED_CHECKS.map((n) => run(n, "success", "2026-11-22T12:00:00Z", SHA, "some-other-app"));
  assert.equal(ciPassed({ check_runs: spoof }, SHA).ok, false);
  assert.equal(ciPassed({ check_runs: [...REQUIRED_CHECKS.map((n) => run(n, n === "CI tests" ? "failure" : "success")), ...spoof] }, SHA).ok, false, "a spoofed success cannot override a real failure");
});

test("deployment record: not-deployed / deploy-failed / deployed-unverified / success; version and approvals captured; never a rollback", async () => {
  const gate = { ...(await deployGate(goodEnv, { ...liveFakes().deps, wranglerConfig: pinnedCfg() })) };
  assert.equal(gate.ok, true);
  const ok: StatusFetch = async () => ({ status: 200, body: { ok: true, schema: { expected: EXPECTED_MIGRATION, status: "compatible" } } });
  const approvals = JSON.stringify([{ user: { login: "owner-login" }, state: "approved", comment: "go" }]);
  const V_NEW = "11111111-2222-4333-8444-555555555555", V_OTHER = "99999999-2222-4333-8444-555555555555";
  const runner: CfRunner = () => ({ status: 0, stderr: "", stdout: JSON.stringify([{ created_on: "2026-11-30T10:00:00Z", versions: [{ version_id: V_NEW, percentage: 100 }] }, { created_on: "2026-11-01T10:00:00Z", versions: [{ version_id: "v-old", percentage: 100 }] }]) });
  const log = `Uploaded skillmountainacademy\nDeployed skillmountainacademy triggers\nCurrent Version ID: ${V_NEW}\n`;
  const s = await makeRecord({ gate, deployOutcome: "success", approvalsText: approvals, siteUrl: "https://x.example", workflowRun: "run-1", deployLog: log }, { runner, fetchStatus: ok, attempts: 1, waitMs: 0 });
  assert.deepEqual([s.outcome, s.versionId, s.deployedVersionId, s.cspMode, s.commit, s.tag, s.approver, s.environmentApprovals[0].user], ["success", V_NEW, V_NEW, "report", SHA, "v2026.11.30-1", "Owner Name", "owner-login"]);
  assert.equal(deployedVersion(log), V_NEW);
  // Stage 3B.1: another deployment path published after ours, or our version is unknown: never "success".
  const other = await makeRecord({ gate, deployOutcome: "success", siteUrl: "https://x.example", deployLog: `Current Version ID: ${V_OTHER}` }, { runner, fetchStatus: ok, attempts: 1, waitMs: 0 });
  assert.equal(other.outcome, "deployed-unverified");
  assert.match(other.verification.detail, /not the version this run deployed/);
  const nolog = await makeRecord({ gate, deployOutcome: "success", siteUrl: "https://x.example" }, { runner, fetchStatus: ok, attempts: 1, waitMs: 0 });
  assert.equal(nolog.outcome, "deployed-unverified");
  assert.equal(s.rollbackGuidance, undefined);
  const stale: StatusFetch = async () => ({ status: 200, body: { ok: true, schema: { expected: "0009_owner.sql", status: "database_newer" } } });
  const u = await makeRecord({ gate, deployOutcome: "success", siteUrl: "https://x.example", deployLog: log }, { runner, fetchStatus: stale, attempts: 2, waitMs: 0 });
  assert.deepEqual([u.outcome, u.verification.attempts], ["deployed-unverified", 2]);
  assert.match(u.rollbackGuidance!, /No automatic rollback/);
  const f = await makeRecord({ gate, deployOutcome: "failure", siteUrl: "https://x.example" }, { runner, fetchStatus: ok });
  assert.equal(f.outcome, "deploy-failed");
  const n = await makeRecord({ gate: { ...gate, ok: false }, deployOutcome: "skipped", siteUrl: "https://x.example" }, { runner, fetchStatus: ok });
  assert.equal(n.outcome, "not-deployed");
  assert.equal(latestVersion("garbage"), null);
  assert.deepEqual(parseApprovals("not json"), []);
});

// ------------------------------------------------------------------ backup shipping ----
function backupDir(o: { plain?: boolean; encCount?: number; encrypted?: boolean; identity?: Identity; createdAt?: string; rows?: number; kind?: string; tamper?: boolean } = {}) {
  const d = join(D, `bk-${Math.random().toString(36).slice(2)}`); mkdirSync(d);
  const name = "skillmountainacademy-db-20261122T021700Z-m0010";
  for (let i = 0; i < (o.encCount ?? 1); i++) writeFileSync(join(d, i ? `${name}-${i}.sql.enc` : `${name}.sql.enc`), `ciphertext${i}`);
  if (o.plain) writeFileSync(join(d, `${name}.sql`), "plaintext");
  writeFileSync(join(d, `${name}.sql.manifest.json`), JSON.stringify({ createdAt: o.createdAt ?? new Date().toISOString(), source: { kind: o.kind ?? "remote", database: "skillmountainacademy-db", identity: o.identity ?? { accountId: ACC, databaseUuid: UUID } },
    migration: { latest: "0010_owner_integrity.sql" }, totals: { institutionalRows: o.rows ?? 1000 }, ...(o.encrypted === false ? {} : { encrypted: { sha256: o.tamper ? "0".repeat(64) : createHash("sha256").update("ciphertext0").digest("hex") } }) }));
  return d;
}
const shipFails = (o: Parameters<typeof backupDir>[0], re: RegExp, extra: object = {}) => { const r = inspectBackup({ dir: backupDir(o), approved: { accountId: ACC, databaseUuid: UUID }, ...extra }); assert.equal(r.ok, false); assert.ok(r.failures.some((f) => re.test(f)), r.failures.join(" | ")); };

test("backup shipping: only a fresh, encrypted, identity-matched backup with records is shipped, under a write-once key", () => {
  const r = inspectBackup({ dir: backupDir(), approved: { accountId: ACC, databaseUuid: UUID }, prefix: "sma-d1" });
  assert.deepEqual([r.ok, r.failures], [true, []]);
  assert.deepEqual(r.keys, { enc: "sma-d1/2026/11/skillmountainacademy-db-20261122T021700Z-m0010.sql.enc", manifest: "sma-d1/2026/11/skillmountainacademy-db-20261122T021700Z-m0010.sql.manifest.json" });
  shipFails({ plain: true }, /plaintext backup present/);
  shipFails({ encCount: 0 }, /found 0/);
  shipFails({ encCount: 2 }, /found 2/);
  shipFails({ encrypted: false }, /does not describe an encrypted backup/);
  shipFails({ tamper: true }, /does not match its manifest/);
  shipFails({ kind: "local" }, /not production/);
  shipFails({ identity: { accountId: ACC, databaseUuid: OTHER } }, /not of the approved account ID and D1 UUID/);
  shipFails({ createdAt: new Date(Date.now() - 5 * 3600_000).toISOString() }, /5\.0 hours old/);
  shipFails({ rows: 0 }, /no institutional records/);
  shipFails({}, /fell from 1100 to 1000/, { previous: { totals: { institutionalRows: 1100 }, migration: { latest: "0010_owner_integrity.sql" } } });
  const w = inspectBackup({ dir: backupDir(), approved: { accountId: ACC, databaseUuid: UUID }, previous: { totals: { institutionalRows: 1020 }, migration: { latest: "0009_owner.sql" } } as never });
  assert.equal(w.ok, true, "a 2% drop is within the limit");
  assert.ok(w.warnings.some((x) => /migration changed/.test(x)));
  shipFails({}, /UUID is missing/, { approved: { accountId: ACC, databaseUuid: "" } });
});

test("backup shipping: the stored copy is verified by size and SHA-256", () => {
  const f = join(D, "x.sql.enc"); writeFileSync(f, "ciphertext");
  const b64 = createHash("sha256").update("ciphertext").digest("base64");
  assert.equal(verifyUploaded({ ContentLength: 10, ChecksumSHA256: b64 }, f).ok, true);
  assert.equal(verifyUploaded({ ContentLength: 9, ChecksumSHA256: b64 }, f).ok, false);
  assert.equal(verifyUploaded({ ContentLength: 10 }, f).ok, false);
  assert.equal(verifyUploaded({ ContentLength: 10, ChecksumSHA256: "AAAA" }, f).ok, false);
});

// ------------------------------------------------------------------ security scripts ----
test("secret scan: finds real credential patterns and secret files; ignores documented placeholders; the repository is clean", () => {
  const d = join(D, "repo"); mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src", "a.ts"), `const k = "sk_live_${"A1b2C3d4E5".repeat(2)}";\n`);
  writeFileSync(join(d, "src", "b.ts"), `${"-".repeat(5)}BEGIN ${"PRIVATE"} KEY${"-".repeat(5)}\n`);
  writeFileSync(join(d, ".dev.vars"), "X=1\n");
  writeFileSync(join(d, ".dev.vars.example"), "PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxx\nTURNSTILE_SECRET=1x0000000000000000000000000000000AA\nMFA_ENCRYPTION_KEY=replace-with-base64\n");
  const f = scan(d);
  assert.deepEqual(f.map((x) => `${x.file}:${x.kind}`).sort(), [".dev.vars:secret-bearing file must not be in the repository", "src/a.ts:Paystack secret key", "src/b.ts:private key"]);
  assert.ok(!JSON.stringify(f).includes("A1b2C3d4E5"), "the matched value is never reported");
  assert.deepEqual(scan(process.cwd()), [], "this repository passes");
});

test("CSP check: the built site passes; missing headers, unsafe-inline, unhashed scripts, Paystack outside payment pages and blob: fail", () => {
  if (existsSync("out/_headers")) assert.deepEqual(checkCsp("out").failures, []);
  const site = (headers: string, html = "<script>a()</script>") => { const d = join(D, `out-${Math.random().toString(36).slice(2)}`); mkdirSync(join(d, "about"), { recursive: true }); writeFileSync(join(d, "_headers"), headers); writeFileSync(join(d, "about", "index.html"), html); return d; };
  const h = `'sha256-${createHash("sha256").update("a()").digest("base64")}'`;
  const base = "/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=()\n  Strict-Transport-Security: max-age=1\n  Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'\n";
  const page = (pol: string) => `${base}/about/\n  Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' ${pol}\n`;
  assert.deepEqual(checkCsp(site(page(h))).failures, []);
  assert.ok(checkCsp(site(page(h).replace("  X-Frame-Options: DENY\n", ""))).failures.some((f) => /X-Frame-Options/.test(f)));
  assert.ok(checkCsp(site(page(`${h} 'unsafe-inline'`))).failures.some((f) => /unsafe-inline/.test(f)));
  assert.ok(checkCsp(site(page("'sha256-AAAA'"))).failures.some((f) => /not covered/.test(f)));
  assert.ok(checkCsp(site(page(`${h} https://js.paystack.co`))).failures.some((f) => /Paystack outside the payment pages/.test(f)));
  assert.ok(checkCsp(site(page(`${h} blob:`))).failures.some((f) => /blob:/.test(f)));
});

// ------------------------------------------------------------------ workflow policies ----
type Wf = { on: Record<string, unknown>; permissions?: unknown; jobs: Record<string, { name?: string; environment?: unknown; permissions?: unknown; if?: string; steps: { uses?: string; run?: string; with?: Record<string, unknown> }[] }> };
const wf = (f: string) => yaml.load(readFileSync(join(".github/workflows", f), "utf8")) as Wf;
const allSteps = (w: Wf) => Object.values(w.jobs).flatMap((j) => j.steps);

test("workflows: third-party actions pinned to full SHAs, least-privilege permissions, no inputs interpolated into shell", () => {
  for (const f of ["ci.yml", "deploy-worker.yml", "backup.yml", "restore-drill.yml"]) {
    const w = wf(f);
    assert.ok(w.permissions !== undefined, `${f}: workflow-level permissions set`);
    for (const s of allSteps(w)) if (s.uses) assert.match(s.uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${f}: ${s.uses} pinned to a commit SHA`);
    for (const s of allSteps(w)) if (s.run) assert.doesNotMatch(s.run, /\$\{\{\s*(inputs|github\.event)\./, `${f}: inputs reach shell only through env`);
    for (const s of allSteps(w)) if (s.uses?.startsWith("actions/checkout@")) assert.equal(s.with?.["persist-credentials"], false, `${f}: checkout without persisted credentials`);
  }
});

test("CI workflow: PRs and pushes to main, Node 22, every required stage, and job names equal the deployment's required checks", () => {
  const w = wf("ci.yml");
  assert.deepEqual((w.on.pull_request as { branches: string[] }).branches, ["main"]);
  assert.deepEqual((w.on.push as { branches: string[] }).branches, ["main"]);
  assert.deepEqual(w.permissions, { contents: "read" });
  assert.deepEqual(Object.values(w.jobs).map((j) => j.name).sort(), [...REQUIRED_CHECKS].sort());
  for (const s of allSteps(w)) if (s.uses?.startsWith("actions/setup-node@")) assert.equal(s.with?.["node-version"], 22);
  const runs = allSteps(w).map((s) => s.run ?? "").join("\n");
  for (const cmd of ["npm ci", "npx tsc -p tsconfig.json --noEmit", "npx tsc -p src/tsconfig.json --noEmit", "npx eslint .", "npm test", "npm run db:check", "npm run build", "npm run security:csp", "npm audit", "npm run security:secrets"])
    assert.ok(runs.includes(cmd), `CI runs ${cmd}`);
});

test("deployment workflow: manual only, production environment, CI and gate before deploy, no migration, no rollback, record kept", () => {
  const w = wf("deploy-worker.yml");
  assert.deepEqual(Object.keys(w.on), ["workflow_dispatch"], "never on push");
  const d = w.jobs.deploy;
  assert.deepEqual((d.environment as { name: string }).name, "production");
  assert.deepEqual(d.permissions, { contents: "read", actions: "read" });
  const runs = d.steps.map((s) => s.run ?? "");
  const gateAt = runs.findIndex((r) => r.includes("npm run deploy:gate")), deployAt = runs.findIndex((r) => r.includes("npx wrangler deploy"));
  assert.ok(gateAt >= 0 && deployAt > gateAt, "gate before deploy");
  assert.ok(runs.some((r) => r.includes("npm run deploy:record")));
  const all = readFileSync(".github/workflows/deploy-worker.yml", "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.doesNotMatch(all, /migrations apply|db:migrate|wrangler rollback|worker-rollback|dns/i);
  assert.ok(allSteps(w).some((s) => (s.run ?? "").includes("ci-status.mts")));
});

test("backup workflow: off until enabled, backups environment, encrypted before storage, write-once upload, verified, failure issue", () => {
  const w = wf("backup.yml");
  const j = w.jobs.backup;
  assert.equal(j.if, "${{ vars.BACKUP_ENABLED == 'true' }}");
  assert.equal(j.environment, "backups");
  const text = readFileSync(".github/workflows/backup.yml", "utf8");
  assert.match(text, /--encrypt-for db\/keys\/owner-backup-public\.pem/);
  assert.match(text, /--if-none-match '\*'/);
  assert.match(text, /backup:ship -- inspect/);
  assert.match(text, /backup:ship -- verify/);
  assert.doesNotMatch(text, /--body "?\$\{?ENC_FILE%\.enc|\.sql"/, "never uploads plaintext");
  assert.ok(j.steps.some((s) => (s.run ?? "").includes("gh issue create")));
  assert.equal(Object.keys(wf("restore-drill.yml").on).includes("schedule"), true);
});

test("the existing GitHub Pages workflow is untouched", () => {
  const text = readFileSync(".github/workflows/deploy.yml", "utf8");
  assert.match(text, /GitHub Pages/);
  assert.match(text, /actions\/deploy-pages/);
});

// ------------------------------------------------------------------ staging separation ----
test("staging configuration: separate Worker, database (by UUID), cache and settings; refused until complete; production config untouched", async () => {
  const { checkStaging } = await import("../scripts/deploy/staging-check.mts");
  const { stripJsonc } = await import("../scripts/db/migrate-remote.mts");
  const prod = JSON.parse(stripJsonc(REAL_CFG));
  const staging = JSON.parse(stripJsonc(readFileSync("wrangler.staging.jsonc", "utf8")));
  // As shipped: isolated by design but not usable until the owner fills in its own ids.
  const shipped = checkStaging(staging, prod, { productionUuid: UUID });
  for (const re of [/account_id is not pinned/, /database_id \(exact UUID\) is not filled in/, /KV namespace id is not filled in/, /SITE_URL is not filled in/]) assert.ok(shipped.some((f) => re.test(f)), String(re));
  assert.ok(!shipped.some((f) => /not a separate|routes|crons|Paystack|R2/.test(f)), shipped.join(" | "));
  const filled = { ...staging, account_id: ACC, d1_databases: [{ ...staging.d1_databases[0], database_id: OTHER }], kv_namespaces: [{ binding: "KV", id: "stagingkv" }],
    vars: { ...staging.vars, SITE_URL: "https://skillmountainacademy-staging.example.workers.dev", OWNER_EMAIL: "owner-staging@example.com" } };
  assert.deepEqual(checkStaging(filled, prod, { productionUuid: UUID, productionKv: "prodkv" }), []);
  const bad = (o: object, re: RegExp) => assert.ok(checkStaging({ ...filled, ...o }, prod, { productionUuid: UUID, productionKv: "prodkv" }).some((f) => re.test(f)), String(re));
  bad({ d1_databases: [{ ...filled.d1_databases[0], database_id: UUID }] }, /IS THE PRODUCTION DATABASE/);
  bad({ kv_namespaces: [{ binding: "KV", id: "prodkv" }] }, /IS THE PRODUCTION NAMESPACE/);
  bad({ name: "skillmountainacademy" }, /not a separate staging Worker/);
  bad({ d1_databases: [{ ...filled.d1_databases[0], database_name: "skillmountainacademy-db" }] }, /not a separate staging database/);
  bad({ routes: [{ pattern: "skillmountainacademy.com/*" }] }, /routes or custom domains/);
  bad({ vars: { ...filled.vars, SITE_URL: "https://skillmountainacademy.com" } }, /production/);
  bad({ vars: { ...filled.vars, OWNER_EMAIL: "bookebukar@gmail.com" } }, /production owner address/);
  bad({ triggers: { crons: ["*/5 * * * *"] } }, /crons/);
  bad({ define: { "process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY": "\"pk_test_1\"" } }, /Paystack/);
  assert.equal(prod.name, "skillmountainacademy");
  assert.equal(prod.account_id, undefined, "production wrangler.jsonc not pinned or changed by this stage");
});

// ------------------------------------------------------------------ Stage 3B.1 corrections ----
test("3B.1: no npm script reaches production without a gate (bare wrangler deploy, remote D1 writes, migrations apply)", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
  for (const [name, cmd] of Object.entries(scripts)) {
    if (/\bwrangler\s+deploy\b/.test(cmd)) assert.match(cmd, /scripts\/deploy\/gate\.mts\s*&&\s*wrangler deploy/, `${name} deploys only after the gate`);
    assert.doesNotMatch(cmd, /wrangler\s+d1\s+(execute|migrations\s+apply|create|time-travel)|wrangler\s+rollback/, `${name} must not call remote D1 or rollback directly`);
  }
  assert.equal(scripts.preview, "wrangler dev", "preview stays local");
});

test("3B.1: deployment workflow states the CSP mode, checks main ancestry via the API, and binds the record to its own version", () => {
  const w = wf("deploy-worker.yml");
  assert.deepEqual(Object.keys((w.on.workflow_dispatch as { inputs: object }).inputs).sort(), ["approver", "tag"], "no attestation input");
  const text = readFileSync(".github/workflows/deploy-worker.yml", "utf8");
  assert.doesNotMatch(text, /CSP_MODE:\s*report/, "CSP mode is not hard-coded");
  assert.match(text, /CSP_MODE: \$\{\{ vars\.CSP_MODE \}\}/);
  assert.match(text, /npm run security:csp -- --expect-mode "\$CSP_MODE"/);
  assert.ok(!allSteps(w).some((st) => /git fetch/.test(st.run ?? "")), "no credential-less git fetch in any step");
  assert.match(text, /compare\/main\.\.\.\$\{sha\}/);
  assert.match(text, /wrangler deploy[^\n]*\| tee deploy\.log/);
  assert.match(text, /set -o pipefail/);
  assert.match(text, /deploy:record -- --gate gate\.json --deploy-log deploy\.log/);
});

test("3B.1: backup workflow refuses before reading production when storage is not configured, and storage errors are fatal", () => {
  const steps = wf("backup.yml").jobs.backup.steps;
  const cfgAt = steps.findIndex((s) => s.name === "Storage and identity configuration"), backupAt = steps.findIndex((s) => (s.run ?? "").includes("npm run db:backup"));
  assert.ok(cfgAt >= 0 && cfgAt < backupAt, "configuration check before the production backup");
  const cfg = steps[cfgAt].run!;
  for (const v of ["APPROVED_ACCOUNT_ID", "APPROVED_D1_UUID", "BACKUP_S3_BUCKET", "BACKUP_S3_REGION", "CLOUDFLARE_BACKUP_TOKEN"]) assert.ok(cfg.includes(v), v);
  assert.match(cfg, /head-bucket/);
  const fetchPrev = steps.find((s) => s.name === "Fetch the previous manifest for comparison")!.run!;
  assert.doesNotMatch(fetchPrev, /list-objects-v2[^\n]*\|\|\s*true/, "a listing error is not swallowed");
});

test("3B.1: CSP check refuses a build whose mode differs from the stated one", { skip: !existsSync("out/_headers") }, () => {
  const run = (mode: string) => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/security/csp-check.mts", "--expect-mode", mode], { encoding: "utf8" });
  const built = checkCsp("out").mode!;
  assert.equal(run(built).status, 0);
  assert.equal(run(built === "report" ? "enforce" : "report").status, 1);
  assert.equal(run("").status, 1);
});

test("3B.1: staging check requires the production KV id when production does not pin one", async () => {
  const { checkStaging } = await import("../scripts/deploy/staging-check.mts");
  const { stripJsonc } = await import("../scripts/db/migrate-remote.mts");
  const prod = JSON.parse(stripJsonc(REAL_CFG));
  const staging = JSON.parse(stripJsonc(readFileSync("wrangler.staging.jsonc", "utf8")));
  const filled = { ...staging, account_id: ACC, d1_databases: [{ ...staging.d1_databases[0], database_id: OTHER }], kv_namespaces: [{ binding: "KV", id: "stagingkv" }],
    vars: { ...staging.vars, SITE_URL: "https://skillmountainacademy-staging.example.workers.dev", OWNER_EMAIL: "owner-staging@example.com" } };
  assert.ok(checkStaging(filled, prod, { productionUuid: UUID }).some((f) => /production KV namespace id was not supplied/.test(f)));
  assert.deepEqual(checkStaging(filled, prod, { productionUuid: UUID, productionKv: "prodkv" }), []);
});
