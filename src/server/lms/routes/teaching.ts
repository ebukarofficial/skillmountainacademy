// Enrolments, the fixed weekly timetable, class sessions, Google Meet links, attendance, courses and notifications.
import { completedLessons } from "../data/coursework";
import { PROGRAMMES, findProgramme } from "../../../../lib/config.ts";
import { ApiError, nowIso } from "../../http";
import { Checker } from "../../validate";
import { ALL, notFound, ok, page, route, type Ctx } from "../api";
import { assertEnrolment, assertSessionAccess } from "../access";
import { createEnrolment, findEnrolment, getEnrolment, instructorEnrolments, listEnrolments, studentEnrolments, updateEnrolment, type Enrolment } from "../data/enrolments";
import {
  createCourse, createLesson, createSessionRow, currentTimetable, getCourse, getSession, listNotifications, listSessions, markRead, pendingOutcomes,
  programmeCourses, programmeLessons, reassignFutureSessions, replaceTimetable, runBatch, sessionsForDateStmt, timetableHistory, unreadCount, updateCourse,
  updateLesson, updateSession, type SessionRow,
} from "../data/teaching";
import { getUser, isApproved, type User } from "../data/users";
import { notify, type Recipient } from "../notify";
import { DAYS, addDays, isDate, isTime, lagosDate, lagosText, lagosToIso, weekdayOf } from "../time";
import { instructorPublic } from "../views";

export const MEET_RE = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?[\w=&-]{0,60})?$/;
const progName = (slug: string) => findProgramme(slug)?.name ?? slug;
const rcp = (u: { id: string; email: string; full_name: string }): Recipient => ({ id: u.id, email: u.email, name: u.full_name });
const JOIN_EARLY_MIN = 15;

// What each role sees of a session. Students and instructors only ever receive their own sessions.
export function sessionView(s: SessionRow, viewer: User) {
  const now = Date.now();
  const joinOpen = !!s.meet_url && s.status === "scheduled" && now >= Date.parse(s.starts_at) - JOIN_EARLY_MIN * 60_000 && now <= Date.parse(s.ends_at);
  return {
    id: s.id, enrolmentId: s.enrolment_id, programme: s.programme_slug, programmeName: progName(s.programme_slug), startsAt: s.starts_at, endsAt: s.ends_at,
    lagosTime: lagosText(s.starts_at), durationMin: Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000), status: s.status,
    meetUrl: s.meet_url, meetStatus: s.meet_url ? "added" : "pending", meetNotifiedAt: s.meet_notified_at, joinOpen, recurring: !!s.timetable_id,
    notes: viewer.role === "student" ? null : s.notes, outcomeAt: s.outcome_at, rescheduledTo: s.rescheduled_to,
    student: viewer.role === "student" ? undefined : { id: s.student_id, fullName: s.student_name, photo: s.student_photo ? `/api/app/files/photo/${s.student_id}` : null },
    instructor: s.instructor_id ? { id: s.instructor_id, fullName: s.instructor_name } : null,
    needsOutcome: s.status === "scheduled" && Date.parse(s.ends_at) <= now,
  };
}

function range(c: Ctx, defDays = 7) {
  const s = c.url.searchParams;
  const today = lagosDate(new Date());
  const from = isDate(s.get("from")) ? s.get("from")! : today;
  const to = isDate(s.get("to")) ? s.get("to")! : addDays(from, defDays);
  if (Date.parse(to) - Date.parse(from) > 62 * 86400_000) throw new ApiError(400, "range", "Please ask for at most 62 days at a time.");
  return { from: lagosToIso(from, "00:00"), to: lagosToIso(to, "00:00") };
}

// Creates the next `days` days of sessions (one statement per day, for every matching enrolment or just one).
export async function generateSessions(db: D1Database, startDate: string, days: number, enrolmentId: string | null = null) {
  const now = nowIso();
  const stmts = Array.from({ length: days }, (_, i) => { const d = addDays(startDate, i); return sessionsForDateStmt(db, d, weekdayOf(d), now, enrolmentId); });
  const res = await runBatch(db, stmts);
  return res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}

async function loadSession(c: Ctx) {
  const s = await getSession(c.db, c.params.id);
  if (!s) throw notFound("That class");
  assertSessionAccess(c.user, s);
  return s;
}
async function people(c: Ctx, s: { student_id: string; instructor_id: string | null }) {
  const st = await getUser(c.db, s.student_id);
  const ins = s.instructor_id ? await getUser(c.db, s.instructor_id) : null;
  return { st, ins };
}

// ======================= ADMIN: enrolments and timetables =======================
route("GET", "/api/app/admin/enrolments", ["admin"], async (c) => {
  const s = c.url.searchParams;
  return ok({ enrolments: await listEnrolments(c.db, { programme: s.get("programme") || undefined, instructorId: s.get("instructorId") || undefined, status: s.get("status") || undefined, ...page(c.url) }) });
});

route("POST", "/api/app/admin/enrolments", ["admin"], async (c) => {
  const b = await c.body();
  const ch = new Checker();
  const studentId = ch.req(b.studentId, "Student", 64);
  const programme = ch.oneOf(b.programme, PROGRAMMES.map((p) => p.slug), "a programme");
  ch.done();
  const st = await getUser(c.db, studentId);
  if (!st || st.role !== "student") throw new ApiError(400, "invalid", "That user is not a student.");
  if (await findEnrolment(c.db, studentId, programme)) throw new ApiError(409, "exists", "This student is already enrolled on this programme.");
  const instructorId = await validInstructor(c, b.instructorId);
  const now = nowIso();
  const e: Enrolment = { id: crypto.randomUUID(), student_id: studentId, programme_slug: programme, instructor_id: instructorId, status: "active", order_id: null, started_at: now, completed_at: null, created_at: now };
  await createEnrolment(c.db, e);
  await c.audit("enrolment.create", "enrolment", e.id, { studentId, programme, instructorId });
  return ok({ enrolment: e }, 201);
});

async function validInstructor(c: Ctx, v: unknown): Promise<string | null> {
  if (v === null || v === undefined || v === "") return null;
  const u = await getUser(c.db, String(v));
  if (!u || u.role !== "instructor" || u.status !== "active") throw new ApiError(400, "invalid", "That user is not an active instructor.");
  if (!isApproved(u)) throw new ApiError(400, "not_approved", "Only approved instructors can be assigned students. Approve them in Recruitment first.");
  return u.id;
}

route("PATCH", "/api/app/admin/enrolments/:id", ["admin"], async (c) => {
  const e = await getEnrolment(c.db, c.params.id);
  if (!e) throw notFound("That enrolment");
  const b = await c.body();
  const patch: Partial<Enrolment> = {};
  if ("instructorId" in b) patch.instructor_id = await validInstructor(c, b.instructorId);
  if (b.status !== undefined) {
    const ch = new Checker();
    patch.status = ch.oneOf(b.status, ["active", "paused", "completed", "withdrawn"] as const, "a status");
    ch.done();
    if (patch.status === "completed") patch.completed_at = nowIso();
  }
  await updateEnrolment(c.db, e.id, patch);
  if ("instructor_id" in patch && patch.instructor_id !== e.instructor_id) {
    await reassignFutureSessions(c.db, e.id, patch.instructor_id ?? null, nowIso());
    const st = await getUser(c.db, e.student_id);
    const ins = patch.instructor_id ? await getUser(c.db, patch.instructor_id) : null;
    if (st && ins) {
      c.exec.waitUntil(notify(c.env, c.db, [rcp(st)], { kind: "instructor.assigned", title: `Your instructor for ${progName(e.programme_slug)}`, body: `${ins.full_name} is now your instructor for ${progName(e.programme_slug)}.`, link: "/app/" }));
      c.exec.waitUntil(notify(c.env, c.db, [rcp(ins)], { kind: "student.assigned", title: `New student: ${st.full_name}`, body: `${st.full_name} (${progName(e.programme_slug)}) has been assigned to you.`, link: "/app/" }));
    }
  }
  if (patch.status === "completed" && e.status !== "completed") {
    const st = await getUser(c.db, e.student_id);
    if (st) c.exec.waitUntil(notify(c.env, c.db, [rcp(st)], { kind: "programme.completed", title: `Congratulations: you have completed ${progName(e.programme_slug)}`,
      body: `The Academy has recorded that you completed ${progName(e.programme_slug)}. Your learning space stays open, with your work, feedback and progress record.`, link: "/app/?tab=progress" }));
  }
  await c.audit("enrolment.update", "enrolment", e.id, patch);
  return ok({ enrolment: await getEnrolment(c.db, e.id) });
});

route("GET", "/api/app/admin/enrolments/:id/timetable", ["admin"], async (c) => ok({ timetables: await timetableHistory(c.db, c.params.id) }));

// Sets or changes the fixed weekly slot. Only admins can do this (the "authorised administrative process").
route("POST", "/api/app/admin/enrolments/:id/timetable", ["admin"], async (c) => {
  const e = await getEnrolment(c.db, c.params.id);
  if (!e) throw notFound("That enrolment");
  if (e.status !== "active") throw new ApiError(400, "inactive", "Only active enrolments can have a timetable.");
  const b = await c.body();
  const ch = new Checker();
  const weekday = ch.int(b.weekday, 0, 6, "Weekday");
  const duration = ch.int(b.durationMin ?? 45, 45, 60, "Class length (minutes)");
  if (!isTime(b.startTime)) ch.errors.push("Start time must be HH:MM (Lagos time).");
  const today = lagosDate(new Date());
  const from = b.effectiveFrom === undefined ? today : String(b.effectiveFrom);
  if (!isDate(from) || from < today) ch.errors.push("The change can start today or later.");
  ch.done();
  const start = String(b.startTime);
  if (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + duration > 24 * 60) throw new ApiError(400, "invalid", "The class must end before midnight.");
  await replaceTimetable(c.db, { id: crypto.randomUUID(), enrolment_id: e.id, weekday, start_time: start, duration_min: duration, effective_from: from, effective_to: null, created_by: c.user.id, created_at: nowIso() },
    addDays(from, -1), lagosToIso(from, "00:00"));
  const created = await generateSessions(c.db, from, 14, e.id);
  await c.audit("timetable.set", "enrolment", e.id, { weekday, start, duration, from });
  const { st, ins } = await people(c, e);
  const text = `${DAYS[weekday]}s at ${start} (Lagos time), ${duration} minutes, from ${from}.`;
  if (st) c.exec.waitUntil(notify(c.env, c.db, [rcp(st), ...(ins ? [rcp(ins)] : [])], { kind: "timetable.set", title: `Weekly class time: ${progName(e.programme_slug)}`, body: `${progName(e.programme_slug)}${ins && st ? ` with ${ins.full_name}` : ""}: ${text}`, link: "/app/" }));
  return ok({ timetable: await currentTimetable(c.db, e.id), sessionsCreated: created }, 201);
});

route("GET", "/api/app/admin/sessions", ["admin"], async (c) => {
  const s = c.url.searchParams;
  const rows = await listSessions(c.db, { instructorId: s.get("instructorId") || undefined, studentId: s.get("studentId") || undefined, status: s.get("status") || undefined, ...range(c), limit: 500 });
  return ok({ sessions: rows.map((r) => sessionView(r, c.user)) });
});

route("GET", "/api/app/admin/sessions/pending-outcomes", ["admin"], async (c) =>
  ok({ sessions: (await pendingOutcomes(c.db, null, nowIso())).map((r) => sessionView(r, c.user)) }));

// One-off extra class (not part of the weekly timetable).
route("POST", "/api/app/admin/sessions", ["admin"], async (c) => {
  const b = await c.body();
  const e = await getEnrolment(c.db, String(b.enrolmentId ?? ""));
  if (!e) throw notFound("That enrolment");
  const ch = new Checker();
  const duration = ch.int(b.durationMin ?? 45, 45, 60, "Class length (minutes)");
  if (!isDate(b.date) || !isTime(b.startTime)) ch.errors.push("Give a date (YYYY-MM-DD) and a start time (HH:MM, Lagos).");
  ch.done();
  const startsAt = lagosToIso(String(b.date), String(b.startTime));
  if (Date.parse(startsAt) < Date.now()) throw new ApiError(400, "past", "The class must be in the future.");
  const id = crypto.randomUUID();
  await createSessionRow(c.db, { id, enrolment_id: e.id, timetable_id: null, student_id: e.student_id, instructor_id: e.instructor_id, starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + duration * 60_000).toISOString(), status: "scheduled", created_at: nowIso() });
  await c.audit("session.create", "session", id, { enrolment: e.id, startsAt });
  return ok({ session: sessionView((await getSession(c.db, id))!, c.user) }, 201);
});

// Moves ONE class. The weekly timetable is not changed.
route("POST", "/api/app/admin/sessions/:id/reschedule", ["admin"], async (c) => {
  const s = await loadSession(c);
  if (s.status !== "scheduled") throw new ApiError(400, "not_scheduled", "Only a scheduled class can be moved.");
  const b = await c.body();
  const ch = new Checker();
  if (!isDate(b.date) || !isTime(b.startTime)) ch.errors.push("Give a date (YYYY-MM-DD) and a start time (HH:MM, Lagos).");
  const duration = ch.int(b.durationMin ?? Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000), 45, 60, "Class length (minutes)");
  ch.done();
  const startsAt = lagosToIso(String(b.date), String(b.startTime));
  if (Date.parse(startsAt) < Date.now()) throw new ApiError(400, "past", "The new time must be in the future.");
  const id = crypto.randomUUID();
  const now = nowIso();
  await createSessionRow(c.db, { id, enrolment_id: s.enrolment_id, timetable_id: null, student_id: s.student_id, instructor_id: s.instructor_id, starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + duration * 60_000).toISOString(), status: "scheduled", created_at: now });
  await updateSession(c.db, s.id, { status: "rescheduled", rescheduled_to: id, outcome_at: now, outcome_by: c.user.id, notes: String(b.reason ?? "").slice(0, 500) || s.notes });
  await c.audit("session.reschedule", "session", s.id, { to: id, startsAt });
  const { st, ins } = await people(c, s);
  if (st) c.exec.waitUntil(notify(c.env, c.db, [rcp(st), ...(ins ? [rcp(ins)] : [])], { kind: "session.rescheduled", title: "A class has been moved", body: `${progName(s.programme_slug)}: the class on ${lagosText(s.starts_at)} is moved to ${lagosText(startsAt)}. Your weekly timetable stays the same.`, link: "/app/" }));
  return ok({ session: sessionView((await getSession(c.db, id))!, c.user) }, 201);
});

// ======================= INSTRUCTOR =======================
route("GET", "/api/app/instructor/sessions", ["instructor"], async (c) => {
  const rows = await listSessions(c.db, { instructorId: c.user.id, ...range(c), limit: 500 });
  return ok({ sessions: rows.map((r) => sessionView(r, c.user)), pendingOutcomes: (await pendingOutcomes(c.db, c.user.id, nowIso())).map((r) => sessionView(r, c.user)) });
});

route("GET", "/api/app/instructor/students", ["instructor"], async (c) => {
  const rows = await instructorEnrolments(c.db, c.user.id);
  return ok({ students: rows.map((r) => ({ enrolmentId: r.id, programme: r.programme_slug, programmeName: progName(r.programme_slug), status: r.status,
    student: { id: r.student_id, fullName: r.full_name, email: r.email, studentNo: r.student_no, photo: r.photo_key ? `/api/app/files/photo/${r.student_id}` : null } })) });
});

// The instructor creates the Meet link in Google Meet and pastes it here. The platform attaches it to this class only
// and tells the student. Replacing a link notifies the student again.
route("PUT", "/api/app/instructor/sessions/:id/meet", ["instructor"], async (c) => {
  const s = await loadSession(c);
  if (s.status !== "scheduled") throw new ApiError(400, "not_scheduled", "This class is no longer scheduled.");
  if (Date.parse(s.ends_at) < Date.now()) throw new ApiError(400, "ended", "This class has already ended.");
  const url = String((await c.body()).url ?? "").trim();
  if (!MEET_RE.test(url)) throw new ApiError(400, "invalid", "Paste a Google Meet link like https://meet.google.com/abc-defg-hij");
  const replaced = !!s.meet_url;
  const now = nowIso();
  await updateSession(c.db, s.id, { meet_url: url, meet_updated_at: now });
  await c.audit(replaced ? "meet.replace" : "meet.add", "session", s.id);
  const st = await getUser(c.db, s.student_id);
  if (st) {
    c.exec.waitUntil(notify(c.env, c.db, [rcp(st)], { kind: "meet.link", title: replaced ? "Your class link has changed" : "Your class link is ready",
      body: `${progName(s.programme_slug)} with ${c.user.full_name}, ${lagosText(s.starts_at)}. Join from your dashboard when it is time.`, link: "/app/" })
      .then(() => updateSession(c.db, s.id, { meet_notified_at: new Date().toISOString() })));
  }
  return ok({ session: sessionView({ ...s, meet_url: url, meet_updated_at: now }, c.user) });
});

// Attendance. completed/missed after the class starts; cancelled any time before it is done.
// Outcomes can be corrected by the instructor for 48 hours. Never changes the weekly timetable.
route("POST", "/api/app/instructor/sessions/:id/outcome", ["instructor"], async (c) => {
  const s = await loadSession(c);
  const b = await c.body();
  const ch = new Checker();
  const status = ch.oneOf(b.status, ["completed", "missed", "cancelled"] as const, "completed, missed or cancelled");
  const notes = ch.opt(b.notes, 1000);
  ch.done();
  if (s.status === "rescheduled") throw new ApiError(400, "rescheduled", "This class was moved; record the outcome on the new class.");
  if (s.status !== "scheduled" && (!s.outcome_at || Date.now() - Date.parse(s.outcome_at) > 48 * 3600_000)) throw new ApiError(400, "locked", "This outcome can no longer be changed. Ask an admin.");
  if (status !== "cancelled" && Date.parse(s.starts_at) > Date.now()) throw new ApiError(400, "not_started", "You can mark attendance once the class has started.");
  await updateSession(c.db, s.id, { status, notes: notes ?? s.notes, outcome_at: nowIso(), outcome_by: c.user.id });
  await c.audit("session.outcome", "session", s.id, { status });
  if (status === "cancelled" || status === "missed") {
    const st = await getUser(c.db, s.student_id);
    if (st) c.exec.waitUntil(notify(c.env, c.db, [rcp(st)], { kind: `session.${status}`, title: status === "cancelled" ? "A class was cancelled" : "You missed a class",
      body: `${progName(s.programme_slug)}, ${lagosText(s.starts_at)}${status === "cancelled" ? " was cancelled." : " was marked as missed."} Your weekly timetable stays the same.`, link: "/app/" }));
  }
  return ok({ session: sessionView((await getSession(c.db, s.id))!, c.user) });
});

// ======================= STUDENT =======================
route("GET", "/api/app/student/sessions", ["student"], async (c) =>
  ok({ sessions: (await listSessions(c.db, { studentId: c.user.id, ...range(c, 28), limit: 200 })).map((r) => sessionView(r, c.user)) }));

route("GET", "/api/app/student/overview", ["student"], async (c) => {
  const enrolments = await studentEnrolments(c.db, c.user.id);
  const out = [];
  for (const e of enrolments) {
    const t = await currentTimetable(c.db, e.id);
    const ins = e.instructor_id ? await getUser(c.db, e.instructor_id) : null;
    out.push({ id: e.id, programme: e.programme_slug, programmeName: progName(e.programme_slug), status: e.status, startedAt: e.started_at,
      instructor: ins ? instructorPublic(ins) : null,
      timetable: t ? { weekday: t.weekday, day: DAYS[t.weekday], startTime: t.start_time, durationMin: t.duration_min, from: t.effective_from } : null });
  }
  const upcoming = await listSessions(c.db, { studentId: c.user.id, from: new Date(Date.now() - 60 * 60_000).toISOString(), to: new Date(Date.now() + 30 * 86400_000).toISOString(), status: "scheduled", limit: 3 });
  return ok({ enrolments: out, nextSession: upcoming.filter((u) => Date.parse(u.ends_at) > Date.now()).map((u) => sessionView(u, c.user))[0] ?? null });
});

// ======================= SHARED =======================
route("GET", "/api/app/sessions/:id", ALL, async (c) => ok({ session: sessionView(await loadSession(c), c.user) }));

route("GET", "/api/app/notifications", ALL, async (c) => {
  const unread = c.url.searchParams.get("unread") === "1";
  return ok({ notifications: await listNotifications(c.db, c.user.id, unread, page(c.url, 100).limit), unread: await unreadCount(c.db, c.user.id) });
});
route("POST", "/api/app/notifications/read", ALL, async (c) => {
  const b = await c.body<{ ids?: unknown; all?: boolean }>();
  const ids = b.all ? "all" : Array.isArray(b.ids) ? b.ids.map(String).filter((x) => /^[\w-]{1,64}$/.test(x)) : [];
  await markRead(c.db, c.user.id, ids, nowIso());
  return ok({ unread: await unreadCount(c.db, c.user.id) });
});

// Courses and lessons of a programme: admins, its students, and its instructors.
route("GET", "/api/app/programmes/:slug/courses", ALL, async (c) => {
  const slug = c.params.slug;
  if (!findProgramme(slug)) throw notFound("That programme");
  if (c.user.role === "student") {
    const e = await findEnrolment(c.db, c.user.id, slug);
    if (!e) throw notFound("That programme");
    assertEnrolment(c.user, e);
  } else if (c.user.role === "instructor") {
    if (!(await instructorEnrolments(c.db, c.user.id)).some((e) => e.programme_slug === slug)) throw notFound("That programme");
  }
  const courses = await programmeCourses(c.db, slug);
  const lessons = await programmeLessons(c.db, slug);
  // A student also sees which lessons they have completed (their own record only).
  const done = c.user.role === "student" ? new Map((await completedLessons(c.db, c.user.id)).map((x) => [x.lesson_id, x.completed_at])) : null;
  return ok({ courses: courses.map((co) => ({ ...co, lessons: lessons.filter((l) => l.course_id === co.id).map((l) => (done ? { ...l, completedAt: done.get(l.id) ?? null } : l)) })) });
});

route("POST", "/api/app/admin/courses", ["admin"], async (c) => {
  const b = await c.body();
  const ch = new Checker();
  const row = { id: crypto.randomUUID(), programme_slug: ch.oneOf(b.programme, PROGRAMMES.map((p) => p.slug), "a programme"), title: ch.req(b.title, "Title", 150),
    description: ch.opt(b.description, 2000), position: Number.isInteger(b.position) ? Number(b.position) : 0, created_at: nowIso() };
  ch.done();
  await createCourse(c.db, row);
  await c.audit("course.create", "course", row.id);
  return ok({ course: row }, 201);
});
route("PATCH", "/api/app/admin/courses/:id", ["admin"], async (c) => {
  if (!(await getCourse(c.db, c.params.id))) throw notFound("That course");
  const b = await c.body();
  const ch = new Checker();
  const p = { title: b.title === undefined ? undefined : ch.req(b.title, "Title", 150), description: b.description === undefined ? undefined : ch.opt(b.description, 2000), position: Number.isInteger(b.position) ? Number(b.position) : undefined };
  ch.done();
  await updateCourse(c.db, c.params.id, p);
  await c.audit("course.update", "course", c.params.id);
  return ok({ course: await getCourse(c.db, c.params.id) });
});
route("POST", "/api/app/admin/courses/:id/lessons", ["admin"], async (c) => {
  if (!(await getCourse(c.db, c.params.id))) throw notFound("That course");
  const b = await c.body();
  const ch = new Checker();
  const row = { id: crypto.randomUUID(), course_id: c.params.id, title: ch.req(b.title, "Title", 150), objectives: ch.opt(b.objectives, 2000), position: Number.isInteger(b.position) ? Number(b.position) : 0, created_at: nowIso() };
  ch.done();
  await createLesson(c.db, row);
  await c.audit("lesson.create", "lesson", row.id);
  return ok({ lesson: row }, 201);
});
route("PATCH", "/api/app/admin/lessons/:id", ["admin"], async (c) => {
  const b = await c.body();
  const ch = new Checker();
  const p = { title: b.title === undefined ? undefined : ch.req(b.title, "Title", 150), objectives: b.objectives === undefined ? undefined : ch.opt(b.objectives, 2000), position: Number.isInteger(b.position) ? Number(b.position) : undefined };
  ch.done();
  if (!(await updateLesson(c.db, c.params.id, p))) throw notFound("That lesson");
  await c.audit("lesson.update", "lesson", c.params.id);
  return ok({});
});

