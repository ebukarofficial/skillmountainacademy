// Expansion Stage C: programme lifecycle vs admissions availability, one-on-one instructor eligibility and capacity,
// reassignment safety, and the read-only capacity exception analysis. Real requests to the real Worker (Miniflare).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { startWorker, SECRETS, registration } from "./worker-harness.ts";
import { signIn as helperSignIn, approve, eligible, type Session } from "./lms-helpers.ts";
import { stepOf, totpAt } from "../src/server/lms/mfa-crypto.ts";
import { SEED_PROGRAMMES } from "../lib/config.ts";

type W = Awaited<ReturnType<typeof startWorker>>;
const OWNER = "boss@example.com";
let w: W;
let owner: Session, academic: Session, admissions: Session, finance: Session;
const ids: Record<string, string> = {};

const reset = async () => { await (await w.db()).prepare("DELETE FROM rate_limits").run(); };
const signIn = async (email: string) => { await reset(); return helperSignIn(w, email); };
async function strong(email: string) {
  const s = await signIn(email);
  const secret = (await s.json<{ secret: string }>("POST", "/api/auth/mfa/setup")).secret;
  await s.json("POST", "/api/auth/mfa/enable", { code: await totpAt(secret, stepOf(Date.now())) });
  return s;
}
const errOf = async (r: Response) => ((await r.clone().json()) as { error: string }).error;
const sql = async <T = Record<string, unknown>>(q: string, ...args: unknown[]) => (await (await w.db()).prepare(q).bind(...args).all<T>()).results;
const audits = async (action: string, target?: string) => (await sql<{ detail: string }>("SELECT detail FROM audit_log WHERE action = ?1 AND (?2 IS NULL OR target_id = ?2) ORDER BY at", action, target ?? null)).map((r) => JSON.parse(r.detail));
let regN = 0;
const register = async (programme: string) => { await reset(); return w.post("/api/register", registration({ programme, method: "bank", learner: { ...registration().learner, email: `reg${++regN}@example.com` } })); };
const user = async (email: string, role: string, extra: Record<string, unknown> = {}) =>
  (await owner.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email, role, fullName: email.split("@")[0], sendInvite: false, ...extra })).user.id;
const enrol = (studentId: string, programme: string, instructorId?: string) => owner.send("POST", "/api/app/admin/enrolments", { studentId, programme, ...(instructorId ? { instructorId } : {}) });
const hashEnrolments = async () => createHash("sha256").update(JSON.stringify(await sql("SELECT * FROM enrolments ORDER BY id"))).digest("hex");

before(async () => {
  w = await startWorker({ env: { ...SECRETS, OWNER_EMAIL: OWNER, MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } });
  owner = await strong(OWNER);
  await owner.json("POST", "/api/app/owner/bootstrap");
  for (const [k, role] of [["academic", "academic"], ["admissions", "admissions"], ["finance", "finance"]]) await user(`${k}@example.com`, "admin", { adminRole: role });
  academic = await signIn("academic@example.com");
  admissions = await signIn("admissions@example.com");
  finance = await signIn("finance@example.com");
  for (const k of ["insA", "insB", "insD"]) { ids[k] = await user(`${k}@example.com`, "instructor"); await approve(owner, ids[k]); }
  ids.cand = await user("cand@example.com", "instructor"); // a candidate: never approved
  await eligible(owner, ids.insA, "webdev", "graphics", "marketing");
  await eligible(owner, ids.insD, "webdev");
  for (const k of ["s1", "s2", "s3", "s4", "s5"]) ids[k] = await user(`${k}@example.com`, "student");
});
after(async () => { await w.dispose(); });

// ---------------------------------------------------------------- baseline ----
test("baseline: the nine public programmes are unchanged and the 21 drafts stay unpublished; no cohort structures", async () => {
  const c = (await (await w.fetchApi("/api/catalogue")).json()) as { programmes: { slug: string; price: number }[] };
  assert.deepEqual(c.programmes.map((p) => [p.slug, p.price]), SEED_PROGRAMMES.map((p) => [p.slug, p.price]));
  assert.deepEqual((await sql<{ n: number; pub: number }>("SELECT COUNT(*) AS n, SUM(slug IN (SELECT slug FROM programmes)) AS pub FROM programme_drafts"))[0], { n: 21, pub: 8 }, "21 drafts; 8 reuse a live slug, none published");
  const tables = (await sql<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name);
  assert.ok(!tables.some((t) => /cohort|group_class|class_group/i.test(t)), "no cohort or group-class tables");
});

// ---------------------------------------------------------------- lifecycle beats admissions ----
test("lifecycle: draft, paused and retired programmes refuse registrations even with admissions open; resume restores", async () => {
  assert.equal(await errOf(await register("python")), "programme_unavailable", "draft");
  await owner.json("PATCH", "/api/app/admin/admissions/marketing", { mode: "open" });
  await owner.json("POST", "/api/app/admin/catalogue/programmes/marketing/pause");
  assert.equal(await errOf(await register("marketing")), "programme_unavailable", "paused, although admissions say open");
  assert.equal((await w.fetchApi("/api/quote?programme=marketing&country=NG")).status, 409);
  const pub = (await (await w.fetchApi("/api/admissions")).json()) as { programmes: Record<string, { state: string }> };
  assert.equal(pub.programmes.marketing.state, "closed", "the website shows it closed until the next build removes it");
  assert.equal(await errOf(await enrol(ids.s5, "marketing")), "programme_unavailable", "admins cannot add new students to a paused programme");
  assert.equal(await errOf(await academic.send("POST", "/api/app/admin/catalogue/programmes/marketing/resume")), "owner_required", "resume follows the publisher rule");
  await owner.json("POST", "/api/app/admin/catalogue/programmes/marketing/resume");
  assert.equal((await register("marketing")).status, 200);
  assert.deepEqual((await audits("catalogue.resume", "marketing")).map((a) => a.to), ["published"]);
});

test("admissions: closed and scheduled are separate from the lifecycle; the opening time is respected", async () => {
  assert.equal((await academic.send("PATCH", "/api/app/admin/admissions/uiux", { mode: "closed" })).status, 403, "admissions settings belong to the Admissions group");
  await admissions.json("PATCH", "/api/app/admin/admissions/uiux", { mode: "closed" });
  assert.equal(await errOf(await register("uiux")), "admissions_closed");
  const opens = new Date(Date.now() + 3 * 86400_000).toISOString(), closes = new Date(Date.now() + 30 * 86400_000).toISOString();
  await admissions.json("PATCH", "/api/app/admin/admissions/uiux", { mode: "scheduled" });
  const period = (await admissions.json<{ period: { id: string } }>("POST", "/api/app/admin/admissions/periods", { programme: "uiux", opensAt: opens, closesAt: closes })).period.id;
  const st = ((await (await w.fetchApi("/api/admissions")).json()) as { programmes: Record<string, { state: string; opensAt?: string }> }).programmes.uiux;
  assert.deepEqual([st.state, st.opensAt], ["upcoming", opens]);
  assert.equal(await errOf(await register("uiux")), "admissions_closed", "not before the opening time");
  await admissions.json("DELETE", `/api/app/admin/admissions/periods/${period}`);
  await admissions.json("POST", "/api/app/admin/admissions/periods", { programme: "uiux", opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: closes });
  assert.equal((await register("uiux")).status, 200, "open once the period has started");
  assert.ok((await audits("admissions.update", "uiux")).length >= 2, "admissions changes are audited");
  const view = await owner.json<{ programmes: { slug: string; status: string; admissions: { mode: string; state: string } }[] }>("GET", "/api/app/admin/catalogue");
  assert.deepEqual(view.programmes.find((p) => p.slug === "uiux")!.admissions && [view.programmes.find((p) => p.slug === "uiux")!.status, view.programmes.find((p) => p.slug === "uiux")!.admissions.mode], ["published", "scheduled"]);
  const hist = await owner.json<{ history: { action: string }[] }>("GET", "/api/app/admin/catalogue/programmes/uiux/history");
  assert.ok(hist.history.some((h) => h.action === "admissions.update"));
});

test("admissions: a fully subscribed programme refuses new registrations", async () => {
  await owner.json("PUT", `/api/app/admin/instructors/${ids.insD}/programmes/cybersecurity`, { maxStudents: 1 });
  await owner.json("PATCH", "/api/app/admin/admissions/cybersecurity", { enforceCapacity: true });
  assert.equal((await enrol(ids.s4, "cybersecurity", ids.insD)).status, 201);
  assert.equal(await errOf(await register("cybersecurity")), "programme_full");
  await owner.json("PATCH", "/api/app/admin/admissions/cybersecurity", { enforceCapacity: false });
});

// ---------------------------------------------------------------- eligibility ----
test("eligibility: unapproved, inactive and not-eligible instructors cannot receive students; eligible ones can", async () => {
  assert.equal(await errOf(await enrol(ids.s1, "webdev", ids.cand)), "not_approved");
  assert.equal(await errOf(await enrol(ids.s1, "webdev", ids.insB)), "not_eligible", "approved but not approved to teach Web Development");
  await owner.json("PATCH", `/api/app/admin/users/${ids.insD}`, { status: "suspended" });
  assert.equal((await enrol(ids.s1, "webdev", ids.insD)).status, 400, "suspended");
  const r = await enrol(ids.s1, "webdev", ids.insA);
  assert.equal(r.status, 201);
  ids.en1 = ((await r.json()) as { enrolment: { id: string } }).enrolment.id;
  // A client-side capacity figure is ignored: only the server decides.
  const opts = await academic.json<{ options: { id: string; ok: boolean; blocks: { code: string }[]; capacity: { programmeLoad: number } | null }[]; advisory: boolean }>("GET", `/api/app/admin/assignment-options?enrolmentId=${ids.en1}&capacity=999`);
  assert.equal(opts.options.find((o) => o.id === ids.insA)!.capacity!.programmeLoad, 1);
  assert.deepEqual(opts.options.find((o) => o.id === ids.insB)!.blocks.map((b) => b.code), ["not_eligible"]);
  assert.equal(opts.options.some((o) => o.id === ids.insD), false, "suspended instructors are not offered");
});

test("assignment: duplicate or conflicting relationships are refused", async () => {
  // The database already refuses two enrolments for the same student and programme (UNIQUE since 0003), so a second
  // instructor relationship cannot exist; the API refuses it too.
  assert.equal(await errOf(await enrol(ids.s1, "webdev", ids.insA)), "exists");
  const dup = await sql("INSERT INTO enrolments (id, student_id, programme_slug, status, started_at, created_at) VALUES ('dup-1', ?1, 'webdev', 'active', '2026-11-01', '2026-11-01')", ids.s1).then(() => "inserted", (e: Error) => e.message);
  assert.match(dup, /UNIQUE/);
  // An enrolment that is no longer current cannot be given an instructor.
  const r = await enrol(ids.s5, "devops");
  const en = ((await r.json()) as { enrolment: { id: string } }).enrolment.id;
  await owner.json("PATCH", `/api/app/admin/enrolments/${en}`, { status: "withdrawn" });
  await eligible(owner, ids.insA, "devops");
  assert.equal(await errOf(await owner.send("PATCH", `/api/app/admin/enrolments/${en}`, { instructorId: ids.insA })), "enrolment_not_current");
});

// ---------------------------------------------------------------- reassignment ----
test("reassignment: needs eligibility and a reason; records old and new instructor and the actor; academic records stay", async () => {
  await eligible(owner, ids.insB, "webdev");
  const insA = await signIn("insa@example.com");
  const a = await insA.json<{ assignment: { id: string } }>("POST", "/api/app/instructor/assignments", { studentId: ids.s1, title: "Build a page", dueAt: new Date(Date.now() + 86400_000).toISOString(), programme: "webdev" });
  const before = await sql("SELECT id, student_id, instructor_id, enrolment_id FROM assignments ORDER BY id");
  assert.equal((await owner.send("PATCH", `/api/app/admin/enrolments/${ids.en1}`, { instructorId: ids.insB })).status, 400, "a reason is required");
  for (const s of [finance, insA, await signIn("s1@example.com")]) assert.equal((await s.send("PATCH", `/api/app/admin/enrolments/${ids.en1}`, { instructorId: ids.insB, reason: "x" })).status, 403);
  await academic.json("PATCH", `/api/app/admin/enrolments/${ids.en1}`, { instructorId: ids.insB, reason: "Instructor on leave" });
  const [audit] = await audits("enrolment.reassign", ids.en1);
  const academicId = (await academic.json<{ user: { id: string } }>("GET", "/api/me")).user.id;
  assert.deepEqual([audit.previousInstructorId, audit.newInstructorId, audit.reason, audit.by], [ids.insA, ids.insB, "Instructor on leave", academicId]);
  assert.deepEqual(await sql("SELECT id, student_id, instructor_id, enrolment_id FROM assignments ORDER BY id"), before, "coursework keeps its history");
  assert.ok(a.assignment.id);
  assert.deepEqual((await sql<{ status: string }>("SELECT status FROM enrolments WHERE id = ?1", ids.en1))[0], { status: "active" }, "the enrolment is preserved");
  // Instructors see only their own students.
  const listB = await (await signIn("insb@example.com")).json<{ students: { id: string }[] }>("GET", "/api/app/instructor/students");
  const listA = await (await signIn("insa@example.com")).json<{ students: { id: string }[] }>("GET", "/api/app/instructor/students");
  assert.ok(JSON.stringify(listB).includes(ids.s1) && !JSON.stringify(listA).includes(ids.s1));
});

// ---------------------------------------------------------------- capacity ----
test("capacity: computed on the server; over the limit is a warning (D-11 open); the 20/30 proposal is not enforced", async () => {
  await owner.json("PUT", `/api/app/admin/instructors/${ids.insA}/programmes/graphics`, { maxStudents: 1 });
  assert.equal((await enrol(ids.s2, "graphics", ids.insA)).status, 201);
  const over = await enrol(ids.s3, "graphics", ids.insA);
  assert.equal(over.status, 201, "existing behaviour: going over an instructor's limit is not blocked until the owner approves a policy");
  // 22 current students in total for insA (simulated directly): above the proposed 20, still assignable.
  for (let i = 0; i < 20; i++) await sql("INSERT INTO users (id, email, role, full_name, status, created_at) VALUES (?1, ?2, 'student', 'Bulk', 'active', '2026-11-01')", `bulk-student-${i}`, `bulk${i}@example.com`);
  for (let i = 0; i < 20; i++) await sql("INSERT INTO enrolments (id, student_id, programme_slug, instructor_id, status, started_at, created_at) VALUES (?1, ?2, 'graphics', ?3, 'active', '2026-11-01', '2026-11-01')", `bulk-${i}`, `bulk-student-${i}`, ids.insA);
  const opts = await academic.json<{ options: { id: string; ok: boolean; warnings: { code: string }[] }[]; policy: { status: string; enforce: boolean } }>("GET", `/api/app/admin/assignment-options?programme=graphics&studentId=${ids.s5}`);
  const a = opts.options.find((o) => o.id === ids.insA)!;
  assert.deepEqual([a.ok, a.warnings.map((x) => x.code)], [true, ["over_capacity"]]);
  assert.deepEqual([opts.policy.status, opts.policy.enforce], ["not_set", false]);
  const rep = await academic.json<{ instructors: { id: string; activeStudents: number; flags: { overProposedStandard: boolean; overConfigured: boolean } }[]; exceptions: Record<string, { count: number; items: Record<string, unknown>[] }>; proposal: { status: string } }>("GET", "/api/app/admin/capacity");
  const rowA = rep.instructors.find((r) => r.id === ids.insA)!;
  assert.deepEqual([rowA.activeStudents, rowA.flags.overProposedStandard, rowA.flags.overConfigured], [22, true, true]);
  assert.match(rep.proposal.status, /not approved/);
  assert.equal(rep.exceptions.aboveProposedStandard.items[0].instructorId, ids.insA);
});

test("capacity: the owner can record and later enforce an approved policy without schema changes; nobody else can", async () => {
  const body = { status: "approved", standardPerInstructor: 20, maximumPerInstructor: 30, enforce: true };
  for (const s of [academic, finance]) assert.equal((await s.send("PUT", "/api/app/owner/capacity-policy", body)).status, 403);
  assert.equal((await owner.send("PUT", "/api/app/owner/capacity-policy", { ...body, status: "pending_approval" })).status, 400, "enforcement only for an approved policy");
  const before = await hashEnrolments();
  await owner.json("PUT", "/api/app/owner/capacity-policy", { ...body, maximumPerInstructor: 22 });
  assert.equal(await errOf(await enrol(ids.s5, "graphics", ids.insA)), "over_capacity", "once enforced, a new assignment over the limit is refused");
  assert.equal(await hashEnrolments(), before, "existing assignments are never changed or removed by a policy");
  await owner.json("PUT", "/api/app/owner/capacity-policy", { status: "not_set", standardPerInstructor: null, maximumPerInstructor: null, enforce: false });
  assert.equal((await audits("owner.capacity_policy")).length, 2);
});

test("exceptions: read-only analysis lists every inconsistency with identifiers; nothing is repaired", async () => {
  await sql("INSERT INTO enrolments (id, student_id, programme_slug, instructor_id, status, started_at, created_at) VALUES ('odd-1', ?1, 'devops', ?2, 'active', '2026-11-01', '2026-11-01')", ids.s4, ids.insB);
  await sql("INSERT INTO enrolments (id, student_id, programme_slug, instructor_id, status, started_at, created_at) VALUES ('odd-2', ?1, 'cloud', ?2, 'active', '2026-11-01', '2026-11-01')", ids.s4, ids.insD);
  await sql("INSERT INTO enrolments (id, student_id, programme_slug, instructor_id, status, started_at, created_at) VALUES ('old-1', ?1, 'uiux', ?2, 'completed', '2025-01-01', '2025-01-01')", ids.s4, ids.insB);
  const before = await hashEnrolments();
  const ex = (await academic.json<{ exceptions: Record<string, { count: number; items: Record<string, unknown>[] }> }>("GET", "/api/app/admin/capacity")).exceptions;
  assert.equal(await hashEnrolments(), before, "read-only");
  assert.ok(ex.assignedWithoutEligibility.items.some((i) => i.enrolmentId === "odd-1"));
  assert.ok(ex.assignedToUnapprovedOrInactive.items.some((i) => i.instructorId === ids.insD), "suspended instructor still holding students");
  assert.equal(ex.multipleCurrentEnrolmentsSameProgramme.count, 0, "impossible by the UNIQUE constraint; still checked");
  await enrol(ids.s3, "webdev");
  const ex2 = (await academic.json<{ exceptions: Record<string, { items: Record<string, unknown>[] }> }>("GET", "/api/app/admin/capacity")).exceptions;
  assert.ok(ex2.awaitingInstructor.items.some((i) => i.studentId === ids.s3 && i.programme === "webdev"));
  assert.ok(!ex.assignedWithoutEligibility.items.some((i) => i.enrolmentId === "old-1"), "completed enrolments are history, not current capacity");
  assert.equal((await finance.send("GET", "/api/app/admin/capacity")).status, 403);
  assert.equal((await (await signIn("s4@example.com")).send("GET", "/api/app/admin/capacity")).status, 403, "students cannot reach administration");
});

// ---------------------------------------------------------------- retirement keeps access ----
test("retirement: existing students keep access to their programme and work; new students are refused", async () => {
  await owner.json("POST", "/api/app/admin/catalogue/programmes/graphics/retire", { reason: "Replaced by the 2027 programme" });
  const s2 = await signIn("s2@example.com");
  const ov = await s2.send("GET", "/api/app/student/overview");
  assert.equal(ov.status, 200);
  assert.match(await ov.text(), /graphics|Graphics/);
  assert.equal((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM enrolments WHERE programme_slug = 'graphics' AND status = 'active'"))[0].n, 22, "no enrolment changed");
  assert.equal(await errOf(await register("graphics")), "programme_unavailable");
  assert.equal(await errOf(await enrol(ids.s5, "graphics", ids.insA)), "programme_unavailable");
  // Continuity: an existing student on a retired programme can still be moved to another eligible instructor.
  await eligible(owner, ids.insB, "graphics");
  const en2 = (await sql<{ id: string }>("SELECT id FROM enrolments WHERE student_id = ?1 AND programme_slug = 'graphics'", ids.s2))[0].id;
  const moved = await owner.json<{ enrolment: { instructor_id: string } }>("PATCH", `/api/app/admin/enrolments/${en2}`, { instructorId: ids.insB, reason: "Continuity after retirement" });
  assert.equal(moved.enrolment.instructor_id, ids.insB);
});

// ---------------------------------------------------------------- permissions ----
test("permissions: every Stage C route is in the default-deny table", async () => {
  const r = await build({ stdin: { contents: `import "./src/server/lms/index"; export { routeList } from "./src/server/lms/api"; export { permissionTable, adminMay } from "./src/server/lms/permissions";`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, format: "esm", platform: "neutral", mainFields: ["module", "main"], write: false, logLevel: "silent" });
  const m = await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}`);
  const table = new Set((m.permissionTable() as { method: string; path: string }[]).map((p) => `${p.method} ${p.path}`));
  for (const key of ["GET /api/app/admin/capacity", "GET /api/app/admin/assignment-options", "PUT /api/app/owner/capacity-policy", "POST /api/app/admin/catalogue/programmes/:slug/resume", "GET /api/app/admin/catalogue/programmes/:slug/history"])
    assert.ok(table.has(key), key);
  for (const x of m.routeList() as { method: string; path: string; roles: string[] }[]) if (x.path.startsWith("/api/app/admin/") || x.path.startsWith("/api/app/owner/")) assert.ok(table.has(`${x.method} ${x.path}`), `${x.method} ${x.path}`);
  const may = m.adminMay as (role: string | null, method: string, path: string) => boolean;
  assert.deepEqual([may("academic", "GET", "/api/app/admin/capacity"), may("finance", "GET", "/api/app/admin/capacity"), may("super", "PUT", "/api/app/owner/capacity-policy")], [true, false, false]);
});
