// Admissions periods, capacity enforcement and instructor verification.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { admissionStatus, capacity, statusLabel, DEFAULT_SETTING } from "../lib/admissions.ts";
import { read } from "./helpers.ts";
import { registration, learner, startWorker } from "./worker-harness.ts";
import { REQUIRED, setup, signIn } from "./lms-helpers.ts";

let w: Awaited<ReturnType<typeof startWorker>>;
before(async () => { w = await startWorker(); });
after(async () => { await w.dispose(); });
let ipN = 0;
const register = (email: string, programme = "cloud") => w.post("/api/register", registration({ programme, learner: learner({ email }) }), { "cf-connecting-ip": `10.77.0.${++ipN}` });
const pub = async () => ((await (await w.fetchApi("/api/admissions")).json()) as { programmes: Record<string, Record<string, unknown>> }).programmes;

test("rules: capacity counts assignments; status follows mode, periods and capacity", () => {
  const cap = capacity([{ max_students: 2 }, { max_students: null }], 30, 10, 3);
  assert.deepEqual(cap, { total: 32, enrolled: 10, reserved: 3, available: 19, utilisation: 13 / 32, full: false });
  assert.equal(capacity([], 30, 0, 0).full, true);
  const now = new Date("2027-01-10T12:00:00Z");
  const per = (o: string, c: string, slug: string | null = null) => ({ programme_slug: slug, opens_at: o, closes_at: c });
  assert.equal(admissionStatus("cloud", DEFAULT_SETTING, [], now, null).state, "open");
  assert.equal(admissionStatus("cloud", { ...DEFAULT_SETTING, mode: "closed" }, [], now, null).state, "closed");
  const sch = { ...DEFAULT_SETTING, mode: "scheduled" as const };
  assert.deepEqual(admissionStatus("cloud", sch, [per("2027-01-01T00:00:00Z", "2027-02-01T00:00:00Z")], now, null), { state: "open", closesAt: "2027-02-01T00:00:00Z", listed: true });
  assert.deepEqual(admissionStatus("cloud", sch, [per("2027-03-01T00:00:00Z", "2027-04-01T00:00:00Z")], now, null), { state: "upcoming", opensAt: "2027-03-01T00:00:00Z", listed: true });
  assert.equal(admissionStatus("cloud", sch, [per("2027-01-01T00:00:00Z", "2027-02-01T00:00:00Z", "webdev")], now, null).state, "closed", "another programme's period does not open this one");
  assert.equal(admissionStatus("cloud", { ...DEFAULT_SETTING, enforce_capacity: 1 }, [], now, capacity([], 30, 0, 0)).state, "full");
  assert.equal(admissionStatus("cloud", { ...DEFAULT_SETTING, enforce_capacity: 0 }, [], now, capacity([], 30, 0, 0)).state, "open", "capacity is advisory until enforced");
  for (const st of ["open", "upcoming", "closed", "full"] as const) {
    const l = statusLabel({ state: st, listed: true });
    assert.doesNotMatch(`${l.title} ${l.detail}`, /\d+ (seat|place|spot)s?|only \d|hurry|last chance/i, "no seat numbers or pressure wording");
  }
});

test("by default every programme is open and registration works as before; the public status has no capacity figures", async () => {
  const p = await pub();
  assert.equal(Object.keys(p).length, 9);
  for (const s of Object.values(p)) {
    assert.equal(s.state, "open");
    assert.deepEqual(Object.keys(s).filter((k) => !["state", "listed", "opensAt", "closesAt"].includes(k)), []);
  }
  assert.equal((await register("open1@example.com")).status, 200);
});

test("closing admissions refuses new registrations before anything is saved or charged, and is audited", async () => {
  const { admin } = await setup(w);
  await admin.json("PATCH", "/api/app/admin/admissions/webdev", { mode: "closed" });
  assert.equal((await pub()).webdev.state, "closed");
  const before = w.calls.length;
  const r = await register("closed1@example.com", "webdev");
  assert.equal(r.status, 409);
  assert.equal(((await r.json()) as { error: string }).error, "admissions_closed");
  assert.ok(!w.calls.slice(before).some((c) => c.url.includes("paystack")), "no payment started");
  const db = await w.db();
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE email = 'closed1@example.com'").first<{ n: number }>())?.n, 0);
  const audit = await db.prepare("SELECT * FROM audit_log WHERE action = 'admissions.update' AND target_id = 'webdev'").first<Record<string, string>>();
  assert.match(audit!.detail, /"closed"/);
  await admin.json("PATCH", "/api/app/admin/admissions/webdev", { mode: "open" });
  assert.equal((await register("closed2@example.com", "webdev")).status, 200);
});

test("scheduled admissions follow the admission periods; cancelling a period closes it", async () => {
  const { admin } = await setup(w);
  await admin.json("PATCH", "/api/app/admin/admissions/marketing", { mode: "scheduled" });
  assert.equal((await pub()).marketing.state, "closed");
  const soon = new Date(Date.now() + 5 * 86400_000).toISOString(), later = new Date(Date.now() + 40 * 86400_000).toISOString();
  const fut = await admin.json<{ period: { id: string } }>("POST", "/api/app/admin/admissions/periods", { programme: "marketing", opensAt: soon, closesAt: later, label: "Spring intake" });
  assert.equal((await pub()).marketing.state, "upcoming");
  assert.equal((await pub()).marketing.opensAt, soon);
  assert.equal((await register("sched1@example.com", "marketing")).status, 409);
  const nowP = await admin.json<{ period: { id: string } }>("POST", "/api/app/admin/admissions/periods", { opensAt: new Date(Date.now() - 86400_000).toISOString(), closesAt: later });
  assert.equal((await pub()).marketing.state, "open", "a period for all programmes opens it");
  assert.equal((await register("sched2@example.com", "marketing")).status, 200);
  await admin.json("DELETE", `/api/app/admin/admissions/periods/${nowP.period.id}`);
  assert.equal((await pub()).marketing.state, "upcoming");
  const bad = await admin.send("POST", "/api/app/admin/admissions/periods", { opensAt: later, closesAt: soon });
  assert.equal(bad.status, 400);
  await admin.json("DELETE", `/api/app/admin/admissions/periods/${fut.period.id}`);
  await admin.json("PATCH", "/api/app/admin/admissions/marketing", { mode: "open" });
});

test("capacity comes from approved instructors; a full programme refuses registration and payment", async () => {
  const { admin, make } = await setup(w);
  await admin.json("PATCH", "/api/app/admin/admissions/devops", { enforceCapacity: true });
  assert.equal((await pub()).devops.state, "full", "no assigned instructors = no capacity");
  const r = await register("full1@example.com", "devops");
  assert.equal(r.status, 409);
  assert.equal(((await r.json()) as { error: string }).error, "programme_full");

  // An unapproved candidate does not add capacity.
  const cand = await admin.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "cand-cap@example.com", role: "instructor", fullName: "Cand Cap" });
  await admin.json("PUT", `/api/app/admin/instructors/${cand.user.id}/programmes/devops`, { maxStudents: 5 });
  assert.equal((await pub()).devops.state, "full");

  const ins = await make("instructor", "cap-ins@example.com", "Cap Instructor");
  await admin.json("PUT", `/api/app/admin/instructors/${ins}/programmes/devops`, { maxStudents: 1 });
  assert.equal((await pub()).devops.state, "open");
  const view = await admin.json<{ programmes: { slug: string; capacity: { total: number; available: number } }[] }>("GET", "/api/app/admin/admissions");
  assert.deepEqual(view.programmes.find((p) => p.slug === "devops")!.capacity, { total: 1, enrolled: 0, reserved: 0, available: 1, utilisation: 0, full: false });

  const st = await make("student", "cap-st@example.com", "Cap Student");
  await admin.json("POST", "/api/app/admin/enrolments", { studentId: st, programme: "devops", instructorId: ins });
  assert.equal((await pub()).devops.state, "full");
  await admin.json("PATCH", "/api/app/admin/admissions/devops", { enforceCapacity: false });
  assert.equal((await pub()).devops.state, "open");
});

test("capacity and recruitment are admin-only", async () => {
  const { make } = await setup(w);
  await make("student", "nosy@example.com", "Nosy Student");
  const s = await signIn(w, "nosy@example.com");
  for (const p of ["/api/app/admin/admissions", "/api/app/admin/recruitment"]) assert.equal((await s.get(p)).status, 403);
  assert.equal((await s.send("PATCH", "/api/app/admin/admissions/cloud", { mode: "closed" })).status, 403);
});

test("instructor onboarding: invited candidates sign in only to complete their profile; approval needs the required checks and shows the verified badge", async () => {
  const { admin, make } = await setup(w);
  const c = await admin.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "cand@example.com", role: "instructor", fullName: "Dr Cand Idate" });
  const id = c.user.id;
  const list = await admin.json<{ candidates: { id: string; verification: string }[] }>("GET", "/api/app/admin/recruitment?stage=application_received");
  assert.ok(list.candidates.some((x) => x.id === id && x.verification === "application_received"));

  // The invitation congratulates them and lists the onboarding steps.
  assert.ok(await w.waitFor((cs) => cs.some((x) => x.url.includes("api.resend.com") && x.body.includes("cand@example.com") && x.body.includes("invited to join the Skill Mountain Academy faculty"))), "congratulations invite");
  const cand = await signIn(w, "cand@example.com");
  const me0 = (await cand.json<{ user: { verification: string; verified: boolean } }>("GET", "/api/me")).user;
  assert.deepEqual([me0.verification, me0.verified], ["application_received", false]);
  const blocked = await cand.send("GET", "/api/app/instructor/students");
  assert.equal(blocked.status, 403, "nothing but the profile until verified");
  assert.match(((await blocked.json()) as { message: string }).message, /awaiting verification/);
  const early0 = await cand.send("POST", "/api/app/instructor/onboarding/submit");
  assert.equal(early0.status, 400);
  assert.match(((await early0.json()) as { message: string }).message, /photo/);
  await cand.json("PATCH", "/api/me", { headline: "Senior product designer, 10 years", bio: "I design and teach digital products. ".repeat(4), specialization: "Graphic design",
    countryOrigin: "Ghana", countryResidence: "United Kingdom", languages: ["English", "French"], links: { linkedin: "https://linkedin.com/in/cand", x: "https://x.com/cand", facebook: "https://facebook.com/cand", portfolio: "https://cand.design" },
    achievements: ["Led the redesign of a national banking app"], certifications: [{ title: "Google UX Design Certificate", issuer: "Google", year: "2023", url: "https://www.credly.com/badges/example" }] });
  assert.equal((await cand.send("PATCH", "/api/me", { certifications: [{ title: "X", url: "http://insecure" }] })).status, 400, "verification links must be https");
  const ph = await w.fetchApi("/api/me/photo?name=me.png", { method: "PUT", headers: { cookie: cand.cookie, origin: "https://skillmountainacademy.com", "content-type": "image/png", "content-length": "8" }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
  assert.equal(ph.status, 200);
  const sub = await cand.json<{ user: { verification: string; profileSubmittedAt: string } }>("POST", "/api/app/instructor/onboarding/submit");
  assert.equal(sub.user.verification, "under_review");
  assert.ok(await w.waitFor((cs) => cs.some((x) => x.url.includes("api.resend.com") && x.body.includes("Instructor profile submitted"))), "admins are told");
  const view = (await admin.json<{ candidate: { headline: string; certifications: { url: string }[]; languages: string[]; countryResidence: string } }>("GET", `/api/app/admin/recruitment/${id}`)).candidate;
  assert.deepEqual([view.headline, view.certifications[0].url, view.languages[1], view.countryResidence], ["Senior product designer, 10 years", "https://www.credly.com/badges/example", "French", "United Kingdom"]);

  // Cannot be assigned students.
  const st = await make("student", "cand-st@example.com", "Cand Student");
  const e = await admin.send("POST", "/api/app/admin/enrolments", { studentId: st, programme: "graphics", instructorId: id });
  assert.equal(e.status, 400);

  // Moving through the stages; approval needs identity, credentials and the technical assessment.
  await admin.json("PATCH", `/api/app/admin/recruitment/${id}`, { highestQualification: "PhD", experience: "Ten years in industry." });
  const early = await admin.send("PATCH", `/api/app/admin/recruitment/${id}`, { stage: "approved", checks: { identity: { done: true } } });
  assert.equal(early.status, 400);
  assert.match(((await early.json()) as { message: string }).message, /credentials/);
  assert.equal((await admin.send("PATCH", `/api/app/admin/recruitment/${id}`, { publicProfile: true })).status, 400, "unapproved instructors are never shown publicly");
  const ok = await admin.json<{ candidate: { verification: string; checks: Record<string, { done: boolean; by: string }> } }>("PATCH", `/api/app/admin/recruitment/${id}`, { stage: "approved", checks: REQUIRED });
  assert.equal(ok.candidate.verification, "approved");
  assert.ok(ok.candidate.checks.technical.done && ok.candidate.checks.technical.by);
  assert.ok(await w.waitFor((cs) => cs.some((x) => x.url.includes("api.resend.com") && x.body.includes("cand@example.com") && x.body.includes("profile is verified"))), "approval sends the verified notice");
  const ins = cand;
  const me1 = (await ins.json<{ user: { role: string; verified: boolean } }>("GET", "/api/me")).user;
  assert.deepEqual([me1.role, me1.verified], ["instructor", true], "verified badge");
  assert.equal((await ins.send("GET", "/api/app/instructor/students")).status, 200, "full workspace after approval");

  // Faculty page: only after approval AND opting in, and without private contact details.
  assert.equal(((await (await w.fetchApi("/api/faculty")).json()) as { faculty: unknown[] }).faculty.length, 0);
  await admin.json("PATCH", `/api/app/admin/recruitment/${id}`, { publicProfile: true });
  await admin.json("PUT", `/api/app/admin/instructors/${id}/programmes/graphics`, {});
  const fac = ((await (await w.fetchApi("/api/faculty")).json()) as { faculty: Record<string, unknown>[] }).faculty;
  assert.equal(fac.length, 1);
  assert.equal(fac[0].fullName, "Dr Cand Idate");
  assert.equal(fac[0].verified, true);
  assert.deepEqual(fac[0].programmes, ["graphics"]);
  assert.ok(!JSON.stringify(fac).includes("cand@example.com"), "no email on the public list");

  // Suspension signs them out at once and removes them from the Faculty page.
  await admin.json("PATCH", `/api/app/admin/recruitment/${id}`, { stage: "suspended" });
  assert.equal((await ins.get("/api/me")).status, 401);
  assert.equal(((await (await w.fetchApi("/api/faculty")).json()) as { faculty: unknown[] }).faculty.length, 0);
  const audit = await (await w.db()).prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'recruitment.stage' AND target_id = ?").bind(id).first<{ n: number }>();
  assert.equal(audit?.n, 2, "approved, then suspended (submitting moved it to review)");
});

test("new admissions code keeps SQL in the data layer", () => {
  for (const f of ["src/server/lms/admissions.ts", "src/server/lms/routes/admissions.ts", "lib/admissions.ts"]) assert.doesNotMatch(read(f), /\.prepare\(|SELECT |INSERT INTO|UPDATE \w+ SET/, f);
});
