// Instructor capacity and assignment options (Expansion Stage C).
//   GET /api/app/admin/capacity                    academic: per-instructor workload, limits, utilisation, flags, plus the
//                                                  read-only exception analysis. Nothing is repaired or changed.
//   GET /api/app/admin/assignment-options?programme=&studentId=&enrolmentId=
//                                                  academic: every instructor with the server's verdict for this student
//                                                  (eligible / blocked with reasons / warnings, workload). Advisory only:
//                                                  the assignment itself is checked again when it is submitted.
//   PUT /api/app/owner/capacity-policy             owner (with the authenticator code): record the capacity policy (D-11).
import { ApiError } from "../../http";
import { ok, requireStrongAuth, route } from "../api";
import { Checker } from "../../validate";
import { capacityExceptions, capacityReport, checkAssignment, getCapacityPolicy, saveCapacityPolicy, type CapacityPolicy } from "../capacity";
import { getEnrolment } from "../data/enrolments";
import { instructorsWithWork } from "../data/admissions";

route("GET", "/api/app/admin/capacity", ["admin"], async (c) => {
  const [report, exceptions] = await Promise.all([capacityReport(c.db), capacityExceptions(c.db)]);
  return ok({ ...report, exceptions });
});

route("GET", "/api/app/admin/assignment-options", ["admin"], async (c) => {
  const q = c.url.searchParams;
  const enrolmentId = q.get("enrolmentId");
  const e = enrolmentId ? await getEnrolment(c.db, enrolmentId) : null;
  if (enrolmentId && !e) throw new ApiError(404, "not_found", "That enrolment was not found.");
  const programme = e?.programme_slug ?? q.get("programme") ?? "";
  const studentId = e?.student_id ?? q.get("studentId") ?? "";
  if (!programme) throw new ApiError(400, "invalid", "Choose a programme.");
  const people = (await instructorsWithWork(c.db)).filter((u) => u.status === "active" || u.id === e?.instructor_id);
  const options = await Promise.all(people.map(async (u) => ({ id: u.id, name: u.full_name, current: u.id === e?.instructor_id,
    ...(await checkAssignment(c.db, { instructorId: u.id, programme, studentId: studentId || "new-student", enrolmentId: e?.id ?? null, previousInstructorId: e?.instructor_id ?? null, enrolmentStatus: e?.status ?? null })) })));
  options.sort((a, b) => Number(b.ok) - Number(a.ok) || (a.capacity?.programmeLoad ?? 0) - (b.capacity?.programmeLoad ?? 0) || a.name.localeCompare(b.name));
  return ok({ programme, options, policy: await getCapacityPolicy(c.db), advisory: true });
});

route("PUT", "/api/app/owner/capacity-policy", ["admin"], async (c) => {
  await requireStrongAuth(c, "owner.capacity_policy");
  const b = await c.body();
  const ch = new Checker();
  const status = ch.oneOf(b.status, ["not_set", "pending_approval", "approved"] as const, "a policy status");
  const num = (v: unknown, label: string) => (v === null || v === undefined || v === "" ? null : ch.int(v, 1, 500, label));
  const standard = num(b.standardPerInstructor, "Standard students per instructor");
  const maximum = num(b.maximumPerInstructor, "Maximum students per instructor");
  if (standard !== null && maximum !== null && standard > maximum) ch.errors.push("The standard cannot be above the maximum.");
  if (b.enforce === true && status !== "approved") ch.errors.push("Enforcement can only be switched on for an approved policy.");
  ch.done();
  const before = await getCapacityPolicy(c.db);
  const next: CapacityPolicy = { status, standardPerInstructor: standard, maximumPerInstructor: maximum, enforce: b.enforce === true && status === "approved", updatedAt: null, updatedBy: null };
  await saveCapacityPolicy(c.db, next, c.user.id);
  await c.audit("owner.capacity_policy", "settings", "capacity_policy", { from: before, to: next });
  return ok({ policy: await getCapacityPolicy(c.db) });
});
