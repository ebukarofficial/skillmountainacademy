// Instructor capacity and one-on-one assignment checks (Expansion Stage C).
//
// Every student is assigned individually to one instructor per enrolment; there are no cohorts or groups. Before a
// student is given (or moved to) an instructor the server checks, in this order:
//   1 the instructor exists            2 approved and active            3 eligible for the programme (instructor_programmes)
//   4 the programme is published (for a NEW assignment; existing students keep continuity if it is paused or retired)
//   5 capacity                          6 the enrolment is current       7 no duplicate or conflicting relationship
// Capacity is computed here from the database, never taken from the browser.
//
// CAPACITY POLICY (owner decision D-11, still OPEN). The existing behaviour is kept: each instructor's limit for a
// programme is their own max_students, else the programme's default_instructor_cap (30 unless changed). Going over it
// is a WARNING, not a block, exactly as before. The owner can record the approved policy later (standard and maximum
// per instructor) and switch enforcement on; until then nothing new is enforced. The 20 / 30 proposal is used only to
// label the exception report, and is shown as a proposal.
import { ApiError, nowIso } from "../http";
import { getSetting as getAppSetting, putSetting as putAppSetting } from "./data/engagement";
import { getUser, isApproved } from "./data/users";
import { allEligibility, assignedEnrolments, currentEnrolmentsFor, eligibility, getSetting, instructorsWithWork, loadOf, allSettings } from "./data/admissions";
import { lifecycleOf, lifecycles } from "../catalogue";
import { programmeName } from "../../../lib/config.ts";
import { DEFAULT_SETTING } from "../../../lib/admissions.ts";

type DB = D1Database;

export const PROPOSED_D11 = { standardPerInstructor: 20, maximumPerInstructor: 30, status: "proposal, not approved by the owner" } as const;

export type CapacityPolicy = {
  status: "not_set" | "pending_approval" | "approved";
  standardPerInstructor: number | null; // students per instructor (all programmes) before an exception would be needed
  maximumPerInstructor: number | null;  // absolute limit per instructor (all programmes)
  enforce: boolean;                     // only when status = approved; off = warnings only (current behaviour)
  updatedAt: string | null; updatedBy: string | null;
};
export const DEFAULT_POLICY: CapacityPolicy = { status: "not_set", standardPerInstructor: null, maximumPerInstructor: null, enforce: false, updatedAt: null, updatedBy: null };
const POLICY_KEY = "capacity_policy";

export async function getCapacityPolicy(db: DB): Promise<CapacityPolicy> {
  const v = await getAppSetting<Partial<CapacityPolicy>>(db, POLICY_KEY).catch(() => null);
  const p = { ...DEFAULT_POLICY, ...(v ?? {}) };
  return { ...p, enforce: p.status === "approved" && p.enforce === true };
}
export async function saveCapacityPolicy(db: DB, p: CapacityPolicy, by: string) {
  await putAppSetting(db, POLICY_KEY, { ...p, updatedAt: nowIso(), updatedBy: by }, by, nowIso());
}

export type Issue = { code: string; message: string };
export type AssignmentCheck = {
  ok: boolean; blocks: Issue[]; warnings: Issue[];
  capacity: { programmeLoad: number; programmeLimit: number; limitSource: "instructor" | "programme_default"; totalLoad: number; available: number } | null;
};

// The single server-side decision used by every assignment path (new enrolment, change of instructor, admin admission).
export async function checkAssignment(db: DB, a: { instructorId: string; programme: string; studentId: string; enrolmentId?: string | null; previousInstructorId?: string | null; enrolmentStatus?: string | null }): Promise<AssignmentCheck> {
  const blocks: Issue[] = [], warnings: Issue[] = [];
  const reassign = !!a.previousInstructorId;
  const ins = await getUser(db, a.instructorId);
  if (!ins || ins.role !== "instructor") return { ok: false, blocks: [{ code: "not_instructor", message: "That user is not an instructor." }], warnings, capacity: null };
  if (ins.status !== "active") blocks.push({ code: "inactive", message: `${ins.full_name} is not active (account ${ins.status}).` });
  if (!isApproved(ins)) blocks.push({ code: "not_approved", message: `${ins.full_name} is not approved. Approve them in Recruitment first.` });
  const elig = await eligibility(db, ins.id, a.programme);
  if (!elig) blocks.push({ code: "not_eligible", message: `${ins.full_name} is not approved to teach ${programmeName(a.programme)}. Add the programme to their teaching assignments first.` });
  const life = await lifecycleOf(db, a.programme);
  if (life && life !== "published") {
    if (reassign) warnings.push({ code: `programme_${life}`, message: `${programmeName(a.programme)} is ${life}; the change is allowed only to keep an existing student taught.` });
    else blocks.push({ code: "programme_unavailable", message: `${programmeName(a.programme)} is ${life} and is not taking new students.` });
  }
  if (a.enrolmentStatus && !["active", "paused"].includes(a.enrolmentStatus)) blocks.push({ code: "enrolment_not_current", message: `This enrolment is ${a.enrolmentStatus}; instructors are assigned to current enrolments only.` });
  const current = await currentEnrolmentsFor(db, a.studentId, a.programme);
  const others = current.filter((e) => e.id !== a.enrolmentId);
  if (others.some((e) => e.instructor_id)) blocks.push({ code: "duplicate", message: "The student already has another current enrolment with an instructor for this programme. Resolve the duplicate first." });
  if (a.previousInstructorId && a.previousInstructorId === ins.id) warnings.push({ code: "unchanged", message: "This is already the student's instructor." });

  // Capacity (existing rules: active and paused students count; completed and withdrawn are history).
  const loads = await loadOf(db, ins.id);
  const setting = await getSetting(db, a.programme).catch(() => null);
  const programmeLimit = elig?.max_students ?? setting?.default_instructor_cap ?? DEFAULT_SETTING.default_instructor_cap;
  const moving = a.previousInstructorId === ins.id ? 0 : 1;
  const programmeLoad = loads.find((l) => l.programme_slug === a.programme)?.n ?? 0;
  const totalLoad = loads.reduce((n, l) => n + l.n, 0);
  const policy = await getCapacityPolicy(db);
  const over = programmeLoad + moving > programmeLimit;
  if (over) (policy.enforce ? blocks : warnings).push({ code: "over_capacity", message: `${ins.full_name} would have ${programmeLoad + moving} students on this programme; their limit is ${programmeLimit}.` });
  if (policy.maximumPerInstructor !== null && totalLoad + moving > policy.maximumPerInstructor)
    (policy.enforce ? blocks : warnings).push({ code: "over_maximum", message: `${ins.full_name} would have ${totalLoad + moving} students in total; the ${policy.status === "approved" ? "approved" : "pending"} maximum is ${policy.maximumPerInstructor}.` });
  else if (policy.standardPerInstructor !== null && totalLoad + moving > policy.standardPerInstructor)
    warnings.push({ code: "over_standard", message: `${ins.full_name} would have ${totalLoad + moving} students in total, above the ${policy.status === "approved" ? "approved" : "pending"} standard of ${policy.standardPerInstructor}. The exception rule is an open owner decision (D-11).` });
  return { ok: blocks.length === 0, blocks, warnings, capacity: { programmeLoad, programmeLimit, limitSource: elig?.max_students != null ? "instructor" : "programme_default", totalLoad, available: Math.max(0, programmeLimit - programmeLoad) } };
}

export async function requireAssignmentAllowed(db: DB, a: Parameters<typeof checkAssignment>[1]) {
  const r = await checkAssignment(db, a);
  if (!r.ok) throw new ApiError(409, r.blocks[0].code, r.blocks.map((b) => b.message).join(" "));
  return r;
}

// ---------- capacity report and read-only exception analysis ----------
const CURRENT = new Set(["active", "paused"]);
export async function capacityReport(db: DB) {
  const [instructors, elig, enrolments, settings, policy, life] = await Promise.all([instructorsWithWork(db), allEligibility(db), assignedEnrolments(db), allSettings(db), getCapacityPolicy(db), lifecycles(db)]);
  const defaultCap = (slug: string) => settings.find((s) => s.programme_slug === slug)?.default_instructor_cap ?? DEFAULT_SETTING.default_instructor_cap;
  const rows = instructors.map((u) => {
    const mine = enrolments.filter((e) => e.instructor_id === u.id);
    const current = mine.filter((e) => CURRENT.has(e.status));
    const slugs = [...new Set([...elig.filter((x) => x.instructor_id === u.id).map((x) => x.programme_slug), ...current.map((e) => e.programme_slug)])];
    const programmes = slugs.map((slug) => {
      const el = elig.find((x) => x.instructor_id === u.id && x.programme_slug === slug);
      const limit = el ? el.max_students ?? defaultCap(slug) : null;
      const active = current.filter((e) => e.programme_slug === slug).length;
      return { slug, name: programmeName(slug), lifecycle: life?.get(slug) ?? "published", eligible: !!el, maxStudents: el?.max_students ?? null, limit,
        active, utilisation: limit ? Math.round((active / limit) * 100) : null, available: limit === null ? 0 : Math.max(0, limit - active), atCapacity: limit !== null && active >= limit, overLimit: limit !== null && active > limit };
    });
    const total = current.length;
    const approvedActive = u.status === "active" && isApproved({ verification: u.verification ?? undefined });
    return {
      id: u.id, name: u.full_name, email: u.email, status: u.status, verification: u.verification ?? "approved", approvedActive, programmes,
      activeStudents: total, historicalStudents: mine.length - total,
      flags: {
        atCapacity: programmes.some((p) => p.atCapacity), overConfigured: programmes.some((p) => p.overLimit),
        overProposedStandard: total > PROPOSED_D11.standardPerInstructor, overPolicyStandard: policy.standardPerInstructor !== null && total > policy.standardPerInstructor,
        inactiveWithStudents: !approvedActive && total > 0,
      },
    };
  });
  return { policy, proposal: PROPOSED_D11, instructors: rows.filter((r) => r.programmes.length || r.activeStudents || r.historicalStudents || r.approvedActive) };
}

export async function capacityExceptions(db: DB) {
  const [{ instructors }, elig, enrolments] = await Promise.all([capacityReport(db), allEligibility(db), assignedEnrolments(db)]);
  const current = enrolments.filter((e) => CURRENT.has(e.status));
  const byKey = new Map<string, typeof current>();
  for (const e of current) byKey.set(`${e.student_id}|${e.programme_slug}`, [...(byKey.get(`${e.student_id}|${e.programme_slug}`) ?? []), e]);
  const dupes = [...byKey.values()].filter((g) => g.length > 1);
  const list = <T,>(items: T[]) => ({ count: items.length, items });
  return {
    generatedAt: nowIso(), readOnly: true,
    aboveProposedStandard: list(instructors.filter((i) => i.flags.overProposedStandard).map((i) => ({ instructorId: i.id, name: i.name, activeStudents: i.activeStudents, threshold: PROPOSED_D11.standardPerInstructor }))),
    aboveConfiguredMaximum: list(instructors.flatMap((i) => i.programmes.filter((p) => p.overLimit).map((p) => ({ instructorId: i.id, name: i.name, programme: p.slug, active: p.active, limit: p.limit })))),
    assignedWithoutEligibility: list(current.filter((e) => e.instructor_id && !elig.some((x) => x.instructor_id === e.instructor_id && x.programme_slug === e.programme_slug))
      .map((e) => ({ enrolmentId: e.id, studentId: e.student_id, instructorId: e.instructor_id, programme: e.programme_slug }))),
    assignedToUnapprovedOrInactive: list(instructors.filter((i) => i.flags.inactiveWithStudents).map((i) => ({ instructorId: i.id, name: i.name, status: i.status, verification: i.verification, activeStudents: i.activeStudents }))),
    multipleCurrentEnrolmentsSameProgramme: list(dupes.map((g) => ({ studentId: g[0].student_id, programme: g[0].programme_slug, enrolmentIds: g.map((e) => e.id), instructorIds: g.map((e) => e.instructor_id) }))),
    awaitingInstructor: list(current.filter((e) => !e.instructor_id && e.status === "active").map((e) => ({ enrolmentId: e.id, studentId: e.student_id, programme: e.programme_slug }))),
    // instructor_programmes has a (instructor, programme) primary key, so duplicate eligibility rows cannot exist; duplicate
    // student-instructor relationships show up as multipleCurrentEnrolmentsSameProgramme.
    duplicateEligibilityRecords: list([] as unknown[]),
  };
}
