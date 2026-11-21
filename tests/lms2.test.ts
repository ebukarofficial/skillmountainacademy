// LMS 2: enrolments, fixed timetables vs class records, Meet links, attendance, reminders, notifications, courses.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker } from "./worker-harness.ts";
import { setup, signIn, type Session } from "./lms-helpers.ts";

let w: Awaited<ReturnType<typeof startWorker>>;
let admin: Session, insA: Session, insB: Session, stuA: Session, stuB: Session;
const ids: Record<string, string> = {};
const lagosDate = (d: Date) => new Date(d.getTime() + 3600_000).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const sql = async (q: string, ...a: unknown[]) => (await w.db()).prepare(q).bind(...a).run();
const rows = async <T,>(q: string, ...a: unknown[]) => (await (await w.db()).prepare(q).bind(...a).all<T>()).results;
const tomorrow = () => addDays(lagosDate(new Date()), 1);

before(async () => {
  w = await startWorker();
  const s = await setup(w);
  admin = s.admin;
  ids.insA = await s.make("instructor", "insa@example.com", "Ada Instructor");
  ids.insB = await s.make("instructor", "insb@example.com", "Bola Instructor");
  ids.stuA = await s.make("student", "stua@example.com", "Chidi Student");
  ids.stuB = await s.make("student", "stub@example.com", "Dayo Student");
  [insA, insB, stuA, stuB] = await Promise.all(["insa", "insb", "stua", "stub"].map((n) => signIn(w, `${n}@example.com`)));
  ids.enA = (await admin.json<{ enrolment: { id: string } }>("POST", "/api/app/admin/enrolments", { studentId: ids.stuA, programme: "cloud", instructorId: ids.insA })).enrolment.id;
  ids.enB = (await admin.json<{ enrolment: { id: string } }>("POST", "/api/app/admin/enrolments", { studentId: ids.stuB, programme: "graphics", instructorId: ids.insB })).enrolment.id;
});
after(async () => { await w.dispose(); });

test("admin sets the fixed weekly timetable; 14 days of classes are created at the right Lagos time", async () => {
  const d = tomorrow();
  const r = await admin.json<{ sessionsCreated: number; timetable: { weekday: number; start_time: string } }>("POST", `/api/app/admin/enrolments/${ids.enA}/timetable`, { weekday: weekday(d), startTime: "10:00", durationMin: 45 });
  assert.equal(r.sessionsCreated, 2, "two of that weekday in the next 14 days");
  const s = await rows<{ starts_at: string; ends_at: string; instructor_id: string }>("SELECT * FROM class_sessions WHERE enrolment_id = ? ORDER BY starts_at", ids.enA);
  assert.equal(s[0].starts_at, `${d}T09:00:00.000Z`, "10:00 Lagos = 09:00 UTC");
  assert.equal(s[0].ends_at, `${d}T09:45:00.000Z`);
  assert.equal(s[0].instructor_id, ids.insA);
  await admin.json("POST", `/api/app/admin/enrolments/${ids.enB}/timetable`, { weekday: weekday(d), startTime: "14:00", durationMin: 60 });
  assert.equal((await admin.send("POST", `/api/app/admin/enrolments/${ids.enA}/timetable`, { weekday: 1, startTime: "10:00", durationMin: 30 })).status, 400, "45-60 minutes");
});

test("students and instructors cannot change the timetable", async () => {
  for (const u of [stuA, insA]) assert.equal((await u.send("POST", `/api/app/admin/enrolments/${ids.enA}/timetable`, { weekday: 2, startTime: "09:00" })).status, 403);
});

test("access: each user sees only their own classes", async () => {
  const mine = await insA.json<{ sessions: { id: string; student: { fullName: string } }[] }>("GET", `/api/app/instructor/sessions?to=${addDays(lagosDate(new Date()), 14)}`);
  assert.ok(mine.sessions.length >= 2 && mine.sessions.every((s) => s.student.fullName === "Chidi Student"));
  const other = (await rows<{ id: string }>("SELECT id FROM class_sessions WHERE enrolment_id = ?", ids.enB))[0].id;
  assert.equal((await insA.get(`/api/app/sessions/${other}`)).status, 403, "instructor A cannot open B's class");
  assert.equal((await stuA.get(`/api/app/sessions/${other}`)).status, 403, "student A cannot open B's class");
  assert.equal((await insA.send("PUT", `/api/app/instructor/sessions/${other}/meet`, { url: "https://meet.google.com/abc-defg-hij" })).status, 403);
  const stu = await stuA.json<{ sessions: { student?: unknown; notes: unknown }[] }>("GET", "/api/app/student/sessions");
  assert.ok(stu.sessions.length >= 1 && stu.sessions.every((s) => s.student === undefined && s.notes === null));
});

test("Meet links: instructor adds a real Meet link; the student is notified by dashboard and email; replacing re-notifies", async () => {
  const sid = (await rows<{ id: string }>("SELECT id FROM class_sessions WHERE enrolment_id = ? ORDER BY starts_at", ids.enA))[0].id;
  assert.equal((await insA.send("PUT", `/api/app/instructor/sessions/${sid}/meet`, { url: "https://zoom.us/j/123" })).status, 400);
  assert.equal((await insA.send("PUT", `/api/app/instructor/sessions/${sid}/meet`, { url: "javascript:alert(1)" })).status, 400);
  const before = w.calls.length;
  const r = await insA.json<{ session: { meetUrl: string; meetStatus: string } }>("PUT", `/api/app/instructor/sessions/${sid}/meet`, { url: "https://meet.google.com/abc-defg-hij" });
  assert.deepEqual([r.session.meetUrl, r.session.meetStatus], ["https://meet.google.com/abc-defg-hij", "added"]);
  assert.ok(await w.waitFor((c) => c.slice(before).some((x) => x.url.includes("api.resend.com") && x.body.includes("stua@example.com") && x.body.includes("class link is ready"))));
  const n = await stuA.json<{ notifications: { kind: string }[]; unread: number }>("GET", "/api/app/notifications");
  assert.ok(n.notifications.some((x) => x.kind === "meet.link") && n.unread >= 1);
  const s = await stuA.json<{ session: { meetUrl: string } }>("GET", `/api/app/sessions/${sid}`);
  assert.equal(s.session.meetUrl, "https://meet.google.com/abc-defg-hij");
  await insA.json("PUT", `/api/app/instructor/sessions/${sid}/meet`, { url: "https://meet.google.com/xyz-abcd-efg" });
  assert.ok(await w.waitFor((c) => c.some((x) => x.body.includes("stua@example.com") && x.body.includes("class link has changed"))));
  const me = await insA.json<{ session: { meetNotifiedAt: string } }>("GET", `/api/app/sessions/${sid}`);
  assert.ok(me.session.meetNotifiedAt, "instructor can see the student was notified");
});

test("attendance: outcomes are recorded per class and NEVER change the weekly timetable", async () => {
  const [tt] = await rows<Record<string, unknown>>("SELECT * FROM timetables WHERE enrolment_id = ? AND effective_to IS NULL", ids.enA);
  const [s1, s2] = await rows<{ id: string }>("SELECT id FROM class_sessions WHERE enrolment_id = ? ORDER BY starts_at", ids.enA);
  assert.equal((await insA.send("POST", `/api/app/instructor/sessions/${s1.id}/outcome`, { status: "completed" })).status, 400, "not started yet");
  await sql("UPDATE class_sessions SET starts_at = ?, ends_at = ? WHERE id = ?", new Date(Date.now() - 2 * 3600_000).toISOString(), new Date(Date.now() - 3600_000).toISOString(), s1.id);
  const pend = await insA.json<{ pendingOutcomes: { id: string }[] }>("GET", "/api/app/instructor/sessions");
  assert.ok(pend.pendingOutcomes.some((p) => p.id === s1.id), "ended class shows as attendance to record");
  const r = await insA.json<{ session: { status: string } }>("POST", `/api/app/instructor/sessions/${s1.id}/outcome`, { status: "completed", notes: "Covered VPCs" });
  assert.equal(r.session.status, "completed");
  await insA.json("POST", `/api/app/instructor/sessions/${s2.id}/outcome`, { status: "cancelled" });
  assert.equal((await insA.send("POST", `/api/app/instructor/sessions/${s2.id}/outcome`, { status: "rescheduled" })).status, 400, "rescheduling is admin-only");
  const [after] = await rows<Record<string, unknown>>("SELECT * FROM timetables WHERE enrolment_id = ? AND effective_to IS NULL", ids.enA);
  assert.deepEqual(after, tt, "timetable untouched");
  assert.equal((await rows("SELECT id FROM class_sessions WHERE enrolment_id = ?", ids.enA)).length, 2, "records kept");
});

test("admin moves one class: original marked rescheduled, a one-off class is created, timetable unchanged", async () => {
  const [s] = await rows<{ id: string }>("SELECT id FROM class_sessions WHERE enrolment_id = ? AND status = 'scheduled'", ids.enB);
  const tt = await rows("SELECT * FROM timetables WHERE enrolment_id = ?", ids.enB);
  const r = await admin.json<{ session: { id: string; recurring: boolean } }>("POST", `/api/app/admin/sessions/${s.id}/reschedule`, { date: addDays(lagosDate(new Date()), 3), startTime: "16:00", reason: "Public holiday" });
  assert.equal(r.session.recurring, false);
  const [orig] = await rows<{ status: string; rescheduled_to: string }>("SELECT * FROM class_sessions WHERE id = ?", s.id);
  assert.deepEqual([orig.status, orig.rescheduled_to], ["rescheduled", r.session.id]);
  assert.deepEqual(await rows("SELECT * FROM timetables WHERE enrolment_id = ?", ids.enB), tt);
  assert.ok(await w.waitFor((c) => c.some((x) => x.body.includes("stub@example.com") && x.body.includes("class has been moved"))));
});

test("admin changes the weekly slot: history kept, future unrecorded classes replaced, past records intact", async () => {
  const from = addDays(lagosDate(new Date()), 2);
  await admin.json("POST", `/api/app/admin/enrolments/${ids.enA}/timetable`, { weekday: weekday(addDays(from, 1)), startTime: "18:30", durationMin: 60, effectiveFrom: from });
  const hist = await admin.json<{ timetables: { effective_to: string | null; start_time: string }[] }>("GET", `/api/app/admin/enrolments/${ids.enA}/timetable`);
  assert.equal(hist.timetables.length, 2);
  assert.equal(hist.timetables[1].effective_to, addDays(from, -1));
  const all = await rows<{ status: string; starts_at: string }>("SELECT status, starts_at FROM class_sessions WHERE enrolment_id = ? ORDER BY starts_at", ids.enA);
  assert.ok(all.some((x) => x.status === "completed") && all.some((x) => x.status === "cancelled"), "recorded classes kept");
  assert.ok(all.filter((x) => x.status === "scheduled").every((x) => x.starts_at.endsWith("T17:30:00.000Z")), "future classes follow the new slot");
});

test("reminders: 24 h, 1 h, 15 min to student and instructor, once each; missing link flagged, never invented", async () => {
  const worker = await w.mf.getWorker();
  let T = new Date(Date.now() + 60_000);
  if (T.getUTCMinutes() < 5) T = new Date(T.getTime() + 6 * 60_000);
  if (T.getUTCHours() === 5) T = new Date(T.getTime() + 3600_000);
  const at = (min: number) => new Date(T.getTime() + min * 60_000).toISOString();
  const create = async (min: number, meet: string | null) => {
    const id = crypto.randomUUID();
    await sql(`INSERT INTO class_sessions (id, enrolment_id, timetable_id, student_id, instructor_id, starts_at, ends_at, meet_url, status, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'scheduled', ?)`,
      id, ids.enB, ids.stuB, ids.insB, at(min), at(min + 45), meet, new Date().toISOString());
    return id;
  };
  const in20h = await create(20 * 60, null);
  const in50m = await create(50, null);
  const in10m = await create(10, "https://meet.google.com/qwe-rtyu-iop");
  const before = w.calls.length;
  await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: T });
  await w.waitFor((c) => c.slice(before).filter((x) => x.url.includes("api.resend.com")).length >= 7);
  const mails = w.calls.slice(before).filter((x) => x.url.includes("api.resend.com")).map((x) => JSON.parse(x.body));
  const to = (who: string, subj: RegExp) => mails.filter((m) => m.to[0] === who && subj.test(m.subject));
  assert.equal(to("stub@example.com", /^Tomorrow/).length, 1);
  assert.equal(to("insb@example.com", /^Tomorrow/).length, 1);
  assert.equal(to("stub@example.com", /^In 1 hour/).length, 1);
  assert.match(to("stub@example.com", /^In 1 hour/)[0].html, /still pending/, "no fake link");
  assert.equal(to("stub@example.com", /^Starting soon/).length, 1);
  assert.match(to("stub@example.com", /^Starting soon/)[0].html, /Join from your dashboard/);
  assert.ok(to("insb@example.com", /^Add the Meet link/).length >= 1, "instructor told the link is missing");
  for (const m of mails) assert.doesNotMatch(m.html, /meet\.google\.com\/(?!qwe-rtyu-iop)/, "no invented links");
  const flags = await rows<Record<string, string | null>>("SELECT id, reminded_24h_at, reminded_1h_at, reminded_15m_at FROM class_sessions WHERE id IN (?, ?, ?)", in20h, in50m, in10m);
  assert.ok(flags.every((f) => f.reminded_24h_at || f.reminded_1h_at || f.reminded_15m_at));
  const before2 = w.calls.length;
  await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: new Date(T.getTime() + 60_000) });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(w.calls.slice(before2).filter((x) => x.url.includes("api.resend.com") && /stub@example.com/.test(x.body)).length, 0, "not sent twice");
  const ov = await stuB.json<{ nextSession: { joinOpen: boolean; meetUrl: string } }>("GET", "/api/app/student/overview");
  assert.equal(ov.nextSession.meetUrl, "https://meet.google.com/qwe-rtyu-iop");
  // The join window is judged against the real clock; T may have been moved an hour ahead to avoid the 05:00 UTC daily run.
  if (T.getTime() + 10 * 60_000 - Date.now() <= 15 * 60_000) assert.equal(ov.nextSession.joinOpen, true, "Join button opens 15 minutes before");
  else assert.equal(ov.nextSession.joinOpen, false, "not yet open");
});

test("daily run creates upcoming classes once (no duplicates)", async () => {
  const worker = await w.mf.getWorker();
  const n0 = (await rows("SELECT id FROM class_sessions")).length;
  const at5 = new Date(`${lagosDate(new Date())}T05:01:00Z`);
  await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: at5 });
  await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: at5 });
  const dup = await rows<{ n: number }>("SELECT COUNT(*) AS n FROM class_sessions WHERE timetable_id IS NOT NULL GROUP BY timetable_id, starts_at HAVING n > 1");
  assert.equal(dup.length, 0);
  assert.ok((await rows("SELECT id FROM class_sessions")).length >= n0);
});

test("reassigning the instructor moves future classes and clears their Meet links", async () => {
  await admin.json("PATCH", `/api/app/admin/enrolments/${ids.enA}`, { instructorId: ids.insB });
  const fut = await rows<{ instructor_id: string; meet_url: string | null }>("SELECT instructor_id, meet_url FROM class_sessions WHERE enrolment_id = ? AND status = 'scheduled' AND starts_at > ?", ids.enA, new Date().toISOString());
  assert.ok(fut.length > 0 && fut.every((f) => f.instructor_id === ids.insB && f.meet_url === null));
  const past = await rows<{ instructor_id: string }>("SELECT instructor_id FROM class_sessions WHERE enrolment_id = ? AND status = 'completed'", ids.enA);
  assert.ok(past.every((p) => p.instructor_id === ids.insA), "history keeps the original instructor");
  await admin.json("PATCH", `/api/app/admin/enrolments/${ids.enA}`, { instructorId: ids.insA });
});

test("notifications: mark read only affects your own", async () => {
  const mine = await stuA.json<{ notifications: { id: string }[] }>("GET", "/api/app/notifications");
  const theirs = await stuB.json<{ notifications: { id: string }[]; unread: number }>("GET", "/api/app/notifications?unread=1");
  await stuA.json("POST", "/api/app/notifications/read", { ids: theirs.notifications.map((n) => n.id) });
  assert.equal((await stuB.json<{ unread: number }>("GET", "/api/app/notifications")).unread, theirs.unread);
  const r = await stuA.json<{ unread: number }>("POST", "/api/app/notifications/read", { all: true });
  assert.equal(r.unread, 0);
  assert.ok(mine.notifications.length > 0);
});

test("courses: admin builds them; enrolled students and their instructors see them; others do not", async () => {
  const c = await admin.json<{ course: { id: string } }>("POST", "/api/app/admin/courses", { programme: "cloud", title: "Cloud foundations", position: 1 });
  await admin.json("POST", `/api/app/admin/courses/${c.course.id}/lessons`, { title: "What is the cloud?", position: 1 });
  const s = await stuA.json<{ courses: { title: string; lessons: unknown[] }[] }>("GET", "/api/app/programmes/cloud/courses");
  assert.deepEqual([s.courses[0].title, s.courses[0].lessons.length], ["Cloud foundations", 1]);
  assert.equal((await insA.get("/api/app/programmes/cloud/courses")).status, 200);
  assert.equal((await stuB.get("/api/app/programmes/cloud/courses")).status, 404);
  assert.equal((await insB.get("/api/app/programmes/devops/courses")).status, 404);
  assert.equal((await stuA.send("POST", "/api/app/admin/courses", { programme: "cloud", title: "x" })).status, 403);
});
