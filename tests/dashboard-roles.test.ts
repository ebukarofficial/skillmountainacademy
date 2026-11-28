// Institutional Dashboard stage: role dashboards and their security, and the owner login-email transition.
// The dashboards are presentation; these tests prove the SERVER still decides access (direct API calls are refused
// outside each role's authority), that roles which do not exist fail closed, that the owner email moves to the
// existing owner identity without a duplicate account, and that the dashboard code shows only permitted, real data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startWorker, SECRETS } from "./worker-harness.ts";
import { signIn as helperSignIn, approve, eligible, type Session } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";
import { adminMay, areasFor } from "../src/server/lms/permissions.ts";
import { ownerEmailTransitionSql } from "../src/server/owner-transition.ts";

type W = Awaited<ReturnType<typeof startWorker>>;
let w: W;
const OWNER = "chief@example.com";
const s: Record<string, Session> = {};
const ids: Record<string, string> = {};
const reset = async (x: W) => { await (await x.db()).prepare("DELETE FROM rate_limits").run(); };
const signIn = async (x: W, email: string) => { await reset(x); return helperSignIn(x, email); };
async function strong(x: W, email: string) {
  const ss = await signIn(x, email);
  const secret = (await ss.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  await ss.json("POST", "/api/auth/mfa/enable", { code: await totpAt(secret, stepOf(Date.now())) });
  return ss;
}
const status = async (who: Session, method: string, path: string, body?: unknown) => (await who.send(method, path, body ?? (method === "GET" ? undefined : {}))).status;

before(async () => {
  w = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64") } });
  s.owner = await strong(w, OWNER);
  await s.owner.json("POST", "/api/app/owner/bootstrap");
  const mk = async (email: string, role: string, adminRole?: string) =>
    (await s.owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email, role, adminRole, fullName: email.split("@")[0], sendInvite: false })).user.id;
  for (const g of ["super", "finance", "academic", "admissions", "support", "reporting", "faculty"]) ids[g] = await mk(`${g}@example.com`, "admin", g);
  ids.ins = await mk("teacher@example.com", "instructor");
  ids.ins2 = await mk("teacher2@example.com", "instructor");
  await approve(s.owner, ids.ins); await approve(s.owner, ids.ins2);
  ids.stu = await mk("learner@example.com", "student");
  ids.stu2 = await mk("learner2@example.com", "student");
  for (const k of ["super", "finance", "academic", "admissions", "support", "reporting", "faculty"]) s[k] = await signIn(w, `${k}@example.com`);
  s.ins = await signIn(w, "teacher@example.com");
  s.stu = await signIn(w, "learner@example.com");
  void eligible;
});
after(async () => { await w.dispose(); });

test("1 student: sees only the student workspace and their own records", async () => {
  assert.equal(await status(s.stu, "GET", "/api/app/student/overview"), 200);
  for (const p of ["/api/app/admin/overview", "/api/app/admin/finance", "/api/app/instructor/students", "/api/app/admin/users", "/api/app/owner/status"])
    assert.equal(await status(s.stu, "GET", p), 403, p);
  assert.equal(await status(s.stu, "GET", `/api/app/students/${ids.stu2}/progress`), 403, "another student's progress");
  const me = await s.stu.json<{ admin: unknown }>("GET", "/api/me");
  assert.equal(me.admin, null, "no administrator areas are sent to a student's dashboard");
});

test("2 instructor: only their own students and no administration", async () => {
  assert.equal(await status(s.ins, "GET", "/api/app/instructor/students"), 200);
  assert.notEqual(await status(s.ins, "GET", `/api/app/instructor/students/${ids.stu2}`), 200, "a student not assigned to them");
  for (const p of ["/api/app/admin/overview", "/api/app/admin/finance", "/api/app/admin/institution"]) assert.equal(await status(s.ins, "GET", p), 403, p);
});

test("3 administrators: each group reaches only its permitted areas (direct API calls)", async () => {
  const matrix: [string, string, string, number][] = [
    ["finance", "GET", "/api/app/admin/finance", 200], ["finance", "GET", "/api/app/admin/academics", 403], ["finance", "GET", "/api/app/admin/recruitment", 403],
    ["academic", "GET", "/api/app/admin/academics", 200], ["academic", "GET", "/api/app/admin/finance", 403], ["academic", "GET", "/api/app/admin/payments/attempts", 403],
    ["admissions", "GET", "/api/app/admin/admissions", 200], ["admissions", "GET", "/api/app/admin/finance", 403],
    ["support", "GET", "/api/app/admin/finance", 403], ["support", "GET", "/api/app/admin/recruitment", 403],
    ["faculty", "GET", "/api/app/admin/recruitment", 200], ["faculty", "GET", "/api/app/admin/finance", 403],
  ];
  for (const [who, m, p, want] of matrix) assert.equal(await status(s[who], m, p), want, `${who} ${m} ${p}`);
});

test("4 Super Administrator does not acquire owner-only access", async () => {
  for (const [m, p] of [["GET", "/api/app/owner/staff"], ["GET", "/api/app/owner/audit"], ["PUT", "/api/app/owner/approval-policy"], ["PUT", "/api/app/owner/institution-policy"], ["POST", "/api/app/owner/bootstrap"]])
    assert.equal(await status(s.super, m, p), 403, `${m} ${p}`);
  const st = await s.super.json<{ isOwner: boolean; pendingRemovals?: number }>("GET", "/api/app/owner/status");
  assert.deepEqual([st.isOwner, st.pendingRemovals], [false, undefined], "owner-only figures are not sent");
  assert.equal((await s.super.json<{ admin: { owner: boolean } }>("GET", "/api/me")).admin.owner, false);
});

test("5 the owner sees owner-only features", async () => {
  for (const p of ["/api/app/owner/staff", "/api/app/owner/audit", "/api/app/admin/institution"]) assert.equal(await status(s.owner, "GET", p), 200, p);
  assert.equal((await s.owner.json<{ admin: { owner: boolean } }>("GET", "/api/me")).admin.owner, true);
});

test("6-9 roles that do not exist (HR, content, advertising) fail closed; existing groups cannot exceed their authority", async () => {
  for (const g of ["hr", "content", "advertising", "ad_publisher", "content_publisher"]) {
    assert.equal(adminMay(g, "GET", "/api/app/admin/overview"), false, `${g}: unknown groups get nothing`);
    assert.deepEqual(areasFor(g), { read: [], write: [] });
    assert.equal(await status(s.owner, "PATCH", `/api/app/admin/users/${ids.support}`, { adminRole: g, reason: "test" }), 400, `${g} cannot be assigned`);
  }
  // HR-type work today is Faculty Management: it cannot see finance or academic records.
  assert.equal(await status(s.faculty, "GET", "/api/app/admin/finance"), 403);
  assert.equal(await status(s.faculty, "GET", `/api/app/students/${ids.stu}/progress`), 403);
  // Content-type work (catalogue, academic content) cannot reach institutional controls, payments or pricing.
  for (const [m, p] of [["PATCH", `/api/app/admin/users/${ids.reporting}`], ["PUT", "/api/app/owner/approval-policy"], ["POST", "/api/app/admin/currency/refresh"], ["POST", "/api/app/admin/orders/x/payments"]])
    assert.equal(await status(s.academic, m, p, { adminRole: "finance", reason: "x" }), 403, `academic ${m} ${p}`);
  // Nobody outside Finance records payments; the finance group cannot change permissions.
  assert.equal(await status(s.admissions, "POST", "/api/app/admin/orders/x/payments", {}), 403);
  assert.equal(await status(s.finance, "PATCH", `/api/app/admin/users/${ids.reporting}`, { adminRole: "finance", reason: "x" }), 403);
  assert.equal(await status(s.finance, "POST", "/api/app/admin/invitations", { email: "x@example.com", fullName: "X Y", role: "admin", adminRole: "finance" }), 403);
});

test("10 reporting users cannot modify records through direct API calls", async () => {
  for (const [m, p] of [["POST", "/api/app/admin/enrolments"], ["PATCH", "/api/app/admin/admissions/web-development"], ["POST", "/api/app/admin/courses"], ["POST", "/api/app/admin/orders/x/payments"],
    ["PATCH", `/api/app/admin/users/${ids.stu}`], ["POST", "/api/app/admin/departments"], ["POST", "/api/app/admin/catalogue/programmes"]])
    assert.equal(await status(s.reporting, m, p), 403, `${m} ${p}`);
  assert.equal(await status(s.reporting, "GET", "/api/app/admin/finance"), 200, "it can still read its reports");
});

test("11-13 unknown or unassigned roles fail closed; direct access to restricted dashboards and operations is denied", async () => {
  assert.equal(adminMay("owner", "GET", "/api/app/owner/audit"), false, "the owner area is never a group");
  assert.equal(adminMay("super", "GET", "/api/app/owner/audit"), false);
  const anon = await w.fetchApi("/api/app/admin/overview");
  assert.equal(anon.status, 401);
  // Opening /app/?tab=owner shows the owner console only from server data; its data routes refuse everyone else.
  for (const who of ["super", "finance", "reporting"]) assert.equal(await status(s[who], "GET", "/api/app/owner/staff"), 403, who);
  assert.equal(await status(s.stu, "GET", "/api/app/admin/approvals"), 403);
});

test("19 layouts: the shell has a desktop sidebar, a tablet/phone drawer and responsive stat grids", () => {
  const shell = readFileSync("app/app/shell.tsx", "utf8");
  assert.match(shell, /data-shell="sidebar"/);
  assert.match(shell, /hidden w-72[^"]*lg:block/, "sidebar from large screens");
  assert.match(shell, /lg:pl-72/);
  assert.match(shell, /aria-label="Open menu"[^>]*/, "drawer button below large screens");
  assert.match(shell, /lg:hidden/);
  assert.match(shell, /overflow-x-clip/);
  const dash = readFileSync("app/app/dash.tsx", "utf8");
  assert.match(dash, /grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4/);
});

test("20 dashboards request only permitted data, and unavailable workspaces show no figures", () => {
  const home = readFileSync("app/app/admin-home.tsx", "utf8");
  const loads = [...home.matchAll(/useLoad<[^>]*>\(([^;]+?)\);/gs)].map((m) => m[1]);
  assert.ok(loads.length >= 10);
  for (const l of loads) {
    if (/"\/api\/app\/admin\/approvals"/.test(l)) continue; // area "any": scoped by the server to the person's own requests
    assert.match(l, /^(reads\(access, "[a-z]+"\)|owner) \?/, `conditional on authority: ${l.slice(0, 80)}`);
  }
  const planned = home.slice(home.indexOf("function PlannedWorkspaces"));
  assert.doesNotMatch(planned.replace(/className="[^"]*"/g, ""), /\d/, "no numbers in the not-yet-available workspaces");
  assert.match(planned, /<Unavailable title="Human Resources">/);
  assert.match(planned, /<Unavailable title="Content Manager \/ Publisher">/);
  assert.match(planned, /<Unavailable title="Advertising Manager \/ Publisher">/);
  // The shared components never invent a value: a missing figure renders as a dash.
  const dash = readFileSync("app/app/dash.tsx", "utf8");
  assert.match(dash, /value \?\? "–"/);
  assert.match(dash, /pct === null \? "–"/);
});

// ================================================================ owner login-email transition ====
test("14-16 owner email: the new address resolves to the EXISTING owner identity; the old address does not; no duplicate", async () => {
  const OLD = "former.owner@example.com", NEW = "pascalsolomon63@gmail.com";
  const x = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: NEW, MFA_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64") } });
  try {
    const db = await x.db();
    // The local database as it was: the owner bootstrapped under the former address, with history.
    await db.prepare("INSERT INTO users (id, email, role, status, full_name, created_at, admin_role) VALUES ('owner-1', ?1, 'admin', 'active', 'The Owner', '2026-01-01T00:00:00Z', 'super')").bind(OLD).run();
    await db.prepare("INSERT INTO owner_record (id, user_id, email, bootstrapped_at) VALUES (1, 'owner-1', ?1, '2026-01-02T00:00:00Z')").bind(OLD).run();
    await db.prepare("INSERT INTO audit_log (id, at, actor_id, action, target_type, target_id) VALUES ('h1', '2026-01-02T00:00:00Z', 'owner-1', 'owner.bootstrap', 'user', 'owner-1')").run();
    const users0 = (await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n;
    // Configuration changed, transition not yet run: NOBODY is the owner, and the new address gets no new account.
    await reset(x);
    const r = await x.post("/api/auth/request", { email: NEW, turnstileToken: "good-token" }, { "cf-connecting-ip": "10.40.0.1" });
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 200));
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?1").bind(NEW).first<{ n: number }>())!.n, 0, "no duplicate account for the new address");
    const old = await signIn(x, OLD);
    const st0 = await old.json<{ isOwner: boolean; state: string }>("GET", "/api/app/owner/status");
    assert.deepEqual([st0.isOwner, st0.state], [false, "mismatch"], "the former address is no longer the owner");
    // The transition (one atomic batch): same account, same id, same history.
    await db.batch(ownerEmailTransitionSql(OLD, NEW, new Date().toISOString()).map((q) => db.prepare(q)));
    assert.equal((await old.send("GET", "/api/me")).status, 401, "the former address's sessions ended");
    const neu = await signIn(x, NEW);
    const me = await neu.json<{ user: { id: string; email: string } }>("GET", "/api/me");
    assert.deepEqual([me.user.id, me.user.email], ["owner-1", NEW], "the existing owner account, now under the new address");
    const st = await neu.json<{ isOwner: boolean; state: string }>("GET", "/api/app/owner/status");
    assert.deepEqual([st.isOwner, st.state], [true, "bootstrapped"]);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n, users0, "no account was created");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM owner_record").first<{ n: number }>())!.n, 1, "one owner record");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE id = 'h1' AND actor_id = 'owner-1'").first<{ n: number }>())!.n, 1, "history preserved");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'owner.email_transition'").first<{ n: number }>())!.n, 1);
    // The former address can no longer sign in at all (no account has it), and requesting a link creates nothing.
    const before = x.calls.length;
    await reset(x);
    await x.post("/api/auth/request", { email: OLD, turnstileToken: "good-token" }, { "cf-connecting-ip": "10.40.0.2" });
    await new Promise((res) => setTimeout(res, 200));
    assert.equal(x.calls.slice(before).filter((c) => c.url.includes("api.resend.com") && c.body.includes(OLD)).length, 0, "no sign-in link for the former address");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?1").bind(OLD).first<{ n: number }>())!.n, 0);
    // The owner record is protected again, and a second run is refused and changes nothing.
    await assert.rejects(db.prepare("UPDATE owner_record SET email = 'x@example.com' WHERE id = 1").run(), /owner_record is fixed/);
    await assert.rejects(db.batch(ownerEmailTransitionSql(OLD, NEW, new Date().toISOString()).map((q) => db.prepare(q))), /NOT NULL constraint failed: audit_log\.at/);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'owner.email_transition'").first<{ n: number }>())!.n, 1, "idempotent");
    assert.equal((await neu.send("GET", "/api/me")).status, 200, "a second run ends no sessions");
  } finally { await x.dispose(); }
});

test("owner email transition refuses unsafe input and never takes over an existing account", async () => {
  assert.throws(() => ownerEmailTransitionSql("a@example.com", "x'; DROP TABLE users; --@example.com", "2026-11-28T00:00:00.000Z"));
  assert.throws(() => ownerEmailTransitionSql("a@example.com", "a@example.com", "2026-11-28T00:00:00.000Z"));
  const x = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: "new@example.com" } });
  try {
    const db = await x.db();
    await db.prepare("INSERT INTO users (id, email, role, status, full_name, created_at) VALUES ('o', 'old@example.com', 'admin', 'active', 'O', '2026-01-01'), ('someone', 'new@example.com', 'admin', 'active', 'S', '2026-01-01')").run();
    await db.prepare("INSERT INTO owner_record (id, user_id, email, bootstrapped_at) VALUES (1, 'o', 'old@example.com', '2026-01-01')").run();
    await assert.rejects(db.batch(ownerEmailTransitionSql("old@example.com", "new@example.com", new Date().toISOString()).map((q) => db.prepare(q))), /NOT NULL constraint failed: audit_log\.at/);
    const rec = await db.prepare("SELECT user_id, email FROM owner_record WHERE id = 1").first<{ user_id: string; email: string }>();
    assert.deepEqual(rec, { user_id: "o", email: "old@example.com" }, "the address belongs to someone else: nothing moved");
    assert.equal((await db.prepare("SELECT email FROM users WHERE id = 'o'").first<{ email: string }>())!.email, "old@example.com");
  } finally { await x.dispose(); }
});

test("production owner configuration is unchanged; the new address is a local override only", () => {
  const prod = readFileSync("wrangler.jsonc", "utf8");
  assert.match(prod, /"OWNER_EMAIL": "bookebukar@gmail\.com"/, "wrangler.jsonc (production) not changed by this stage");
  assert.match(readFileSync(".dev.vars.example", "utf8"), /^OWNER_EMAIL=pascalsolomon63@gmail\.com$/m);
  assert.doesNotMatch(readFileSync("scripts/owner/transition-email.mts", "utf8"), /--remote"\]|"--remote",/, "the tool never passes --remote to wrangler");
});
