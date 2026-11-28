// Expansion Stage E: departments, institutional hierarchy, staff invitations, staff lifecycle, approvals and the
// Paystack release safeguard. Real requests to the real Worker (Miniflare). Emails and Paystack are mocked; nothing is
// sent or paid. Every approval rule used here is a fixture in this isolated database, never a real owner decision.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { startWorker, SECRETS, registration, paystackAnswer, settled } from "./worker-harness.ts";
import { signIn as helperSignIn, session, type Session } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";

type W = Awaited<ReturnType<typeof startWorker>>;
let w: W;
let owner: Session, sup: Session, sup2: Session, fin: Session, aca: Session, legacy: Session, weakSup: Session;
const ids: Record<string, string> = {};
const OWNER = "boss@example.com";

const sql = async <T = Record<string, unknown>>(s: string, ...a: unknown[]) => (await (await w.db()).prepare(s).bind(...a).all<T>()).results;
const reset = async () => { await (await w.db()).prepare("DELETE FROM rate_limits").run(); };
const signIn = async (email: string) => { await reset(); return helperSignIn(w, email); };
async function strong(email: string) {
  const s = await signIn(email);
  const secret = (await s.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  await s.json("POST", "/api/auth/mfa/enable", { code: await totpAt(secret, stepOf(Date.now())) });
  return s;
}
const err = async (r: Response) => ((await r.clone().json()) as { error: string }).error;
const expectErr = async (r: Promise<Response>, status: number, code?: string, msg?: string) => {
  const res = await r;
  assert.equal(res.status, status, `${msg ?? ""} ${await res.clone().text()}`);
  if (code) assert.equal(await err(res), code, msg);
};
const audits = async (action: string, target?: string) => (await sql<{ detail: string | null; actor_id: string | null }>(
  "SELECT detail, actor_id FROM audit_log WHERE action = ?1 AND (?2 IS NULL OR target_id = ?2) ORDER BY at", action, target ?? null)).map((r) => ({ ...r, d: JSON.parse(r.detail ?? "null") }));
const mkUser = async (email: string, role: string, adminRole?: string) =>
  (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email, role, adminRole, fullName: email.split("@")[0], sendInvite: false })).user.id;
const userId = async (email: string) => (await sql<{ id: string }>("SELECT id FROM users WHERE email = ?1", email))[0]?.id;

// The invitation token exists only in the (mocked) email.
async function invite(by: Session, body: Record<string, unknown>) {
  const before = w.calls.length;
  const r = await by.send("POST", "/api/app/admin/invitations", body);
  if (r.status !== 201) return { r, token: null as string | null, id: null as string | null };
  const j = (await r.clone().json()) as { invitation: { id: string } };
  assert.ok(await w.waitFor((c) => c.slice(before).some((x) => x.url.includes("api.resend.com") && x.body.includes(String(body.email)))), "invitation email");
  const mail = w.calls.slice(before).filter((x) => x.url.includes("api.resend.com") && x.body.includes(String(body.email))).at(-1)!;
  return { r, token: JSON.parse(mail.body).html.match(/\/app\/invite\/\?t=([\w-]+)/)[1] as string, id: j.invitation.id };
}
const pub = async (path: string, body: unknown) => { await reset(); return w.post(path, body, { "cf-connecting-ip": "10.77.0.1" }); };
const setApprovals = (p: Record<string, unknown>) => owner.json("PUT", "/api/app/owner/approval-policy", { categories: {}, paymentRelease: null, ...p });
const setInstitution = (p: Record<string, boolean>) => owner.json("PUT", "/api/app/owner/institution-policy", { superMayManageDepartments: false, superMayAssignStaff: false, superMayAppointHeads: false, multipleDepartments: false, ...p });

let plan: string[] = [];
before(async () => {
  w = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") }, mock: async (req, b) => {
    const u = new URL(req.url);
    if (u.host === "api.paystack.co" && u.pathname === "/transaction/initialize") {
      if (plan.shift() === "network") throw new TypeError("network connection lost");
      const j = JSON.parse(b);
      return Response.json({ status: true, data: { authorization_url: `https://checkout.paystack.com/${j.reference}`, access_code: "AC", reference: j.reference } });
    }
    if (u.host === "api.paystack.co" && u.pathname.startsWith("/transaction/verify/")) return paystackAnswer(w, req.url, "abandoned"); // Stage E.4
    return undefined;
  } });
  legacy = await signIn("owner@example.com"); // an unassigned (legacy) administrator from ADMIN_EMAILS
  owner = await strong(OWNER);
  await owner.json("POST", "/api/app/owner/bootstrap");
  ids.sup = await mkUser("sup@example.com", "admin", "super");
  ids.sup2 = await mkUser("sup2@example.com", "admin", "super");
  ids.weak = await mkUser("weak@example.com", "admin", "super");
  ids.fin = await mkUser("fin@example.com", "admin", "finance");
  ids.aca = await mkUser("aca@example.com", "admin", "academic");
  ids.rep = await mkUser("rep@example.com", "admin", "reporting");
  ids.ins = await mkUser("ins@example.com", "instructor");
  sup = await strong("sup@example.com");
  sup2 = await strong("sup2@example.com");
  weakSup = await signIn("weak@example.com"); // a Super Administrator without the authenticator code
  fin = await strong("fin@example.com");
  aca = await strong("aca@example.com");
  ids.owner = (await userId(OWNER))!;
});
after(async () => { await w.dispose(); });

// ---------------------------------------------------------------- 1, 2 ----
test("1 owner authority: the owner creates departments, appoints heads and sets every policy", async () => {
  await owner.json("POST", "/api/app/admin/departments", { slug: "finance", name: "Finance", purpose: "Payments and reconciliation" });
  await owner.json("POST", "/api/app/admin/departments", { slug: "academic", name: "Academic Administration" });
  const head = await owner.json<{ assignment: { position: string; user_id: string } }>("POST", "/api/app/admin/departments/finance/members", { userId: ids.fin, position: "head", reason: "Leads Finance" });
  assert.deepEqual([head.assignment.position, head.assignment.user_id], ["head", ids.fin]);
  await owner.json("POST", "/api/app/admin/departments/academic/members", { userId: ids.aca, position: "head", reason: "Leads Academic" });
  const o = await owner.json<{ departments: { slug: string; head: { user_id: string } | null }[]; you: { owner: boolean } }>("GET", "/api/app/admin/institution");
  assert.equal(o.you.owner, true);
  assert.equal(o.departments.find((d) => d.slug === "finance")?.head?.user_id, ids.fin);
  await setInstitution({});
  await setApprovals({});
  // The owner stands above the departments.
  await expectErr(owner.send("POST", "/api/app/admin/departments/academic/members", { userId: ids.owner, position: "staff", reason: "x" }), 403, "self");
});

test("2 Super Administrator boundaries: delegated, never unrestricted", async () => {
  await expectErr(sup.send("POST", "/api/app/admin/departments", { slug: "support", name: "Student Support" }), 403, "forbidden", "departments are owner-only by default");
  await expectErr(sup.send("POST", "/api/app/admin/departments/academic/members", { userId: ids.rep, position: "staff", reason: "x" }), 403, "forbidden", "staff assignment owner-only by default");
  await expectErr(sup.send("PUT", "/api/app/owner/institution-policy", { superMayManageDepartments: true, superMayAssignStaff: true, superMayAppointHeads: true, multipleDepartments: true }), 403, undefined, "owner policy");
  await expectErr(sup.send("PUT", "/api/app/owner/approval-policy", { categories: {} }), 403);
  await expectErr(sup.send("POST", "/api/app/admin/invitations", { email: "x1@example.com", fullName: "X One", role: "admin", adminRole: "super" }), 403, "forbidden", "only the owner invites a Super");
  // The owner delegates ordinary membership only: heads stay with the owner.
  await setInstitution({ superMayAssignStaff: true });
  await sup.json("POST", "/api/app/admin/departments/academic/members", { userId: ids.rep, position: "staff", reason: "Reports for Academic" });
  await expectErr(sup.send("POST", "/api/app/admin/departments/academic/members", { userId: ids.sup2, position: "head", reason: "x" }), 403, "forbidden");
  await expectErr(sup.send("POST", "/api/app/admin/departments/academic/members", { userId: ids.sup, position: "staff", reason: "x" }), 403, "self");
  await setInstitution({});
});

// ---------------------------------------------------------------- 3, 4, 5 ----
test("3 department isolation: a head sees only their department, with no email, finance or personal data", async () => {
  const aHead = await aca.json<{ departments: { slug: string; position: string; roster?: Record<string, unknown>[] }[] }>("GET", "/api/app/admin/department");
  assert.deepEqual(aHead.departments.map((d) => [d.slug, d.position]), [["academic", "head"]]);
  const roster = aHead.departments[0].roster!;
  assert.ok(roster.length >= 2);
  for (const r of roster) assert.deepEqual(Object.keys(r).sort(), ["adminRole", "fullName", "position", "role", "since", "status"]);
  assert.ok(!JSON.stringify(aHead).includes("@"), "no email addresses");
  const rep = await signIn("rep@example.com");
  const member = await rep.json<{ departments: { slug: string; roster?: unknown }[] }>("GET", "/api/app/admin/department");
  assert.deepEqual([member.departments[0].slug, member.departments[0].roster], ["academic", undefined], "a member does not get the roster");
  const finView = await fin.json<{ departments: { slug: string }[] }>("GET", "/api/app/admin/department");
  assert.deepEqual(finView.departments.map((d) => d.slug), ["finance"], "Finance head never sees Academic");
  // A department head gains no institution-wide view or access from headship.
  await expectErr(aca.send("GET", "/api/app/admin/institution"), 403);
  await expectErr(fin.send("GET", "/api/app/admin/invitations"), 403);
  await expectErr(aca.send("GET", `/api/app/admin/users/${ids.fin}/access-history`), 403);
  await expectErr(aca.send("GET", "/api/app/admin/finance"), 403, undefined, "headship grants nothing beyond the group");
});

test("4 default deny: every new administrator route is in the permission table; nothing is switched on by default", async () => {
  const r = await build({ stdin: { contents: `import "./src/server/lms/index"; export { routeList } from "./src/server/lms/api"; export { permissionTable, adminMay } from "./src/server/lms/permissions"; export { DEFAULT_APPROVALS, DEFAULT_INSTITUTION } from "./src/server/lms/institution";`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, format: "esm", platform: "neutral", write: false, external: ["cloudflare:*", "node:*"], logLevel: "silent" });
  const m = await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}`);
  const table = new Map((m.permissionTable() as { method: string; path: string; area: string }[]).map((p) => [`${p.method} ${p.path}`, p.area]));
  const mine = (m.routeList() as { method: string; path: string; roles: string[] | "public" }[]).filter((x) => /^\/api\/app\/(admin\/(institution|departments?\b|assignments\/|invitations|approvals|users\/:id\/access-history)|owner\/(institution|approval)-policy)/.test(x.path) && x.roles !== "public");
  assert.ok(mine.length >= 18);
  for (const x of mine) assert.ok(table.has(`${x.method} ${x.path}`), `${x.method} ${x.path} must be in the permission table`);
  assert.equal(table.get("PUT /api/app/owner/approval-policy"), "owner");
  assert.equal(table.get("PUT /api/app/owner/institution-policy"), "owner");
  assert.deepEqual(m.DEFAULT_APPROVALS, { categories: {}, paymentRelease: null });
  assert.ok(Object.values(m.DEFAULT_INSTITUTION).every((v) => v === false));
  // Departments add no area to any group.
  assert.equal(m.adminMay("academic", "GET", "/api/app/admin/finance"), false);
  // Approval rules cannot be activated for categories without an executor.
  await expectErr(owner.send("PUT", "/api/app/owner/approval-policy", { categories: { financial_adjustment: { enabled: true, approver: "owner", expiresInHours: 24 } } }), 400, "category_not_available");
  await expectErr(sup.send("POST", "/api/app/admin/approvals", { category: "staff_reinstatement", targetId: ids.rep, reason: "x" }), 409, "approval_not_configured", "no rule switched on, no request");
});

test("5 server enforcement: the browser's view changes nothing", async () => {
  await expectErr(aca.send("POST", "/api/app/admin/departments", { slug: "x-dept", name: "X" }), 403, "forbidden", "group without the users area");
  await expectErr(aca.send("POST", "/api/app/admin/invitations", { email: "a2@example.com", fullName: "A Two", role: "instructor" }), 403);
  await expectErr(legacy.send("POST", "/api/app/admin/invitations", { email: "a3@example.com", fullName: "A Three", role: "instructor" }), 403, "forbidden", "legacy administrators cannot invite");
  await expectErr(legacy.send("GET", "/api/app/admin/institution"), 403);
  const anon = await w.fetchApi("/api/app/admin/institution");
  assert.equal(anon.status, 401);
});

// ---------------------------------------------------------------- 6, 7, 8 ----
test("6 invitations are unique, single-use and expire; the token is never stored or returned", async () => {
  const { r, token, id } = await invite(owner, { email: "new.admissions@example.com", fullName: "Nkem Obi", role: "admin", adminRole: "admissions", departmentSlug: "academic", position: "staff" });
  assert.equal(r.status, 201);
  const body = await r.text();
  assert.ok(!body.includes(token!) && !/token/i.test(body), "token not in the API response");
  const [row] = await sql<{ token_hash: string; status: string }>("SELECT token_hash, status FROM staff_invitations WHERE id = ?1", id);
  assert.notEqual(row.token_hash, token);
  assert.equal(row.status, "pending");
  assert.ok(!(await sql<{ detail: string }>("SELECT detail FROM audit_log")).some((a) => (a.detail ?? "").includes(token!)), "token never in the audit log");
  const list = await owner.json<{ invitations: Record<string, unknown>[] }>("GET", "/api/app/admin/invitations");
  assert.ok(!JSON.stringify(list).includes("token"), "list exposes no token or hash");
  // One pending invitation per address.
  await expectErr(owner.send("POST", "/api/app/admin/invitations", { email: "new.admissions@example.com", fullName: "Nkem Obi", role: "instructor" }), 409, "pending_exists");
  const pv = await pub("/api/auth/invitations/preview", { token });
  assert.equal(pv.status, 200);
  assert.match(JSON.stringify(await pv.json()), /n•••@example\.com/);
  // Accept: exactly the invited access, whatever the browser sends.
  const acc = await pub("/api/auth/invitations/accept", { token, role: "admin", adminRole: "super", departmentSlug: "finance", position: "head" });
  assert.equal(acc.status, 200, await acc.clone().text());
  assert.equal(((await acc.json()) as { signedIn: boolean }).signedIn, true);
  const uid = (await userId("new.admissions@example.com"))!;
  const [u] = await sql<{ role: string; admin_role: string; staff_no: string }>("SELECT role, admin_role, staff_no FROM users WHERE id = ?1", uid);
  assert.deepEqual([u.role, u.admin_role], ["admin", "admissions"]);
  assert.match(u.staff_no, /^SMA\/ADM\//);
  assert.deepEqual((await sql<{ department_slug: string; position: string }>("SELECT department_slug, position FROM staff_assignments WHERE user_id = ?1", uid)).map((a) => [a.department_slug, a.position]), [["academic", "staff"]]);
  // Single use. Stage E.1: a repeated acceptance is answered "already accepted, sign in", with no new account and no
  // session (it used to be refused as invalid; either way the link gives nothing a second time).
  const again = await pub("/api/auth/invitations/accept", { token });
  assert.deepEqual([again.status, ((await again.clone().json()) as { signedIn: boolean; alreadyAccepted: boolean }).signedIn, again.headers.getSetCookie().length], [200, false, 0]);
  assert.equal((await sql("SELECT 1 FROM users WHERE email = 'new.admissions@example.com'")).length, 1);
  await expectErr(pub("/api/auth/invitations/preview", { token }), 400, "invalid_invitation");
  // Expiry.
  const second = await invite(owner, { email: "late@example.com", fullName: "Late Comer", role: "instructor" });
  await sql("UPDATE staff_invitations SET expires_at = '2026-01-01T00:00:00Z' WHERE id = ?1", second.id);
  await expectErr(pub("/api/auth/invitations/accept", { token: second.token }), 400, "invalid_invitation");
  assert.equal((await sql<{ status: string }>("SELECT status FROM staff_invitations WHERE id = ?1", second.id))[0].status, "expired");
  assert.equal((await audits("invite.expired", second.id!)).length, 1);
  assert.equal(await userId("late@example.com"), undefined, "no account");
  // A made-up token gets the same answer.
  await expectErr(pub("/api/auth/invitations/accept", { token: "A".repeat(43) }), 400, "invalid_invitation");
  // Decline.
  const third = await invite(owner, { email: "nothanks@example.com", fullName: "No Thanks", role: "instructor" });
  assert.equal((await pub("/api/auth/invitations/decline", { token: third.token })).status, 200);
  await expectErr(pub("/api/auth/invitations/accept", { token: third.token }), 400, "invalid_invitation");
  // An invited instructor starts as a candidate: no teaching until approved.
  const fourth = await invite(sup, { email: "faculty.new@example.com", fullName: "Fola Ade", role: "instructor" });
  assert.equal((await pub("/api/auth/invitations/accept", { token: fourth.token })).status, 200);
  assert.equal((await sql<{ verification: string }>("SELECT verification FROM users WHERE email = 'faculty.new@example.com'"))[0].verification, "application_received");
});

test("7 invitations can be revoked, with a reason, and then never used", async () => {
  const { token, id } = await invite(sup, { email: "revoked@example.com", fullName: "Re Voked", role: "admin", adminRole: "support" });
  await expectErr(sup.send("POST", `/api/app/admin/invitations/${id}/revoke`, {}), 400, undefined, "reason required");
  await expectErr(aca.send("POST", `/api/app/admin/invitations/${id}/revoke`, { reason: "x" }), 403);
  await sup.json("POST", `/api/app/admin/invitations/${id}/revoke`, { reason: "Sent to the wrong person" });
  await expectErr(pub("/api/auth/invitations/accept", { token }), 400, "invalid_invitation");
  await expectErr(sup.send("POST", `/api/app/admin/invitations/${id}/revoke`, { reason: "again" }), 409, "not_pending");
  assert.equal((await audits("invite.revoked", id!))[0].d.reason, "Sent to the wrong person");
  // Only the owner creates (and so revokes) a Super Administrator invitation.
  const s = await invite(owner, { email: "future.super@example.com", fullName: "Fu Ture", role: "admin", adminRole: "super" });
  await expectErr(sup.send("POST", `/api/app/admin/invitations/${s.id}/revoke`, { reason: "x" }), 403);
  await owner.json("POST", `/api/app/admin/invitations/${s.id}/revoke`, { reason: "Not needed" });
});

test("8 escalation prevention: nobody grants themselves or others more than they hold", async () => {
  await expectErr(sup.send("PATCH", `/api/app/admin/users/${ids.sup}`, { adminRole: "finance", reason: "x" }), 403, undefined, "own group");
  await expectErr(sup.send("PATCH", `/api/app/admin/users/${ids.fin}`, { adminRole: "super", reason: "x" }), 403, undefined, "Super is owner-only");
  await expectErr(fin.send("PATCH", `/api/app/admin/users/${ids.aca}`, { adminRole: "finance", reason: "x" }), 403);
  await expectErr(fin.send("POST", "/api/app/admin/invitations", { email: "e1@example.com", fullName: "E One", role: "admin", adminRole: "finance" }), 403);
  await expectErr(aca.send("POST", "/api/app/admin/departments/academic/members", { userId: ids.aca, position: "head", reason: "x" }), 403);
  // Approval requests carry the requester's authority too: a Super cannot ask for a Super appointment.
  await setApprovals({ categories: { staff_group_change: { enabled: true, approver: "owner", expiresInHours: 24 } } });
  await expectErr(sup.send("POST", "/api/app/admin/approvals", { category: "staff_group_change", targetId: ids.fin, payload: { adminRole: "super" }, reason: "x" }), 403);
  await expectErr(sup.send("POST", "/api/app/admin/approvals", { category: "staff_group_change", targetId: ids.sup, payload: { adminRole: "finance" }, reason: "x" }), 403);
  await setApprovals({});
});

// ---------------------------------------------------------------- 9, 10 ----
test("9 suspension needs a reason, ends every session at once and records before and after", async () => {
  const victim = await mkUser("susp@example.com", "admin", "support");
  const s = await signIn("susp@example.com");
  assert.equal((await s.get("/api/me")).status, 200);
  await expectErr(sup.send("PATCH", `/api/app/admin/users/${victim}`, { status: "suspended" }), 400, "reason_required");
  assert.equal((await s.get("/api/me")).status, 200, "nothing changed without a reason");
  await sup.json("PATCH", `/api/app/admin/users/${victim}`, { status: "suspended", reason: "Investigation" });
  assert.equal((await s.get("/api/me")).status, 401, "session revoked");
  const [a] = await audits("staff.access_changed", victim);
  assert.deepEqual([a.d.reason, a.d.from.status, a.d.to.status], ["Investigation", "active", "suspended"]);
  // Group change: reason, before and after, and sign-out.
  const s2 = await signIn("rep@example.com");
  await sup.json("PATCH", `/api/app/admin/users/${ids.rep}`, { adminRole: "support", reason: "Moves to Student Support" });
  assert.equal((await s2.get("/api/me")).status, 401);
  const g = (await audits("staff.access_changed", ids.rep)).at(-1)!;
  assert.deepEqual([g.d.from.adminRole, g.d.to.adminRole], ["reporting", "support"]);
});

test("10 history is preserved after an assignment ends and after a person is removed", async () => {
  const gone = await mkUser("gone@example.com", "admin", "support");
  const a = await owner.json<{ assignment: { id: string } }>("POST", "/api/app/admin/departments/academic/members", { userId: gone, position: "staff", reason: "Joins" });
  await expectErr(owner.send("POST", `/api/app/admin/assignments/${a.assignment.id}/end`, {}), 400);
  await owner.json("POST", `/api/app/admin/assignments/${a.assignment.id}/end`, { reason: "Leaves the department" });
  await owner.json("POST", `/api/app/owner/users/${gone}/remove`, { reason: "Left the Academy" });
  const h = await owner.json<{ assignments: { ended_at: string | null; end_reason: string }[]; history: { action: string }[]; user: { removedAt: string | null } }>("GET", `/api/app/admin/users/${gone}/access-history`);
  assert.equal(h.assignments.length, 1);
  assert.equal(h.assignments[0].end_reason, "Leaves the department");
  assert.ok(h.user.removedAt);
  assert.ok(h.history.some((x) => x.action === "staff.assigned") && h.history.some((x) => x.action === "staff.unassigned"));
  // An archived department keeps its records; one with members cannot be archived.
  await expectErr(owner.send("PATCH", "/api/app/admin/departments/academic", { status: "archived", reason: "x" }), 409, "has_members");
});

// ---------------------------------------------------------------- 11 - 14 ----
test("11 approval lifecycle: request, approve, execute, with history", async () => {
  await setApprovals({ categories: { staff_group_change: { enabled: true, approver: "owner", expiresInHours: 48 } } });
  await expectErr(sup.send("PATCH", `/api/app/admin/users/${ids.aca}`, { adminRole: "faculty", reason: "x" }), 409, "approval_required");
  const { request } = await sup.json<{ request: { id: string; status: string; approver: string } }>("POST", "/api/app/admin/approvals", { category: "staff_group_change", targetId: ids.aca, payload: { adminRole: "faculty" }, reason: "Moves to Faculty Management" });
  assert.deepEqual([request.status, request.approver], ["pending", "owner"]);
  await expectErr(sup.send("POST", "/api/app/admin/approvals", { category: "staff_group_change", targetId: ids.aca, payload: { adminRole: "support" }, reason: "dup" }), 409, "already_requested");
  // The owner still acts directly when a rule is on.
  await expectErr(owner.send("POST", "/api/app/admin/approvals", { category: "staff_group_change", targetId: ids.aca, payload: { adminRole: "faculty" }, reason: "x" }), 400, "owner_acts_directly");
  const d = await owner.json<{ executed: boolean; approval: { status: string; executed_at: string | null; execution_result: string } }>("POST", `/api/app/admin/approvals/${request.id}/decision`, { decision: "approve", comment: "Agreed" });
  assert.deepEqual([d.executed, d.approval.status, !!d.approval.executed_at], [true, "approved", true]);
  assert.equal((await sql<{ admin_role: string }>("SELECT admin_role FROM users WHERE id = ?1", ids.aca))[0].admin_role, "faculty");
  const h = await owner.json<{ history: { action: string }[] }>("GET", `/api/app/admin/approvals/${request.id}`);
  assert.deepEqual(h.history.map((x) => x.action), ["approval.requested", "approval.approved", "approval.execution_started", "approval.executed"]);
  const [ga] = await audits("admin.group_assigned", ids.aca).then((x) => x.slice(-1));
  assert.deepEqual([ga.d.requestedBy, ga.d.approvedBy, ga.d.approvalRequest], [ids.sup, ids.owner, request.id]);
  await expectErr(owner.send("POST", `/api/app/admin/approvals/${request.id}/decision`, { decision: "approve" }), 409, "decided");
  // Restore for later tests (the owner acts directly).
  await owner.json("PATCH", `/api/app/admin/users/${ids.aca}`, { adminRole: "academic", reason: "Back to Academic" });
});

test("12 rejection and cancellation: nothing executes", async () => {
  const req1 = (await sup.json<{ request: { id: string } }>("POST", "/api/app/admin/approvals", { category: "staff_group_change", targetId: ids.fin, payload: { adminRole: "reporting" }, reason: "Read-only for audit period" })).request;
  await expectErr(owner.send("POST", `/api/app/admin/approvals/${req1.id}/decision`, { decision: "reject" }), 400, undefined, "a rejection needs a comment");
  const rj = await owner.json<{ approval: { status: string; executed_at: string | null } }>("POST", `/api/app/admin/approvals/${req1.id}/decision`, { decision: "reject", comment: "Not now" });
  assert.deepEqual([rj.approval.status, rj.approval.executed_at], ["rejected", null]);
  assert.equal((await sql<{ admin_role: string }>("SELECT admin_role FROM users WHERE id = ?1", ids.fin))[0].admin_role, "finance");
  const req2 = (await sup.json<{ request: { id: string } }>("POST", "/api/app/admin/approvals", { category: "staff_group_change", targetId: ids.fin, payload: { adminRole: "reporting" }, reason: "Second try" })).request;
  await expectErr(sup2.send("POST", `/api/app/admin/approvals/${req2.id}/cancel`, { reason: "x" }), 403, undefined, "only the requester or the owner cancels");
  await sup.json("POST", `/api/app/admin/approvals/${req2.id}/cancel`, { reason: "Withdrawn" });
  await expectErr(owner.send("POST", `/api/app/admin/approvals/${req2.id}/decision`, { decision: "approve" }), 409, "decided");
  assert.equal((await sql<{ admin_role: string }>("SELECT admin_role FROM users WHERE id = ?1", ids.fin))[0].admin_role, "finance");
  // A department head's view of approvals is limited to their own requests.
  const list = await fin.json<{ approvals: unknown[] }>("GET", "/api/app/admin/approvals");
  assert.equal(list.approvals.length, 0);
});

test("13 self-approval prevention, approver eligibility and escalation", async () => {
  await setApprovals({ categories: { staff_reinstatement: { enabled: true, approver: "super", expiresInHours: 24 } } });
  const target = await mkUser("paused@example.com", "instructor");
  await owner.json("PATCH", `/api/app/admin/users/${target}`, { status: "suspended", reason: "Paused" });
  await expectErr(sup.send("PATCH", `/api/app/admin/users/${target}`, { status: "active", reason: "x" }), 409, "approval_required");
  const r = (await sup.json<{ request: { id: string } }>("POST", "/api/app/admin/approvals", { category: "staff_reinstatement", targetId: target, reason: "Cleared" })).request;
  await expectErr(sup.send("POST", `/api/app/admin/approvals/${r.id}/decision`, { decision: "approve" }), 403, "forbidden", "never your own request");
  await expectErr(fin.send("POST", `/api/app/admin/approvals/${r.id}/decision`, { decision: "approve" }), 404, undefined, "not visible to an unrelated administrator");
  assert.equal((await sql<{ status: string }>("SELECT status FROM users WHERE id = ?1", target))[0].status, "suspended");
  assert.equal((await audits("approval.decision_refused", r.id)).length, 1);
  // Escalation moves the decision to the owner; a Super can no longer decide it.
  await sup.json("POST", `/api/app/admin/approvals/${r.id}/escalate`, { reason: "Needs the owner" });
  await expectErr(sup2.send("POST", `/api/app/admin/approvals/${r.id}/decision`, { decision: "approve" }), 403);
  await owner.json("POST", `/api/app/admin/approvals/${r.id}/decision`, { decision: "approve" });
  assert.equal((await sql<{ status: string }>("SELECT status FROM users WHERE id = ?1", target))[0].status, "active");
  // A second Super Administrator may approve another Super's request when the rule says "super".
  await owner.json("PATCH", `/api/app/admin/users/${target}`, { status: "suspended", reason: "Paused again" });
  const r2 = (await sup.json<{ request: { id: string } }>("POST", "/api/app/admin/approvals", { category: "staff_reinstatement", targetId: target, reason: "Cleared again" })).request;
  await sup2.json("POST", `/api/app/admin/approvals/${r2.id}/decision`, { decision: "approve" });
  assert.equal((await sql<{ status: string }>("SELECT status FROM users WHERE id = ?1", target))[0].status, "active");
  // Nobody approves a change to their own access, even when someone else asked for it.
  await setApprovals({ categories: { department_head_appointment: { enabled: true, approver: "super", expiresInHours: 24 } } });
  const r3 = (await sup.json<{ request: { id: string } }>("POST", "/api/app/admin/approvals", { category: "department_head_appointment", targetId: ids.sup2, payload: { departmentSlug: "finance" }, reason: "Lead Finance" })).request;
  await expectErr(sup2.send("POST", `/api/app/admin/approvals/${r3.id}/decision`, { decision: "approve" }), 403, "forbidden");
  await sup.json("POST", `/api/app/admin/approvals/${r3.id}/cancel`, { reason: "Withdrawn" });
  await setApprovals({ categories: { staff_reinstatement: { enabled: true, approver: "super", expiresInHours: 24 } } });
});

test("14 no execution before approval: pending and expired requests change nothing; a withdrawn rule blocks approval", async () => {
  const target = await mkUser("held@example.com", "instructor");
  await owner.json("PATCH", `/api/app/admin/users/${target}`, { status: "suspended", reason: "Hold" });
  const r = (await sup.json<{ request: { id: string } }>("POST", "/api/app/admin/approvals", { category: "staff_reinstatement", targetId: target, reason: "Lift hold" })).request;
  assert.equal((await sql<{ status: string }>("SELECT status FROM users WHERE id = ?1", target))[0].status, "suspended", "pending: nothing done");
  await sql("UPDATE approval_requests SET expires_at = '2026-01-01T00:00:00Z' WHERE id = ?1", r.id);
  await expectErr(sup2.send("POST", `/api/app/admin/approvals/${r.id}/decision`, { decision: "approve" }), 409, "expired");
  assert.equal((await sql<{ status: string; executed_at: string | null }>("SELECT status, executed_at FROM approval_requests WHERE id = ?1", r.id))[0].status, "expired");
  assert.equal((await sql<{ status: string }>("SELECT status FROM users WHERE id = ?1", target))[0].status, "suspended");
  const r2 = (await sup.json<{ request: { id: string } }>("POST", "/api/app/admin/approvals", { category: "staff_reinstatement", targetId: target, reason: "Lift hold" })).request;
  await setApprovals({});
  await expectErr(sup2.send("POST", `/api/app/admin/approvals/${r2.id}/decision`, { decision: "approve" }), 409, "policy_withdrawn");
  assert.equal((await sql<{ status: string }>("SELECT status FROM users WHERE id = ?1", target))[0].status, "suspended");
  await sup.json("POST", `/api/app/admin/approvals/${r2.id}/cancel`, { reason: "Rule withdrawn" });
});

// ---------------------------------------------------------------- 15, 16 ----
test("15 audit completeness", async () => {
  for (const a of ["department.created", "staff.head_appointed", "staff.assigned", "staff.unassigned", "invite.created", "invite.accepted", "invite.declined", "invite.revoked", "invite.expired",
    "staff.joined", "approval.requested", "approval.approved", "approval.executed", "approval.rejected", "approval.cancelled", "approval.escalated", "approval.expired", "approval.decision_refused",
    "owner.approval_policy", "owner.institution_policy", "staff.access_changed", "institution.refused"])
    assert.ok((await audits(a)).length >= 1, `audit ${a}`);
  const [p] = (await audits("owner.approval_policy")).slice(-1);
  assert.ok("from" in p.d && "to" in p.d, "policy changes record before and after");
});

test("16 the authenticator code is required for every sensitive institution action", async () => {
  await setInstitution({ superMayManageDepartments: true });
  await expectErr(weakSup.send("POST", "/api/app/admin/departments", { slug: "weak", name: "Weak" }), 403, "mfa_step_required");
  await expectErr(weakSup.send("POST", "/api/app/admin/invitations", { email: "w1@example.com", fullName: "W One", role: "instructor" }), 403, "mfa_step_required");
  const pending = (await sql<{ id: string }>("SELECT id FROM staff_invitations WHERE status = 'pending' LIMIT 1"))[0];
  if (pending) await expectErr(weakSup.send("POST", `/api/app/admin/invitations/${pending.id}/revoke`, { reason: "x" }), 403, "mfa_step_required");
  await setInstitution({});
  assert.equal((await sql("SELECT 1 FROM departments WHERE slug = 'weak'")).length, 0);
});

// ---------------------------------------------------------------- 17 ----
test("17 Paystack release stays disabled until the owner authorises it; with approval it waits for the approver", async () => {
  plan = ["network"];
  const b = registration({ programme: "cloud", method: "paystack", idempotencyKey: crypto.randomUUID(), learner: { ...registration().learner, email: "payer@example.com", country: "Nigeria", countryCode: "NG" } });
  await reset();
  await w.post("/api/register", b);
  const [att] = await sql<{ id: string; state: string }>("SELECT a.id, a.state FROM payment_attempts a JOIN orders o ON o.id = a.order_id WHERE o.idempotency_key = ?1", b.idempotencyKey);
  assert.equal(att.state, "uncertain");
  for (const who of [owner, sup, fin, legacy]) await expectErr(who.send("POST", `/api/app/admin/payments/attempts/${att.id}/release`, { reason: "x", confirmedWithPaystack: true }), 403, "release_not_authorised");
  // Checking stays available to Finance.
  assert.equal((await fin.send("POST", `/api/app/admin/payments/attempts/${att.id}/check`)).status, 200);
  // Fixture: Finance may release, but each release needs the owner's approval.
  await setApprovals({ paymentRelease: { enabled: true, approver: "owner", expiresInHours: 24, allowedGroups: ["finance"], requiresApproval: true } });
  await mkUser("aca2@example.com", "admin", "academic");
  const aca2 = await signIn("aca2@example.com");
  await expectErr(aca2.send("POST", `/api/app/admin/payments/attempts/${att.id}/release`, { reason: "x", confirmedWithPaystack: true }), 403);
  await expectErr(legacy.send("POST", `/api/app/admin/payments/attempts/${att.id}/release`, { reason: "x", confirmedWithPaystack: true }), 403, "release_not_authorised");
  await expectErr(fin.send("POST", `/api/app/admin/payments/attempts/${att.id}/release`, { reason: "Checked" }), 409, "payment_settling", "the checks run before a request is stored (E.4: a definite answer must hold 30 minutes)");
  await settled(w, att.id);
  const rq = await fin.send("POST", `/api/app/admin/payments/attempts/${att.id}/release`, { reason: "Abandoned at Paystack for over 30 minutes" });
  assert.equal(rq.status, 202);
  const reqId = ((await rq.json()) as { request: { id: string } }).request.id;
  assert.equal((await sql<{ state: string }>("SELECT state FROM payment_attempts WHERE id = ?1", att.id))[0].state, "uncertain", "nothing released before approval");
  await expectErr(fin.send("POST", `/api/app/admin/approvals/${reqId}/decision`, { decision: "approve" }), 403, "forbidden", "Finance cannot approve its own release");
  await expectErr(sup.send("POST", `/api/app/admin/approvals/${reqId}/decision`, { decision: "approve" }), 403, "forbidden", "the owner is the approver");
  const d = await owner.json<{ executed: boolean }>("POST", `/api/app/admin/approvals/${reqId}/decision`, { decision: "approve" });
  assert.equal(d.executed, true);
  const [after] = await sql<{ state: string; released_by: string; released_reason: string }>("SELECT state, released_by, released_reason FROM payment_attempts WHERE id = ?1", att.id);
  assert.deepEqual([after.state, after.released_by], ["released", ids.fin]);
  assert.match(after.released_reason, /approval/);
  const [rel] = (await audits("payment.attempt_release", att.id)).slice(-1);
  assert.deepEqual([rel.d.releasedBy, rel.d.approvedBy, rel.d.approvalRequest], [ids.fin, ids.owner, reqId]);
  // A release never retries the payment: no new Paystack call was made by the release itself.
  assert.equal(w.calls.filter((c) => c.url.endsWith("/transaction/initialize")).length, 1);
  await setApprovals({});
});

// ---------------------------------------------------------------- 18 ----
test("18 regression: with every rule off, existing administration works as before", async () => {
  await sup.json("PATCH", `/api/app/admin/users/${ids.fin}`, { adminRole: "reporting", reason: "Temporary" });
  await owner.json("PATCH", `/api/app/admin/users/${ids.fin}`, { adminRole: "finance", reason: "Restored" });
  const stu = await mkUser("plain.student@example.com", "student");
  await sup.json("PATCH", `/api/app/admin/users/${stu}`, { status: "suspended" }); // students: no staff reason needed
  await sup.json("PATCH", `/api/app/admin/users/${stu}`, { status: "active" });
  const s = session(w, "sma_session=nope");
  assert.equal((await s.get("/api/app/admin/department")).status, 401);
});
