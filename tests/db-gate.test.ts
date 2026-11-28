// Stage 3A.1: production identity (Cloudflare account ID + D1 UUID), the production migration gate, and Worker rollback
// compatibility. Pure logic: Cloudflare is replaced by injected fakes, so nothing remote is ever contacted.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identityProblems, parseD1Info, parseWhoami, resolveIdentity, type Identity, type ResolvedIdentity, type Runner } from "../scripts/db/d1.mts";
import { planMigration, runMigrate, stripJsonc, type GateDeps, type GateInput } from "../scripts/db/migrate-remote.mts";
import { COMPAT, decideRollback, SECURITY_FLOOR } from "../scripts/db/rollback.mts";
import { classifySql } from "../scripts/db/sql.mts";

const ACC = "0123456789abcdef0123456789abcdef";
const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const ID: Identity = { accountId: ACC, databaseUuid: UUID };
const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const made: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); made.push(d); return d; };
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); for (const d of readdirSync(tmpdir()).filter((x) => x.startsWith("sma-remote-"))) rmSync(join(tmpdir(), d), { recursive: true, force: true }); });

// ------------------------------------------------------------------ identity ----
test("identity values: missing, malformed or placeholder account ID / UUID are refused", () => {
  assert.deepEqual(identityProblems(ID), []);
  assert.ok(identityProblems({ accountId: ACC }).some((p) => /UUID is missing/.test(p)));
  assert.ok(identityProblems({ databaseUuid: UUID }).some((p) => /account ID is missing/.test(p)));
  assert.ok(identityProblems({ accountId: "acme", databaseUuid: UUID }).some((p) => /32 hexadecimal/.test(p)));
  assert.ok(identityProblems({ accountId: ACC, databaseUuid: "skillmountainacademy-db" }).some((p) => /not a UUID/.test(p)));
  assert.ok(identityProblems({ accountId: ACC, databaseUuid: "00000000-0000-4000-8000-000000000000" }).some((p) => /placeholder/.test(p)));
});

test("Wrangler output parsing: whoami and d1 info JSON (with any banner text before it)", () => {
  assert.deepEqual(parseWhoami(`\n ⛅️ wrangler 4\n{"loggedIn":true,"authType":"OAuth Token","email":"o@example.com","accounts":[{"name":"SMA","id":"${ACC}"}]}`), { loggedIn: true, accounts: [ACC] });
  assert.deepEqual(parseWhoami(""), { loggedIn: false, accounts: [] });
  assert.deepEqual(parseD1Info(`{"uuid":"${UUID}","name":"skillmountainacademy-db","num_tables":44}`), { uuid: UUID, name: "skillmountainacademy-db" });
  assert.deepEqual(parseD1Info("✘ [ERROR] not found"), { uuid: null, name: null });
});

// A fake Wrangler: answers whoami and d1 info according to which account/database the pinned config names.
function fakeWrangler(o: { loggedIn?: boolean; accounts?: string[]; dbs?: Record<string, { uuid: string; name: string }[]>; throws?: boolean }): Runner & { configs: unknown[] } {
  const configs: unknown[] = [];
  const r = ((args: string[], config?: string) => {
    if (o.throws) throw new Error("network unreachable");
    if (args[0] === "whoami") return { status: (o.loggedIn ?? true) ? 0 : 1, stderr: "", stdout: (o.loggedIn ?? true) ? JSON.stringify({ loggedIn: true, accounts: (o.accounts ?? [ACC]).map((id) => ({ id, name: "x" })) }) : "" };
    const cfg = JSON.parse(readFileSync(config!, "utf8")) as { account_id: string; d1_databases: { database_name: string; database_id?: string }[] };
    configs.push(cfg);
    const inAccount = o.dbs?.[cfg.account_id] ?? [];
    const want = cfg.d1_databases[0];
    const hit = want.database_id ? inAccount.find((d) => d.uuid === want.database_id) : inAccount.find((d) => d.name === want.database_name);
    return hit ? { status: 0, stderr: "", stdout: JSON.stringify(hit) } : { status: 1, stderr: "✘ [ERROR] A request to the Cloudflare API failed. database not found", stdout: "" };
  }) as Runner & { configs: unknown[] };
  r.configs = configs;
  return r;
}

test("identity resolution: proven only when account membership, UUID lookup and name lookup all agree; every other case fails closed", () => {
  const good = { [ACC]: [{ uuid: UUID, name: "skillmountainacademy-db" }] };
  const ok = resolveIdentity(ID, { ownerApproved: true, runner: fakeWrangler({ dbs: good }) });
  assert.deepEqual([ok.ok, ok.failures], [true, []]);
  const w = fakeWrangler({ dbs: good });
  resolveIdentity(ID, { ownerApproved: true, runner: w });
  assert.deepEqual(w.configs.map((c) => { const x = c as { account_id: string; d1_databases: { database_id?: string }[] }; return [x.account_id, x.d1_databases[0].database_id ?? "by-name"]; }), [[ACC, UUID], [ACC, "by-name"]], "every lookup is pinned to the approved account");
  const fails = (r: ResolvedIdentity, re: RegExp) => { assert.equal(r.ok, false); assert.ok(r.failures.some((f) => re.test(f)), r.failures.join(" | ")); };
  fails(resolveIdentity(ID, { ownerApproved: false, runner: fakeWrangler({ dbs: good }) }), /--owner-approved/);
  fails(resolveIdentity(ID, { ownerApproved: true, runner: fakeWrangler({ loggedIn: false }) }), /not signed in .* identity unverified/);
  fails(resolveIdentity(ID, { ownerApproved: true, runner: fakeWrangler({ accounts: ["f".repeat(32)], dbs: good }) }), /not a member of the approved Cloudflare account/);
  fails(resolveIdentity(ID, { ownerApproved: true, runner: fakeWrangler({ dbs: { [ACC]: [{ uuid: OTHER_UUID, name: "skillmountainacademy-db" }] } }) }), /no database with the approved UUID/);
  fails(resolveIdentity(ID, { ownerApproved: true, runner: fakeWrangler({ dbs: { [ACC]: [{ uuid: UUID, name: "some-other-db" }] } }) }), /belongs to a database named some-other-db/);
  // The UUID exists, but the NAME resolves to a different database: the name does not override the UUID.
  fails(resolveIdentity(ID, { ownerApproved: true, runner: fakeWrangler({ dbs: { [ACC]: [{ uuid: OTHER_UUID, name: "skillmountainacademy-db" }, { uuid: UUID, name: "skillmountainacademy-db" }] } }) }), /resolves to a DIFFERENT UUID/);
  // Correct name and UUID, but only in ANOTHER account: refused.
  fails(resolveIdentity(ID, { ownerApproved: true, runner: fakeWrangler({ accounts: [ACC, "b".repeat(32)], dbs: { ["b".repeat(32)]: [{ uuid: UUID, name: "skillmountainacademy-db" }] } }) }), /no database with the approved UUID in the approved account/);
  fails(resolveIdentity(ID, { ownerApproved: true, runner: fakeWrangler({ throws: true }) }), /identity resolution failed/);
  fails(resolveIdentity({ accountId: ACC, databaseUuid: "" }, { ownerApproved: true, runner: fakeWrangler({ dbs: good }) }), /UUID is missing/);
});

// ------------------------------------------------------------------ the production gate ----
// A complete, internally consistent set of records that passes every gate.
function fixture(o: { pfIdentity?: Identity | null; backupIdentity?: Identity | null; encrypted?: boolean; pin?: { account_id?: string; database_id?: string } } = {}) {
  const d = tmp("sma-gate-");
  const mig = join(d, "migrations");
  mkdirSync(mig);
  for (const f of readdirSync("migrations").filter((x) => x.endsWith(".sql"))) copyFileSync(join("migrations", f), join(mig, f));
  const files = readdirSync(mig).sort().map((name) => ({ name, sha256: sha(join(mig, name)), statements: 1, findings: [] }));
  const backup = join(d, "skillmountainacademy-db-20261122T100000Z-m0009.sql.enc");
  writeFileSync(backup, "ciphertext");
  writeFileSync(join(d, "skillmountainacademy-db-20261122T100000Z-m0009.sql.manifest.json"), JSON.stringify({ source: { identity: o.backupIdentity === null ? undefined : (o.backupIdentity ?? ID) } }));
  const mf = join(d, "skillmountainacademy-db-20261122T100000Z-m0009.sql.manifest.json");
  const now = new Date().toISOString();
  const pf = { result: "PASS", at: now, database: "skillmountainacademy-db", targetKind: "remote", stateCapturedAt: now, failures: [], warnings: [],
    applied: files.slice(0, 9).map((f) => f.name), pending: ["0010_owner_integrity.sql"], latestApplied: "0009_owner.sql", expectedByWorker: "0010_owner_integrity.sql", files,
    identity: o.pfIdentity === null ? null : (o.pfIdentity ?? ID),
    backup: { file: backup, sha256: sha(backup), manifestSha256: sha(mf), createdAt: now, migration: "0009_owner.sql", restoreVerified: true, encrypted: o.encrypted ?? true, ...(o.backupIdentity === null ? {} : { identity: o.backupIdentity ?? ID }) } };
  const rh = { ok: true, at: now, backup, backupSha256: sha(backup), manifestSha256: sha(mf), files: files.map(({ name, sha256 }) => ({ name, sha256 })), from: "0009_owner.sql", to: "0010_owner_integrity.sql", applied: ["0010_owner_integrity.sql"], checks: [], changedTables: [], newTables: [] };
  const cfg = join(d, "wrangler.jsonc");
  writeFileSync(cfg, `// comment\n{ "name": "skillmountainacademy", /* inline */ "url": "https://x//y", ${o.pin?.account_id ? `"account_id": "${o.pin.account_id}",` : ""}\n  "d1_databases": [{ "binding": "DB", "database_name": "skillmountainacademy-db"${o.pin?.database_id ? `, "database_id": "${o.pin.database_id}"` : ""}, }], }`);
  const pfFile = join(d, "pf.json"), rhFile = join(d, "rh.json");
  writeFileSync(pfFile, JSON.stringify(pf)); writeFileSync(rhFile, JSON.stringify(rh));
  const input: GateInput = { preflightFile: pfFile, rehearsalFile: rhFile, confirmDatabase: "skillmountainacademy-db", approvedBy: "Owner Name", approvedAccountId: ACC, approvedDatabaseUuid: UUID };
  const okResolved: ResolvedIdentity = { ok: true, at: now, approved: ID, byId: { uuid: UUID, name: "skillmountainacademy-db" }, byName: { uuid: UUID, name: "skillmountainacademy-db" }, accountAccessible: true, failures: [] };
  const deps: GateDeps = { migrationsDir: mig, wranglerConfig: cfg, resolve: () => okResolved, liveApplied: () => pf.applied };
  return { d, mig, pf, rh, pfFile, rhFile, backup, mf, cfg, input, deps };
}
const refusedWith = (g: { ok: boolean; failures: string[] }, re: RegExp) => { assert.equal(g.ok, false); assert.ok(g.failures.some((f) => re.test(f)), g.failures.join(" | ")); };

test("gate: a complete, consistent, identity-verified set passes (dry run); unpinned wrangler.jsonc is a warning, not a pass by name", () => {
  const f = fixture();
  const g = planMigration(f.input, f.deps);
  assert.deepEqual([g.ok, g.failures], [true, []]);
  assert.deepEqual(g.identity, ID);
  assert.ok(g.warnings.some((w) => /does not pin database_id/.test(w)));
  assert.equal(planMigration(f.input, { ...f.deps, wranglerConfig: fixture({ pin: { account_id: ACC, database_id: UUID } }).cfg }).warnings.length, 0, "pinned to the approved identity: no warning");
  assert.equal(stripJsonc('{"a":"https://x//y", // c\n"b":1,}'), '{"a":"https://x//y", \n"b":1}');
});

test("gate: the right NAME with the wrong UUID is refused, at every layer", () => {
  const f = fixture();
  refusedWith(planMigration({ ...f.input, approvedDatabaseUuid: OTHER_UUID }, { ...f.deps, resolve: (i) => resolveIdentity(i, { ownerApproved: true, runner: fakeWrangler({ dbs: { [ACC]: [{ uuid: UUID, name: "skillmountainacademy-db" }] } }) }) }),
    /preflight's state was not captured from the approved/);
  refusedWith(planMigration(f.input, { ...f.deps, resolve: (i) => resolveIdentity(i, { ownerApproved: true, runner: fakeWrangler({ dbs: { [ACC]: [{ uuid: OTHER_UUID, name: "skillmountainacademy-db" }] } }) }) }), /identity \(live\): .*no database with the approved UUID/);
  refusedWith(planMigration(f.input, { ...f.deps, wranglerConfig: fixture({ pin: { database_id: OTHER_UUID } }).cfg }), /wrangler\.jsonc pins a different database_id/);
});

test("gate: a missing or malformed UUID or account ID is refused before anything live is attempted", () => {
  const f = fixture();
  let called = 0;
  const deps = { ...f.deps, resolve: (i: Identity) => { called++; return f.deps.resolve!(i); } };
  refusedWith(planMigration({ ...f.input, approvedDatabaseUuid: undefined }, deps), /D1 database UUID is missing/);
  refusedWith(planMigration({ ...f.input, approvedAccountId: "" }, deps), /account ID is missing/);
  refusedWith(planMigration({ ...f.input, approvedDatabaseUuid: "skillmountainacademy-db" }, deps), /not a UUID/);
  assert.equal(called, 0, "no live call with an incomplete identity");
});

test("gate: a different or unresolved Cloudflare account cannot silently pass", () => {
  const f = fixture();
  refusedWith(planMigration({ ...f.input, approvedAccountId: "b".repeat(32) }, f.deps), /preflight's state was not captured from the approved/);
  refusedWith(planMigration(f.input, { ...f.deps, resolve: (i) => resolveIdentity(i, { ownerApproved: true, runner: fakeWrangler({ accounts: ["b".repeat(32)], dbs: { ["b".repeat(32)]: [{ uuid: UUID, name: "skillmountainacademy-db" }] } }) }) }), /not a member of the approved Cloudflare account/);
  refusedWith(planMigration(f.input, { ...f.deps, resolve: (i) => resolveIdentity(i, { ownerApproved: true, runner: fakeWrangler({ loggedIn: false }) }) }), /identity unverified/);
  refusedWith(planMigration(f.input, { ...f.deps, resolve: () => { throw new Error("offline"); } }), /could not be verified \(offline\)/);
  refusedWith(planMigration(f.input, { ...f.deps, wranglerConfig: fixture({ pin: { account_id: "c".repeat(32) } }).cfg }), /pins a different account_id/);
  refusedWith(planMigration(fixture({ pfIdentity: null }).input, fixture({ pfIdentity: null }).deps), /preflight's state was not captured from the approved/);
  refusedWith(planMigration(fixture({ backupIdentity: { accountId: "b".repeat(32), databaseUuid: UUID } }).input, fixture({ backupIdentity: { accountId: "b".repeat(32), databaseUuid: UUID } }).deps), /backup was not taken from the approved/);
});

test("gate: stale or forged state, substituted backup or manifest, unencrypted backup, substituted migration, stale or mismatched rehearsal are refused", () => {
  const f = fixture();
  refusedWith(planMigration(f.input, { ...f.deps, liveApplied: () => f.pf.applied.slice(0, 8) }), /production migration history .* differs from the preflight's/);
  refusedWith(planMigration(f.input, { ...f.deps, liveApplied: () => { throw new Error("timeout"); } }), /could not be read \(timeout\)/);
  refusedWith(planMigration(f.input, { ...f.deps, now: new Date(Date.now() + 3 * 3600_000) }), /preflight is 3\.0 hours old/);
  writeFileSync(f.pfFile, JSON.stringify({ ...f.pf, targetKind: "local" }));
  refusedWith(planMigration(f.input, f.deps), /run on a local database/);
  writeFileSync(f.pfFile, JSON.stringify(f.pf));
  refusedWith(planMigration(fixture({ encrypted: false }).input, fixture({ encrypted: false }).deps), /not encrypted/);
  const g = fixture(); writeFileSync(g.backup, "another backup");
  refusedWith(planMigration(g.input, g.deps), /backup file is missing or has changed/);
  const h = fixture(); writeFileSync(h.mf, JSON.stringify({ source: { identity: ID }, swapped: true }));
  refusedWith(planMigration(h.input, h.deps), /manifest is missing or has changed/);
  const k = fixture(); writeFileSync(k.rhFile, JSON.stringify({ ...k.rh, backupSha256: "0".repeat(64) }));
  refusedWith(planMigration(k.input, k.deps), /different backup \(or manifest\)/);
  const m = fixture(); writeFileSync(m.rhFile, JSON.stringify({ ...m.rh, at: new Date(Date.now() - 30 * 3600_000).toISOString() }));
  refusedWith(planMigration(m.input, m.deps), /rehearsal is 30\.0 hours old/);
  const n = fixture(); writeFileSync(n.rhFile, JSON.stringify({ ...n.rh, files: undefined }));
  refusedWith(planMigration(n.input, n.deps), /does not record the migration files/);
  // A migration file substituted after preflight and rehearsal.
  const p = fixture(); writeFileSync(join(p.mig, "0010_owner_integrity.sql"), `${readFileSync(join(p.mig, "0010_owner_integrity.sql"), "utf8")}\nDROP TABLE users;\n`);
  const gp = planMigration(p.input, p.deps);
  refusedWith(gp, /0010_owner_integrity\.sql changed since the preflight/);
  refusedWith(gp, /0010_owner_integrity\.sql differs from the file that was rehearsed/);
  refusedWith(planMigration({ ...f.input, confirmDatabase: "skillmountainacademy" }, f.deps), /--confirm-database/);
  refusedWith(planMigration({ ...f.input, approvedBy: "" }, f.deps), /--approved-by/);
});

test("runMigrate: dry run by default; the same checks gate execution; execution is pinned to the approved UUID and recorded without secrets", () => {
  const f = fixture();
  const calls: string[] = [];
  const logs: string[] = [];
  const approvals = tmp("sma-approvals-");
  const deps = { ...f.deps, apply: (cfg: string) => { calls.push(cfg); return 0; }, approvalsDir: approvals, log: (s: string) => logs.push(s) };
  assert.equal(runMigrate(f.input, deps), 0);
  assert.equal(calls.length, 0, "dry run: nothing executed");
  assert.match(logs.join("\n"), /Dry run only/);
  // Failing gate: identical refusals for dry run and execute, and nothing executed.
  const bad = { ...f.input, approvedDatabaseUuid: OTHER_UUID };
  const l1: string[] = [], l2: string[] = [];
  assert.equal(runMigrate(bad, { ...deps, log: (s) => l1.push(s) }), 1);
  assert.equal(runMigrate({ ...bad, execute: true }, { ...deps, log: (s) => l2.push(s) }), 1);
  assert.deepEqual(l1, l2, "dry run and execution report exactly the same refusals");
  assert.equal(calls.length, 0);
  // Passing gate + --execute: Wrangler runs with a config pinned to the approved account and UUID; approval recorded.
  assert.equal(runMigrate({ ...f.input, execute: true }, deps), 0);
  assert.equal(calls.length, 1);
  const cfg = JSON.parse(readFileSync(calls[0], "utf8"));
  assert.deepEqual([cfg.account_id, cfg.d1_databases[0].database_id, cfg.d1_databases[0].database_name], [ACC, UUID, "skillmountainacademy-db"]);
  const recs = readdirSync(approvals);
  assert.equal(recs.length, 1);
  const rec = JSON.parse(readFileSync(join(approvals, recs[0]), "utf8"));
  assert.deepEqual([rec.identity, rec.approvedBy, rec.resolved.uuid, rec.resolved.nameResolvesTo], [ID, "Owner Name", UUID, UUID]);
  assert.doesNotMatch(JSON.stringify(rec), /token|secret|password|api[_-]?key/i, "no secrets in the approval record");
  assert.ok(existsSync(calls[0]));
});

// ------------------------------------------------------------------ rollback compatibility ----
const ALL = readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort();
const upTo = (m: string) => ALL.filter((x) => x <= m);

test("rollback: every migration has a compatibility assessment; every check is a read-only count", () => {
  assert.deepEqual(ALL.filter((m) => !COMPAT[m]), [], "unassessed migrations");
  assert.deepEqual(Object.keys(COMPAT).filter((m) => !ALL.includes(m)), [], "assessments for files that do not exist");
  assert.equal(SECURITY_FLOOR, "0010_owner_integrity.sql");
  for (const [m, c] of Object.entries(COMPAT)) for (const ch of c.checks ?? []) {
    assert.match(ch.sql, /^SELECT /, `${m} ${ch.id}`);
    assert.deepEqual(classifySql(ch.sql).findings, [], `${m} ${ch.id} must not write`);
  }
});

test("rollback: SAFE only for a same-schema rollback at or above the security floor", () => {
  const d = decideRollback({ candidateExpected: ALL.at(-1)!, dbApplied: ALL });
  assert.deepEqual([d.verdict, d.crossed], ["SAFE", []]);
  // Stage B: rolling back across 0011 needs the catalogue check: unrun -> CHECK_REQUIRED; no publications -> SAFE.
  assert.equal(decideRollback({ candidateExpected: "0010_owner_integrity.sql", dbApplied: ALL }).verdict, "CHECK_REQUIRED");
  assert.equal(decideRollback({ candidateExpected: "0010_owner_integrity.sql", dbApplied: ALL, facts: { catalogue_published_changes: 0, orders_with_pricing_snapshot: 0, payment_attempts_open: 0, institution_rules_active: 0 } }).verdict, "SAFE");
  assert.equal(decideRollback({ candidateExpected: "0010_owner_integrity.sql", dbApplied: ALL, facts: { catalogue_published_changes: 2 } }).verdict, "UNSAFE");
});

test("rollback: a lower expected migration number is NOT enough: below the floor is PROHIBITED without the owner's exception", () => {
  const d = decideRollback({ candidateExpected: "0009_owner.sql", dbApplied: ALL, facts: { bootstrap_only_in_owner_record: 0 } });
  assert.equal(d.verdict, "PROHIBITED");
  assert.ok(d.reasons.some((r) => /below the Stage 2C security floor/.test(r)));
  const x = decideRollback({ candidateExpected: "0009_owner.sql", dbApplied: ALL, facts: { bootstrap_only_in_owner_record: 0 }, ownerSecurityException: "Owner, written approval 2026-11-22" });
  assert.equal(x.verdict, "CHECK_REQUIRED", "with the exception: never SAFE");
  const y = decideRollback({ candidateExpected: "0009_owner.sql", dbApplied: ALL, facts: { bootstrap_only_in_owner_record: 1 }, ownerSecurityException: "Owner" });
  assert.equal(y.verdict, "UNSAFE", "a Stage 2B Worker would re-open the owner set-up");
});

test("rollback: data, behaviour, session and trigger checks decide between CHECK_REQUIRED and UNSAFE", () => {
  const ex = { ownerSecurityException: "Owner" };
  const unknown = decideRollback({ candidateExpected: "0007_refinement.sql", dbApplied: ALL, ...ex });
  assert.equal(unknown.verdict, "CHECK_REQUIRED");
  assert.ok(unknown.checks.every((c) => c.outcome === "unknown") && unknown.reasons.some((r) => /not been run/.test(r)));
  const clean = decideRollback({ candidateExpected: "0007_refinement.sql", dbApplied: ALL, facts: { mfa_pending_sessions: 0, removed_accounts: 0, bootstrap_only_in_owner_record: 0 }, ...ex });
  assert.equal(clean.verdict, "CHECK_REQUIRED", "crossing 0008 always requires ending sessions");
  assert.ok(clean.actions.some((a) => /end every session/.test(a)));
  const pending = decideRollback({ candidateExpected: "0007_refinement.sql", dbApplied: ALL, facts: { mfa_pending_sessions: 3, removed_accounts: 0, bootstrap_only_in_owner_record: 0 }, ...ex });
  assert.ok(pending.actions.some((a) => /mfa_pending_sessions/.test(a)));
  const instr = decideRollback({ candidateExpected: "0003_lms.sql", dbApplied: upTo("0004_admissions.sql"), facts: { instructors_not_approved: 2, admissions_restricted: 0 }, ...ex });
  assert.equal(instr.verdict, "UNSAFE", "unverified instructors would become active");
  const ai = decideRollback({ candidateExpected: "0006_instructor_profile.sql", dbApplied: upTo("0007_refinement.sql"), facts: { ai_automation_records: 5 }, ...ex });
  assert.equal(ai.verdict, "UNSAFE");
  const lms = decideRollback({ candidateExpected: "0002_seed_programmes.sql", dbApplied: upTo("0003_lms.sql"), ...ex });
  assert.equal(lms.verdict, "UNSAFE", "removing the learning platform is unsafe even with an exception");
  const t = decideRollback({ candidateExpected: "0009_owner.sql", dbApplied: ALL, facts: { bootstrap_only_in_owner_record: 0 }, ...ex });
  assert.ok(t.reasons.some((r) => /0010_owner_integrity\.sql \[triggers\]/.test(r)), "trigger compatibility is assessed");
});

test("rollback: unknown history, a candidate needing newer schema, an unknown candidate, or an unassessed migration are UNSAFE", () => {
  assert.equal(decideRollback({ candidateExpected: "0010_owner_integrity.sql", dbApplied: null }).verdict, "UNSAFE");
  assert.equal(decideRollback({ candidateExpected: "0010_owner_integrity.sql", dbApplied: upTo("0009_owner.sql") }).verdict, "UNSAFE");
  assert.equal(decideRollback({ candidateExpected: "0099_future.sql", dbApplied: ALL }).verdict, "UNSAFE");
  const fut = decideRollback({ candidateExpected: "0010_owner_integrity.sql", dbApplied: [...ALL, "0016_future.sql"], known: [...ALL, "0016_future.sql"] });
  assert.equal(fut.verdict, "UNSAFE");
  assert.ok(fut.reasons.some((r) => /No compatibility assessment for 0016_future\.sql/.test(r)));
});
