// Admissions, capacity, instructor recruitment and the public Faculty list.
//   Public:  GET /api/admissions          -> { programmes: { slug: { state, opensAt?, closesAt?, listed } } }  (no seat numbers)
//            GET /api/faculty             -> approved instructors who chose to be listed
//            GET /api/faculty/:id/photo   -> that instructor's photo
//   Admin:   /api/app/admin/admissions..., /api/app/admin/recruitment...
import { PROGRAMMES } from "../../../../lib/config.ts";
import { CHECKS, QUALIFICATION_LEVELS, REQUIRED_CHECKS, VERIFICATION, type CheckKey, type Verification } from "../../../../lib/admissions.ts";
import { ApiError, json, nowIso } from "../../http";
import { Checker } from "../../validate";
import { notFound, ok, parseJsonCol, publicRoute, route, type Ctx } from "../api";
import { programmeAdmissions, publicAdmissions } from "../admissions";
import { lifecycleOf } from "../../catalogue";
import {
  cancelPeriod, createPeriod, deleteAssignment, getCandidate, getPeriod, getSetting, instructorAssignments, instructorLoad, listCandidates, publicFaculty, upsertAssignment, upsertSetting,
  type Candidate,
} from "../data/admissions";
import { deleteUserSessions, getUser, updateUser } from "../data/users";
import { sendFile } from "./coursework";
import { sendSignInLink } from "./auth";
import { newStaffNo } from "../ids";
import { notify } from "../notify";
import { instructorProfile } from "../views";

const SLUGS = PROGRAMMES.map((p) => p.slug);
// Stage C: any programme in the catalogue (including ones published after the last build and drafts being prepared).
const known = async (db: D1Database, slug: string) => { if (SLUGS.includes(slug)) return true; const l = await lifecycleOf(db, slug); return !!l && l !== "unknown"; };
const isoOrThrow = (ch: Checker, v: unknown, label: string) => {
  const s = String(v ?? "");
  const t = Date.parse(s);
  if (!s || Number.isNaN(t)) { ch.errors.push(`${label} is not a valid date and time.`); return ""; }
  return new Date(t).toISOString();
};

// ---------------- public ----------------
publicRoute("GET", "/api/admissions", async (c) =>
  json({ ok: true, programmes: await publicAdmissions(c.db) }, 200, { "cache-control": "public, max-age=60" }));

publicRoute("GET", "/api/faculty", async (c) => {
  const rows = await publicFaculty(c.db);
  const faculty = rows.map((u) => ({
    id: u.id, fullName: u.full_name, specialization: u.specialization, bio: u.bio, highestQualification: u.highest_qualification,
    qualifications: parseJsonCol<string[]>(u.qualifications, []), links: parseJsonCol<Record<string, string>>(u.links, {}),
    programmes: (u.programmes || "").split(",").filter((s) => SLUGS.includes(s)), photo: u.photo_key ? `/api/faculty/${u.id}/photo` : null,
    verified: true, headline: u.headline ?? null, languages: parseJsonCol<string[]>(u.languages ?? null, []),
  }));
  return json({ ok: true, faculty }, 200, { "cache-control": "public, max-age=300" });
});

publicRoute("GET", "/api/faculty/:id/photo", async (c) => {
  const u = (await publicFaculty(c.db)).find((x) => x.id === c.params.id);
  if (!u?.photo_key) throw notFound("That photo");
  return sendFile(c as Ctx, u.photo_key, "photo", true);
});

// ---------------- admin: admissions and capacity ----------------
route("GET", "/api/app/admin/admissions", ["admin"], async (c) => {
  const { list, periods } = await programmeAdmissions(c.db);
  const load = await instructorLoad(c.db);
  return ok({
    programmes: list.map((p) => ({ ...p, assignments: p.assignments.map((a) => ({ ...a, students: load.find((l) => l.instructor_id === a.instructor_id && l.programme_slug === p.slug)?.n ?? 0 })) })),
    periods,
  });
});

route("PATCH", "/api/app/admin/admissions/:slug", ["admin"], async (c) => {
  const slug = c.params.slug;
  if (!(await known(c.db, slug))) throw notFound("That programme");
  const b = await c.body();
  const cur = await getSetting(c.db, slug);
  const ch = new Checker();
  const next = {
    mode: b.mode !== undefined ? ch.oneOf(b.mode, ["open", "scheduled", "closed"] as const, "an admissions mode") : cur?.mode ?? "open",
    enforce_capacity: b.enforceCapacity !== undefined ? (b.enforceCapacity ? 1 : 0) : cur?.enforce_capacity ?? 0,
    reserved: b.reserved !== undefined ? ch.int(b.reserved, 0, 100000, "Reserved places") : cur?.reserved ?? 0,
    default_instructor_cap: b.defaultInstructorCap !== undefined ? ch.int(b.defaultInstructorCap, 1, 500, "Students per instructor") : cur?.default_instructor_cap ?? 30,
    listed: b.listed !== undefined ? (b.listed ? 1 : 0) : cur?.listed ?? 1,
  };
  ch.done();
  await upsertSetting(c.db, slug, next, c.user.id, nowIso());
  await c.audit("admissions.update", "programme", slug, { before: cur ? { mode: cur.mode, enforce_capacity: cur.enforce_capacity, reserved: cur.reserved, default_instructor_cap: cur.default_instructor_cap, listed: cur.listed } : null, after: next });
  return ok({ programme: (await programmeAdmissions(c.db)).list.find((p) => p.slug === slug) });
});

route("POST", "/api/app/admin/admissions/periods", ["admin"], async (c) => {
  const b = await c.body();
  const ch = new Checker();
  const slug = b.programme ? String(b.programme) : null;
  if (slug && !(await known(c.db, slug))) ch.errors.push("Please choose a programme.");
  const opens = isoOrThrow(ch, b.opensAt, "Opening date");
  const closes = isoOrThrow(ch, b.closesAt, "Closing date");
  if (opens && closes && closes <= opens) ch.errors.push("The closing date must be after the opening date.");
  const label = ch.opt(b.label, 80);
  ch.done();
  const p = { id: crypto.randomUUID(), programme_slug: slug, label, opens_at: opens, closes_at: closes, created_at: nowIso(), created_by: c.user.id, cancelled_at: null };
  await createPeriod(c.db, p);
  await c.audit("admissions.period.create", "admission_period", p.id, { programme: slug ?? "all", opens, closes, label });
  return ok({ period: p }, 201);
});

route("DELETE", "/api/app/admin/admissions/periods/:id", ["admin"], async (c) => {
  const p = await getPeriod(c.db, c.params.id);
  if (!p) throw notFound("That admission period");
  await cancelPeriod(c.db, p.id, nowIso());
  await c.audit("admissions.period.cancel", "admission_period", p.id, { programme: p.programme_slug ?? "all", opens: p.opens_at, closes: p.closes_at });
  return ok({});
});

// Teaching assignments: which programmes an approved instructor teaches, and their student limit for each.
route("PUT", "/api/app/admin/instructors/:id/programmes/:slug", ["admin"], async (c) => {
  const u = await getUser(c.db, c.params.id);
  if (!u || u.role !== "instructor") throw notFound("That instructor");
  if (!(await known(c.db, c.params.slug))) throw notFound("That programme");
  const b = await c.body();
  const ch = new Checker();
  const max = b.maxStudents === null || b.maxStudents === undefined || b.maxStudents === "" ? null : ch.int(b.maxStudents, 0, 500, "Maximum students");
  ch.done();
  await upsertAssignment(c.db, u.id, c.params.slug, max, nowIso());
  await c.audit("capacity.assign", "user", u.id, { programme: c.params.slug, maxStudents: max });
  return ok({ assignments: await instructorAssignments(c.db, u.id) });
});

route("DELETE", "/api/app/admin/instructors/:id/programmes/:slug", ["admin"], async (c) => {
  const n = await deleteAssignment(c.db, c.params.id, c.params.slug);
  if (!n) throw notFound("That assignment");
  await c.audit("capacity.unassign", "user", c.params.id, { programme: c.params.slug });
  return ok({});
});

// ---------------- admin: instructor recruitment and verification ----------------
type CheckState = { done: boolean; note: string | null; at: string | null; by: string | null };
const readChecks = (raw: string | null) => parseJsonCol<Partial<Record<CheckKey, CheckState>>>(raw, {});
const candidateView = (u: Candidate, assignments: Awaited<ReturnType<typeof instructorAssignments>> = []) => ({
  id: u.id, email: u.email, fullName: u.full_name, phone: u.phone, status: u.status, verification: (u.verification ?? "approved") as Verification,
  checks: readChecks(u.verification_checks), highestQualification: u.highest_qualification, qualifications: parseJsonCol<string[]>(u.qualifications, []),
  experience: u.experience, specialization: u.specialization, bio: u.bio, links: parseJsonCol<Record<string, string>>(u.links, {}), publicProfile: !!u.public_profile,
  hasPhoto: !!u.photo_key, photo: u.photo_key ? `/api/app/files/photo/${u.id}` : null, createdAt: u.created_at, profileSubmittedAt: u.profile_submitted_at ?? null, verifiedAt: u.verified_at ?? null, ...instructorProfile(u), programmes: assignments.map((a) => ({ slug: a.programme_slug, maxStudents: a.max_students })),
});

route("GET", "/api/app/admin/recruitment", ["admin"], async (c) => {
  const stage = c.url.searchParams.get("stage");
  const rows = await listCandidates(c.db, stage && (VERIFICATION as readonly string[]).includes(stage) ? stage : null);
  return ok({ candidates: rows.map((u) => candidateView(u)) });
});

route("GET", "/api/app/admin/recruitment/:id", ["admin"], async (c) => {
  const u = await getCandidate(c.db, c.params.id);
  if (!u) throw notFound("That candidate");
  return ok({ candidate: candidateView(u, await instructorAssignments(c.db, u.id)) });
});

// Updates a candidate's details, checks and stage. Approval needs the required checks; approving sends the
// sign-in invitation, and suspending or rejecting signs them out at once.
route("PATCH", "/api/app/admin/recruitment/:id", ["admin"], async (c) => {
  const u = await getCandidate(c.db, c.params.id);
  if (!u) throw notFound("That candidate");
  const b = await c.body();
  const ch = new Checker();
  const patch: Record<string, string | number | null> = {};
  if (b.highestQualification !== undefined) patch.highest_qualification = b.highestQualification ? ch.oneOf(b.highestQualification, QUALIFICATION_LEVELS, "a qualification level") : null;
  if (b.experience !== undefined) patch.experience = ch.opt(b.experience, 2000);
  if (b.publicProfile !== undefined) patch.public_profile = b.publicProfile ? 1 : 0;

  const checks = readChecks(u.verification_checks);
  if (b.checks && typeof b.checks === "object") {
    for (const [k] of CHECKS) {
      const v = (b.checks as Record<string, { done?: unknown; note?: unknown } | undefined>)[k];
      if (!v) continue;
      const done = !!v.done;
      const prev = checks[k];
      checks[k] = { done, note: ch.opt(v.note, 500), at: done ? (prev?.done ? prev.at : nowIso()) : null, by: done ? (prev?.done ? prev.by : c.user.id) : null };
    }
    patch.verification_checks = JSON.stringify(checks);
  }

  const from = (u.verification ?? "approved") as Verification;
  const to = b.stage !== undefined ? ch.oneOf(b.stage, VERIFICATION, "a stage") : from;
  ch.done();
  if (to === "approved" && from !== "approved") {
    const missing = REQUIRED_CHECKS.filter((k) => !checks[k]?.done);
    if (missing.length) throw new ApiError(400, "checks_missing", `Before approval, record: ${missing.map((k) => CHECKS.find(([x]) => x === k)![1].toLowerCase()).join("; ")}.`);
  }
  if (patch.public_profile === 1 && to !== "approved") throw new ApiError(400, "not_approved", "Only approved instructors can be shown on the Faculty page.");
  if (to !== from) {
    patch.verification = to;
    patch.status = to === "approved" ? "active" : to === "suspended" || to === "rejected" ? "suspended" : u.status;
    // The faculty number is issued once, on first approval, and kept for good.
    if (to === "approved" && !(await getUser(c.db, u.id))?.staff_no) { const no = await newStaffNo(c.db, "instructor"); if (no) patch.staff_no = no; }
    if (to !== "approved") patch.public_profile = 0;
  }
  await updateUser(c.db, u.id, patch as Parameters<typeof updateUser>[2]);
  if (to !== from) {
    // Candidates stay signed in while under review (they can still edit their profile); rejection or suspension ends access.
    if (to === "rejected" || to === "suspended") await deleteUserSessions(c.db, u.id);
    await c.audit("recruitment.stage", "user", u.id, { from, to });
    if (to === "approved") {
      await updateUser(c.db, u.id, { verified_at: nowIso() });
      const fresh = await getUser(c.db, u.id);
      if (fresh && b.sendInvite !== false) {
        // Instructors who already signed in get the "verified" notice; anyone who never did gets a fresh sign-in link too.
        c.exec.waitUntil(notify(c.env, c.db, [{ id: fresh.id, email: fresh.email, name: fresh.full_name }], { kind: "verification.approved",
          title: "Congratulations: your faculty profile is verified",
          body: `Your profile has been verified by Skill Mountain Academy${fresh.staff_no ? ` (faculty number ${fresh.staff_no})` : ""}. The verified badge now shows next to your name, and your full faculty workspace is open.`, link: "/app/" }));
        if (!fresh.last_login_at) c.exec.waitUntil(sendSignInLink(c.env, c.db, fresh, true));
      }
    } else if (to === "rejected") {
      c.exec.waitUntil(notify(c.env, c.db, [{ id: u.id, email: u.email, name: u.full_name }], { kind: "verification.closed", title: "Your Skill Mountain Academy faculty application",
        body: "Thank you for your interest in teaching with Skill Mountain Academy. After review, we are not able to proceed with your application at this time." }));
    }
  } else await c.audit("recruitment.update", "user", u.id, Object.keys(patch));
  const fresh = (await getCandidate(c.db, u.id))!;
  return ok({ candidate: candidateView(fresh, await instructorAssignments(c.db, u.id)) });
});
