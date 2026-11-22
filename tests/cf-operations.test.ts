// Stage 3B: identity-bound Cloudflare operations (scripts/cf.mts). Wrangler and the identity proof are replaced by fakes,
// so nothing remote is contacted. The fake asserts on EVERY call that the config pins the approved account and that
// CLOUDFLARE_ACCOUNT_ID equals it: no call can be made unpinned.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cf, type CfRunner } from "../scripts/cf.mts";
import type { Identity, ResolvedIdentity } from "../scripts/db/d1.mts";
import { postRestoreSql } from "../scripts/db/post-restore.mts";
import type { Manifest } from "../scripts/db/dump.mts";

const ACC = "0123456789abcdef0123456789abcdef";
const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const NEW_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3399";
const VERSION = "6d1f6a3c-2b7e-4c55-9a7f-0e0d0f0a0b0c";
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const D = mkdtempSync(join(tmpdir(), "sma-cftest-"));
after(() => rmSync(D, { recursive: true, force: true }));
const base = { "owner-approved": true, "account-id": ACC };

type Call = { args: string[]; cfg: { account_id: string; name: string; d1_databases?: { database_name: string; database_id?: string }[] }; env: Record<string, string> };
function fakes(o: { member?: boolean; workerExists?: boolean; identityOk?: boolean; createOut?: string; status?: number } = {}) {
  const calls: Call[] = [];
  const resolved: [Identity, string][] = [];
  const runner: CfRunner = (args, x) => {
    const cfg = JSON.parse(readFileSync(x.config, "utf8"));
    assert.equal(cfg.account_id, ACC, "every call pins the approved account in the config");
    assert.equal(x.env.CLOUDFLARE_ACCOUNT_ID, ACC, "every call pins CLOUDFLARE_ACCOUNT_ID");
    calls.push({ args, cfg, env: x.env });
    if (args[0] === "whoami") return { status: 0, stderr: "", stdout: JSON.stringify({ loggedIn: true, accounts: (o.member ?? true) ? [{ id: ACC }] : [{ id: "f".repeat(32) }] }) };
    if (args[0] === "deployments") return (o.workerExists ?? true) ? { status: 0, stderr: "", stdout: '[{"id":"d1","versions":[]}]' } : { status: 1, stderr: "not found", stdout: "" };
    if (args[0] === "d1" && args[1] === "create") return { status: 0, stderr: "", stdout: o.createOut ?? `✅ Successfully created DB\n{\n  "d1_databases": [{ "binding": "DB", "database_name": "${args[2]}", "database_id": "${NEW_UUID}" }]\n}` };
    return { status: o.status ?? 0, stderr: "", stdout: '{"ok":true}' };
  };
  const resolve = (i: Identity, db: string): ResolvedIdentity => {
    resolved.push([i, db]);
    const ok = o.identityOk ?? true;
    return { ok, at: "", approved: i, byId: null, byName: null, accountAccessible: ok, failures: ok ? [] : ["the database found has a different UUID from the approved one."] };
  };
  return { calls, resolved, deps: { runner, resolve, now: new Date() } };
}
const refused = (r: { ok: boolean; failures: string[] }, re: RegExp) => { assert.equal(r.ok, false); assert.ok(r.failures.some((f) => re.test(f)), r.failures.join(" | ")); };

test("every operation needs owner approval and a well-formed account ID; unknown operations do not exist", () => {
  const f = fakes();
  refused(cf("wrangler-anything", base, f.deps), /Unknown operation/);
  refused(cf("time-travel-info", { "account-id": ACC, "database-uuid": UUID }, f.deps), /--owner-approved/);
  refused(cf("time-travel-info", { "owner-approved": true, "database-uuid": UUID }, f.deps), /--account-id is missing/);
  refused(cf("time-travel-info", { ...base, "account-id": "acme", "database-uuid": UUID }, f.deps), /32 hexadecimal/);
  assert.equal(f.calls.length, 0, "nothing reaches Wrangler");
});

test("D1 operations: missing or malformed UUID, or an unexpected database name, are refused before any live call; a UUID mismatch from the live proof is refused", () => {
  const f = fakes();
  refused(cf("time-travel-info", base, f.deps), /UUID is missing/);
  refused(cf("end-sessions", { ...base, "database-uuid": "skillmountainacademy-db" }, f.deps), /not a UUID/);
  refused(cf("d1-query", { ...base, "database-uuid": UUID, database: "some-other-db", sql: "SELECT 1" }, f.deps), /Unexpected database name/);
  refused(cf("end-sessions", { ...base, "database-uuid": UUID, database: "skillmountainacademy-db-restore-20261122" }, f.deps), /applies to skillmountainacademy-db only/);
  assert.equal(f.calls.length + f.resolved.length, 0);
  const bad = fakes({ identityOk: false });
  refused(cf("time-travel-info", { ...base, "database-uuid": UUID }, bad.deps), /identity: the database found has a different UUID/);
  assert.equal(bad.calls.length, 0, "no Wrangler call after a failed identity proof");
});

test("read-only time-travel-info runs pinned to account AND database UUID after the live proof", () => {
  const f = fakes();
  const r = cf("time-travel-info", { ...base, "database-uuid": UUID }, f.deps);
  assert.equal(r.ok, true, r.failures.join(" | "));
  assert.deepEqual(f.resolved, [[{ accountId: ACC, databaseUuid: UUID }, "skillmountainacademy-db"]]);
  assert.deepEqual(f.calls[0].args, ["d1", "time-travel", "info", "skillmountainacademy-db", "--json"]);
  assert.deepEqual([f.calls[0].cfg.d1_databases![0].database_name, f.calls[0].cfg.d1_databases![0].database_id], ["skillmountainacademy-db", UUID]);
});

test("end-sessions: dry run by default; execution needs a named approver and runs pinned to the production UUID", () => {
  const f = fakes();
  const dry = cf("end-sessions", { ...base, "database-uuid": UUID }, f.deps);
  assert.deepEqual([dry.ok, dry.executed], [true, false]);
  assert.equal(f.calls.length, 0);
  refused(cf("end-sessions", { ...base, "database-uuid": UUID, execute: true }, f.deps), /--approved-by/);
  const run = cf("end-sessions", { ...base, "database-uuid": UUID, execute: true, "approved-by": "Owner Name" }, f.deps);
  assert.deepEqual([run.ok, run.executed], [true, true]);
  assert.deepEqual(f.calls[0].args, ["d1", "execute", "skillmountainacademy-db", "--remote", "--yes", "--command", "DELETE FROM auth_sessions"]);
  assert.equal(f.calls[0].cfg.d1_databases![0].database_id, UUID);
});

test("Worker operations: unexpected Worker name, non-member account, or a Worker missing from the account are refused; listing is pinned", () => {
  refused(cf("worker-versions", { ...base, worker: "skillmountainacademy-staging" }, fakes().deps), /Unexpected Worker name/);
  refused(cf("worker-versions", base, fakes({ member: false }).deps), /not a member of the approved account/);
  refused(cf("worker-deployments", base, fakes({ workerExists: false }).deps), /not found in the approved account/);
  const f = fakes();
  const r = cf("worker-versions", base, f.deps);
  assert.equal(r.ok, true);
  assert.deepEqual(f.calls.map((c) => c.args.slice(0, 2)), [["whoami", "--json"], ["deployments", "list"], ["versions", "list"]]);
  assert.ok(f.calls.every((c) => c.cfg.name === "skillmountainacademy"));
});

function rollbackRecord(over: Record<string, unknown> = {}) {
  const f = join(D, `rb-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), candidateExpected: "0010_owner_integrity.sql", versionId: VERSION, identity: { accountId: ACC, databaseUuid: UUID }, applied: [], facts: {}, verdict: "SAFE", actions: [], reasons: [], ...over }));
  return f;
}
test("worker-rollback: requires a fresh rollback-check record for this version and account; UNSAFE/PROHIBITED refused; CHECK_REQUIRED needs confirmed actions", () => {
  const ok = { ...base, "version-id": VERSION, reason: "bad release", "database-uuid": UUID };
  // Stage 3B.1: the record must be for the production database UUID the Worker uses.
  refused(cf("worker-rollback", { ...ok, "database-uuid": undefined, "rollback-record": rollbackRecord() }, fakes().deps), /--database-uuid \(the production D1 UUID/);
  refused(cf("worker-rollback", { ...ok, "rollback-record": rollbackRecord({ identity: { accountId: ACC, databaseUuid: NEW_UUID } }) }, fakes().deps), /not run against the approved production database UUID/);
  refused(cf("worker-rollback", ok, fakes().deps), /--rollback-record is required/);
  refused(cf("worker-rollback", { ...ok, "rollback-record": rollbackRecord({ verdict: "UNSAFE" }) }, fakes().deps), /verdict is UNSAFE/);
  refused(cf("worker-rollback", { ...ok, "rollback-record": rollbackRecord({ verdict: "PROHIBITED" }) }, fakes().deps), /verdict is PROHIBITED/);
  refused(cf("worker-rollback", { ...ok, "rollback-record": rollbackRecord({ verdict: "CHECK_REQUIRED" }) }, fakes().deps), /--actions-confirmed/);
  refused(cf("worker-rollback", { ...ok, "rollback-record": rollbackRecord({ versionId: "00000000-1111-4222-8333-444444444444" }) }, fakes().deps), /different version id/);
  refused(cf("worker-rollback", { ...ok, "rollback-record": rollbackRecord({ identity: { accountId: "b".repeat(32) } }) }, fakes().deps), /not run against the approved account/);
  refused(cf("worker-rollback", { ...ok, "rollback-record": rollbackRecord({ at: new Date(Date.now() - 3 * 3600_000).toISOString() }) }, fakes().deps), /3\.0 hours old/);
  refused(cf("worker-rollback", { ...ok, "version-id": "latest", "rollback-record": rollbackRecord() }, fakes().deps), /--version-id must be/);
  const f = fakes();
  const dry = cf("worker-rollback", { ...ok, "rollback-record": rollbackRecord() }, f.deps);
  assert.deepEqual([dry.ok, dry.executed], [true, false]);
  assert.ok(!f.calls.some((c) => c.args[0] === "rollback"), "dry run: no rollback call");
  const run = cf("worker-rollback", { ...ok, "rollback-record": rollbackRecord({ verdict: "CHECK_REQUIRED" }), "actions-confirmed": true, execute: true, "approved-by": "Owner Name" }, f.deps);
  assert.equal(run.ok, true, run.failures.join(" | "));
  const rb = f.calls.find((c) => c.args[0] === "rollback")!;
  assert.deepEqual(rb.args.slice(0, 4), ["rollback", VERSION, "--name", "skillmountainacademy"], "always an explicit version id: never an implicit 'previous version'");
  assert.match(rb.args[5], /approved by Owner Name/);
});

function evidence(over: { identity?: unknown; encrypted?: boolean; createdAt?: string } = {}) {
  const f = join(D, `ev-${Math.random().toString(36).slice(2)}.sql.enc`);
  writeFileSync(f, "ciphertext");
  writeFileSync(`${f.slice(0, -4)}.manifest.json`, JSON.stringify({ createdAt: over.createdAt ?? new Date().toISOString(), source: { identity: over.identity ?? { accountId: ACC, databaseUuid: UUID } },
    ...(over.encrypted === false ? {} : { encrypted: { sha256: sha("ciphertext") } }) }));
  return f;
}
test("time-travel-restore: needs a fresh, encrypted evidence backup of the same account+UUID; dry run by default", () => {
  const ok = { ...base, "database-uuid": UUID, timestamp: "2026-11-22T08:00:00Z" };
  refused(cf("time-travel-restore", ok, fakes().deps), /--evidence-backup is required/);
  refused(cf("time-travel-restore", { ...ok, "evidence-backup": evidence({ encrypted: false }) }, fakes().deps), /must be encrypted/);
  refused(cf("time-travel-restore", { ...ok, "evidence-backup": evidence({ identity: { accountId: ACC, databaseUuid: NEW_UUID } }) }, fakes().deps), /not of the approved account and database UUID/);
  refused(cf("time-travel-restore", { ...ok, "evidence-backup": evidence({ createdAt: new Date(Date.now() - 5 * 3600_000).toISOString() }) }, fakes().deps), /5\.0 hours old/);
  refused(cf("time-travel-restore", { ...base, "database-uuid": UUID, "evidence-backup": evidence() }, fakes().deps), /--timestamp is required/);
  const f = fakes();
  const dry = cf("time-travel-restore", { ...ok, "evidence-backup": evidence() }, f.deps);
  assert.deepEqual([dry.ok, dry.executed, f.calls.length], [true, false, 0]);
});

test("d1-create-restore: only recovery names; created in the pinned account; the new UUID is read and PROVEN before it is trusted", () => {
  refused(cf("d1-create-restore", { ...base, name: "skillmountainacademy-db" }, fakes().deps), /--name must be/);
  refused(cf("d1-create-restore", { ...base, name: "anything" }, fakes().deps), /--name must be/);
  const f = fakes();
  const r = cf("d1-create-restore", { ...base, name: "skillmountainacademy-db-restore-20261122", execute: true, "approved-by": "Owner Name" }, f.deps);
  assert.equal(r.ok, true, r.failures.join(" | "));
  assert.equal(r.detail!.createdUuid, NEW_UUID);
  assert.deepEqual(f.resolved, [[{ accountId: ACC, databaseUuid: NEW_UUID }, "skillmountainacademy-db-restore-20261122"]]);
  const g = fakes({ createOut: "✅ Successfully created DB" });
  refused(cf("d1-create-restore", { ...base, name: "skillmountainacademy-db-restore-20261122", execute: true, "approved-by": "Owner Name" }, g.deps), /UUID could not be read/);
});

test("restore-import and restore-reset: never production; only the exact verified backup and an unmodified generated reset", () => {
  const sql = join(D, "plain.sql");
  writeFileSync(sql, "-- sma-d1-logical-backup/1\nCREATE TABLE x (a);\n");
  const mf = join(D, "plain.manifest.json");
  writeFileSync(mf, JSON.stringify({ file: { sha256: sha(readFileSync(sql)) }, source: { kind: "remote", identity: { accountId: ACC, databaseUuid: UUID } } }));
  // The report written by npm run db:restore:verify, bound to this manifest (Stage 3B.1).
  const report = (over: Record<string, unknown> = {}) => { const f = join(D, `rr-${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify({ ok: true, at: new Date().toISOString(), manifestSha256: sha(readFileSync(mf)), ...over })); return f; };
  const target = { ...base, database: "skillmountainacademy-db-restore-20261122", "database-uuid": NEW_UUID, "restore-report": report() };
  refused(cf("restore-import", { ...base, database: "skillmountainacademy-db", "database-uuid": UUID, file: sql, manifest: mf }, fakes().deps), /never write to production/);
  refused(cf("restore-import", { ...base, "database-uuid": NEW_UUID, file: sql, manifest: mf }, fakes().deps), /never write to production/);
  const wrongMf = join(D, "wrong.manifest.json");
  writeFileSync(wrongMf, JSON.stringify({ file: { sha256: "0".repeat(64) } }));
  refused(cf("restore-import", { ...target, file: sql, manifest: wrongMf }, fakes().deps), /SHA-256 mismatch/);
  // Stage 3B.1: a passed, fresh restore verification of THIS manifest, of a production backup of the approved account.
  refused(cf("restore-import", { ...target, "restore-report": undefined, file: sql, manifest: mf }, fakes().deps), /--restore-report is required/);
  refused(cf("restore-import", { ...target, file: sql, manifest: wrongMf }, fakes().deps), /not a production backup/, ); // malformed manifest: refused, never a crash
  refused(cf("restore-import", { ...target, "restore-report": report({ ok: false }), file: sql, manifest: mf }, fakes().deps), /does not show a passed restore verification/);
  refused(cf("restore-import", { ...target, "restore-report": report({ manifestSha256: "0".repeat(64) }), file: sql, manifest: mf }, fakes().deps), /different manifest/);
  refused(cf("restore-import", { ...target, "restore-report": report({ at: new Date(Date.now() - 30 * 3600_000).toISOString() }), file: sql, manifest: mf }, fakes().deps), /30\.0 hours old/);
  const otherAcc = join(D, "other.manifest.json");
  writeFileSync(otherAcc, JSON.stringify({ file: { sha256: sha(readFileSync(sql)) }, source: { kind: "remote", identity: { accountId: "b".repeat(32), databaseUuid: UUID } } }));
  refused(cf("restore-import", { ...target, "restore-report": report({ manifestSha256: sha(readFileSync(otherAcc)) }), file: sql, manifest: otherAcc }, fakes().deps), /not a production backup of the approved account/);
  const f = fakes();
  const imp = cf("restore-import", { ...target, file: sql, manifest: mf, execute: true, "approved-by": "Owner Name" }, f.deps);
  assert.equal(imp.ok, true, imp.failures.join(" | "));
  assert.equal(f.calls[0].cfg.d1_databases![0].database_id, NEW_UUID);
  assert.deepEqual(f.calls[0].args.slice(0, 5), ["d1", "execute", "skillmountainacademy-db-restore-20261122", "--remote", "--yes"]);
  // Reset: generated file accepted; edited, or generated for another UUID, refused.
  const manifest = { file: { sha256: "a".repeat(64) }, createdAt: "2026-11-22T10:00:00Z", migration: { latest: "0010_owner_integrity.sql" } } as unknown as Manifest;
  const reset = join(D, "reset.sql");
  writeFileSync(reset, postRestoreSql({ manifest, backupName: "b.sql.enc", database: "skillmountainacademy-db-restore-20261122", databaseUuid: NEW_UUID, approvedBy: "Owner Name" }));
  assert.equal(cf("restore-reset", { ...target, file: reset }, fakes().deps).ok, true);
  const edited = join(D, "edited.sql");
  writeFileSync(edited, readFileSync(reset, "utf8").replace("DELETE FROM auth_sessions;", "DELETE FROM users;"));
  refused(cf("restore-reset", { ...target, file: edited }, fakes().deps), /not an unmodified post-restore reset/);
  const other = join(D, "other.sql");
  writeFileSync(other, postRestoreSql({ manifest, backupName: "b.sql.enc", database: "skillmountainacademy-db-restore-20261122", databaseUuid: UUID, approvedBy: "Owner Name" }));
  refused(cf("restore-reset", { ...target, file: other }, fakes().deps), /not an unmodified post-restore reset for this database UUID/);
});
