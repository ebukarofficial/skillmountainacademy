// Owner login-email transition: atomicity and failure injection (dashboard stage, hardening pass).
// The transition runs as ONE D1 batch (a single SQL transaction). A failure at any step must leave the database exactly
// as it was, with the owner record protected by its trigger. Real Worker (Miniflare), isolated databases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { startWorker, SECRETS } from "./worker-harness.ts";
import { signIn as helperSignIn, session } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";
import { ownerEmailTransitionSql, TRANSITION_GUARD_ERROR } from "../src/server/owner-transition.ts";

type W = Awaited<ReturnType<typeof startWorker>>;
const OLD = "former.owner@example.com", NEW = "pascalsolomon63@gmail.com";
const MFA_KEY = Buffer.alloc(32, 4).toString("base64");

// A database as it was before the transition: an owner bootstrapped under the former address, with a live session,
// an unused sign-in link and audit history. OWNER_EMAIL is already the new address, so nobody is the owner yet.
async function seeded(opts: { record?: boolean; recordEmail?: string; extraUser?: string } = {}) {
  const w = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: NEW, MFA_ENCRYPTION_KEY: MFA_KEY } });
  const db = await w.db();
  await db.prepare("INSERT INTO users (id, email, role, status, full_name, created_at, admin_role) VALUES ('owner-1', ?1, 'admin', 'active', 'The Owner', '2026-01-01T00:00:00Z', 'super')").bind(OLD).run();
  if (opts.record !== false) await db.prepare("INSERT INTO owner_record (id, user_id, email, bootstrapped_at) VALUES (1, 'owner-1', ?1, '2026-01-02T00:00:00Z')").bind(opts.recordEmail ?? OLD).run();
  if (opts.extraUser) await db.prepare("INSERT INTO users (id, email, role, status, full_name, created_at) VALUES ('other', ?1, 'admin', 'active', 'Someone Else', '2026-01-01')").bind(opts.extraUser).run();
  await db.prepare("INSERT INTO audit_log (id, at, actor_id, action, target_type, target_id) VALUES ('h1', '2026-01-02T00:00:00Z', 'owner-1', 'owner.bootstrap', 'user', 'owner-1')").run();
  await db.prepare("INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES ('sess-1', 'owner-1', '2026-11-28T00:00:00Z', '2026-12-28T00:00:00Z', '2026-11-28T00:00:00Z', 't')").run();
  await db.prepare("INSERT INTO auth_tokens (token_hash, user_id, expires_at, created_at) VALUES ('tok-1', 'owner-1', '2026-12-28T00:00:00Z', '2026-11-28T00:00:00Z')").run();
  return { w, db };
}
type DB = Awaited<ReturnType<W["db"]>>;
const snapshot = async (db: DB) => ({
  account: (await db.prepare("SELECT id, email FROM users WHERE id = 'owner-1'").first()),
  record: (await db.prepare("SELECT user_id, email, bootstrapped_at FROM owner_record WHERE id = 1").first()),
  users: (await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n,
  trigger: !!(await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'owner_record_no_update'").first()),
  deleteTrigger: !!(await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'owner_record_no_delete'").first()),
  audit: (await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'owner.email_transition'").first<{ n: number }>())!.n,
  history: (await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE id = 'h1'").first<{ n: number }>())!.n,
  sessions: (await db.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = 'owner-1'").first<{ n: number }>())!.n,
  openLinks: (await db.prepare("SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = 'owner-1' AND used_at IS NULL").first<{ n: number }>())!.n,
});
const run = (db: DB, sql: string[]) => db.batch(sql.map((s) => db.prepare(s)));
const sql = () => ownerEmailTransitionSql(OLD, NEW, new Date().toISOString());

// The failed transition left everything exactly as it was, and the owner record is still protected.
async function assertUnchanged(db: DB, before: Awaited<ReturnType<typeof snapshot>>) {
  const after = await snapshot(db);
  assert.deepEqual(after, before, "the database is exactly as before");
  assert.equal(after.trigger, true, "owner_record_no_update is in place");
  await assert.rejects(db.prepare("UPDATE owner_record SET email = 'x@example.com' WHERE id = 1").run(), /owner_record is fixed/, "and it still blocks changes");
}
async function failsAtomically(inject: string | null, statements?: (s: string[]) => string[], expect: RegExp = /./) {
  const { w, db } = await seeded();
  try {
    if (inject) await db.prepare(inject).run();
    const before = await snapshot(db);
    await assert.rejects(run(db, statements ? statements(sql()) : sql()), expect);
    if (inject) await db.prepare("DROP TRIGGER inj").run(); // remove the injected fault before checking the protection
    await assertUnchanged(db, before);
  } finally { await w.dispose(); }
}

test("T1 success: one transaction moves the same account; trigger restored; audit written; sessions and links ended", async () => {
  const { w, db } = await seeded();
  try {
    const before = await snapshot(db);
    await run(db, sql());
    const after = await snapshot(db);
    assert.deepEqual(after.account, { id: "owner-1", email: NEW });
    assert.deepEqual(after.record, { user_id: "owner-1", email: NEW, bootstrapped_at: "2026-01-02T00:00:00Z" });
    assert.deepEqual([after.users, after.trigger, after.deleteTrigger, after.audit, after.history, after.sessions, after.openLinks], [before.users, true, true, 1, 1, 0, 0]);
    await assert.rejects(db.prepare("UPDATE owner_record SET email = 'x@example.com' WHERE id = 1").run(), /owner_record is fixed/);
  } finally { await w.dispose(); }
});

test("T2 failure while moving the account email: nothing changes", () =>
  failsAtomically(`CREATE TRIGGER inj BEFORE UPDATE OF email ON users WHEN NEW.email = '${NEW}' BEGIN SELECT RAISE(ABORT, 'injected'); END`, undefined, /injected/));

test("T3 failure while moving owner_record (after the protective trigger was dropped): rolled back, trigger back", () =>
  failsAtomically("CREATE TRIGGER inj BEFORE UPDATE ON owner_record BEGIN SELECT RAISE(ABORT, 'injected'); END", undefined, /injected/));

test("T4 failure while restoring the trigger: the drop is rolled back too", () =>
  failsAtomically(null, (s) => s.map((x) => x.startsWith("CREATE TRIGGER") ? "CREATE TRIGGER owner_record_no_update BEFORE UPDATE ON table_that_does_not_exist BEGIN SELECT 1; END" : x)));

test("T5 failure while writing the audit event: nothing changes", () =>
  failsAtomically("CREATE TRIGGER inj BEFORE INSERT ON audit_log WHEN NEW.action = 'owner.email_transition' BEGIN SELECT RAISE(ABORT, 'injected'); END", undefined, /injected/));

test("T6 failure while ending sessions: nothing changes (sessions, email and trigger as before)", () =>
  failsAtomically("CREATE TRIGGER inj BEFORE DELETE ON auth_sessions BEGIN SELECT RAISE(ABORT, 'injected'); END", undefined, /injected/));

test("T7 failure while cancelling unused sign-in links: nothing changes", () =>
  failsAtomically("CREATE TRIGGER inj BEFORE UPDATE ON auth_tokens BEGIN SELECT RAISE(ABORT, 'injected'); END", undefined, /injected/));

test("T8 a trigger that is not restored is caught by the guard: rolled back", () =>
  failsAtomically(null, (s) => s.filter((x) => !x.startsWith("CREATE TRIGGER")), TRANSITION_GUARD_ERROR));

test("T9 the destination address belongs to another account: never taken over, nothing changes", async () => {
  const { w, db } = await seeded({ extraUser: NEW });
  try {
    const before = await snapshot(db);
    await assert.rejects(run(db, sql()), TRANSITION_GUARD_ERROR);
    await assertUnchanged(db, before);
    assert.equal((await db.prepare("SELECT id FROM users WHERE email = ?1").bind(NEW).first<{ id: string }>())!.id, "other", "the other account is untouched");
  } finally { await w.dispose(); }
});

test("T10 no bootstrapped owner, or a mismatched record: refused, no owner is created", async () => {
  for (const opts of [{ record: false }, { recordEmail: "someone.else@example.com" }]) {
    const { w, db } = await seeded(opts);
    try {
      const users = (await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n;
      await assert.rejects(run(db, sql()), TRANSITION_GUARD_ERROR);
      assert.equal((await db.prepare("SELECT email FROM users WHERE id = 'owner-1'").first<{ email: string }>())!.email, OLD);
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n, users);
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM owner_record").first<{ n: number }>())!.n, opts.record === false ? 0 : 1);
      assert.ok(await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'owner_record_no_update'").first());
    } finally { await w.dispose(); }
  }
});

test("T11 a second run is refused by the guard and changes nothing (the completed transition stands)", async () => {
  const { w, db } = await seeded();
  try {
    await run(db, sql());
    const before = await snapshot(db);
    await assert.rejects(run(db, sql()), TRANSITION_GUARD_ERROR);
    await assertUnchanged(db, before);
  } finally { await w.dispose(); }
});

test("T12 after the transition the owner completes the real email-link sign-in AND the authenticator step with the same factor", async () => {
  const { w, db } = await seeded();
  try {
    // Before: the former address is an administrator but not the owner (OWNER_EMAIL is the new address), and enrols MFA.
    const old = await (async () => { await db.prepare("DELETE FROM rate_limits").run(); return helperSignIn(w, OLD); })();
    assert.equal((await old.json<{ isOwner: boolean; state: string }>("GET", "/api/app/owner/status")).state, "mismatch");
    const secret = (await old.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
    await old.json("POST", "/api/auth/mfa/enable", { code: await totpAt(secret, stepOf(Date.now()) - 1) });
    await run(db, sql());
    assert.equal((await old.send("GET", "/api/me")).status, 401, "the former address's session ended");
    await db.prepare("DELETE FROM rate_limits").run();
    const neu = await helperSignIn(w, NEW);
    const me = await neu.json<{ user: { id: string }; mfa: { pending: boolean } }>("GET", "/api/me");
    assert.deepEqual([me.user.id, me.mfa.pending], ["owner-1", true], "same account; the authenticator is still required");
    assert.ok([401, 403].includes((await neu.send("GET", "/api/app/owner/status")).status), "nothing but the code step before the authenticator");
    const v = await neu.send("POST", "/api/auth/mfa/verify", { code: await totpAt(secret, stepOf(Date.now())) });
    assert.equal(v.status, 200, await v.clone().text());
    const cookie = v.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const strongS = cookie ? session(w, cookie) : neu; // the code step issues a fresh session cookie
    const st = await strongS.json<{ isOwner: boolean; state: string; strongSession: boolean }>("GET", "/api/app/owner/status");
    assert.deepEqual([st.isOwner, st.state, st.strongSession], [true, "bootstrapped", true]);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>())!.n, 1, "no duplicate administrator or owner");
  } finally { await w.dispose(); }
});

test("T13 the local script refuses --remote and invalid input before touching anything", () => {
  const runScript = (args: string[]) => { try { execFileSync("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/owner/transition-email.mts", ...args], { stdio: "pipe" }); return { code: 0, err: "" }; } catch (e) { const x = e as { status: number; stderr: Buffer }; return { code: x.status, err: String(x.stderr) }; } };
  const remote = runScript(["--from", OLD, "--to", NEW, "--remote"]);
  assert.equal(remote.code, 1);
  assert.match(remote.err, /Refused: this tool changes the LOCAL database only/);
  const bad = runScript(["--from", OLD, "--to", "x'; DROP TABLE users; --@example.com"]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /plain email addresses/);
  const src = readFileSync("scripts/owner/transition-email.mts", "utf8");
  assert.match(src, /remoteBindings: false/, "the platform proxy is created with remote bindings off");
  assert.match(src, /db\.batch\(/, "one batch");
});
