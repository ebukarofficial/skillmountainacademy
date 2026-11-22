// LMS 3: materials, assignments + uploads, quizzes/assessments, grades, lesson progress, progress summary.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker } from "./worker-harness.ts";
import { setup, signIn, type Session } from "./lms-helpers.ts";
import { checkUpload, DOC_TYPES, MAX_FILE_MB, MAX_PHOTO_MB, PHOTO_TYPES } from "../src/server/lms/upload-rules.ts";

let w: Awaited<ReturnType<typeof startWorker>>;
let admin: Session, ins: Session, insB: Session, stu: Session, stuB: Session;
const ids: Record<string, string> = {};
const future = (days: number) => new Date(Date.now() + days * 86400_000).toISOString();
const upload = (s: Session, path: string, name: string, body: string | Uint8Array, type = "application/pdf") =>
  w.fetchApi(`${path}?name=${encodeURIComponent(name)}`, { method: "PUT", headers: { cookie: s.cookie, origin: "https://skillmountainacademy.com", "content-type": type, "content-length": String(typeof body === "string" ? body.length : body.byteLength) }, body });

before(async () => {
  w = await startWorker();
  const s = await setup(w);
  admin = s.admin;
  ids.ins = await s.make("instructor", "i3@example.com", "Ifeoma Instructor");
  ids.insB = await s.make("instructor", "i3b@example.com", "Other Instructor");
  ids.stu = await s.make("student", "s3@example.com", "Segun Student");
  ids.stuB = await s.make("student", "s3b@example.com", "Other Student");
  [ins, insB, stu, stuB] = await Promise.all(["i3", "i3b", "s3", "s3b"].map((n) => signIn(w, `${n}@example.com`)));
  ids.en = (await admin.json<{ enrolment: { id: string } }>("POST", "/api/app/admin/enrolments", { studentId: ids.stu, programme: "webdev", instructorId: ids.ins })).enrolment.id;
  await admin.json("POST", "/api/app/admin/enrolments", { studentId: ids.stuB, programme: "graphics", instructorId: ids.insB });
});
after(async () => { await w.dispose(); });

test("materials: admin adds approved ones; instructor additions need approval; students see only their programme's approved items", async () => {
  const a = await admin.json<{ resource: { id: string; approved: boolean } }>("POST", "/api/app/resources", { programme: "webdev", kind: "link", title: "MDN HTML guide", url: "https://developer.mozilla.org/" });
  assert.equal(a.resource.approved, true);
  const i = await ins.json<{ resource: { id: string; approved: boolean } }>("POST", "/api/app/resources", { programme: "webdev", kind: "document", title: "Week 1 notes", textContent: "Semantic HTML uses elements like header, nav and main." });
  assert.equal(i.resource.approved, false);
  assert.equal((await ins.send("POST", "/api/app/resources", { programme: "graphics", title: "x" })).status, 400, "only their own programmes");
  assert.equal((await ins.send("POST", "/api/app/resources", { programme: "webdev", title: "Bad", url: "javascript:alert(1)" })).status, 400);
  let list = await stu.json<{ resources: { title: string }[] }>("GET", "/api/app/resources");
  assert.deepEqual(list.resources.map((r) => r.title), ["MDN HTML guide"]);
  assert.equal((await stu.get(`/api/app/files/resource/${i.resource.id}`)).status, 404, "unapproved is invisible to students");
  assert.equal((await ins.send("PATCH", `/api/app/resources/${i.resource.id}`, { approved: true })).status, 400, "instructors cannot self-approve");
  await admin.json("PATCH", `/api/app/resources/${i.resource.id}`, { approved: true });
  list = await stu.json("GET", "/api/app/resources");
  assert.equal(list.resources.length, 2);
  assert.equal((await stuB.json<{ resources: unknown[] }>("GET", "/api/app/resources")).resources.length, 0, "other programmes' students see nothing");
  const chunks = await (await w.db()).prepare("SELECT COUNT(*) AS n FROM resource_chunks WHERE resource_id = ?").bind(i.resource.id).first<{ n: number }>();
  assert.equal(chunks?.n, 1, "approved text is indexed for the AI assistant");
  const up = await upload(ins, `/api/app/resources/${i.resource.id}/file`, "week1.pdf", "%PDF-1.4 test");
  assert.equal(up.status, 200, await up.clone().text());
  const dl = await stu.get(`/api/app/files/resource/${i.resource.id}`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get("content-disposition")!, /^attachment; filename="week1.pdf"/);
  assert.equal(dl.headers.get("x-content-type-options"), "nosniff");
  assert.match(dl.headers.get("content-security-policy")!, /sandbox/);
  assert.equal(await dl.text(), "%PDF-1.4 test");
  assert.equal((await upload(ins, `/api/app/resources/${i.resource.id}/file`, "evil.html", "<script>")).status, 400, "HTML uploads refused");
  assert.equal((await upload(ins, `/api/app/resources/${i.resource.id}/file`, "evil.svg", "<svg/>")).status, 400, "SVG refused");
});

test("assignments: instructor sets work for their own student only; student submits text and a file; instructor grades", async () => {
  assert.equal((await insB.send("POST", "/api/app/instructor/assignments", { studentId: ids.stu, title: "x", dueAt: future(2) })).status, 403);
  const a = await ins.json<{ assignment: { id: string; status: string } }>("POST", "/api/app/instructor/assignments", { studentId: ids.stu, title: "Build a landing page", description: "Use semantic HTML", dueAt: future(2), maxScore: 20 });
  assert.equal(a.assignment.status, "pending");
  ids.a = a.assignment.id;
  assert.ok(await w.waitFor((c) => c.some((x) => x.body.includes("s3@example.com") && x.body.includes("New assignment"))));
  const week = await stu.json<{ assignments: { id: string }[] }>("GET", "/api/app/student/assignments");
  assert.ok(week.assignments.some((x) => x.id === ids.a), "due this week (or later this week)") ;
  assert.equal((await stuB.send("POST", `/api/app/student/assignments/${ids.a}/submission`, { text: "mine" })).status, 404, "not your assignment");
  await stu.json("POST", `/api/app/student/assignments/${ids.a}/submission`, { text: "Here is my page" });
  const f = await upload(stu, `/api/app/student/assignments/${ids.a}/submission/file`, "page.zip", "PK\u0003\u0004zip", "application/zip");
  assert.equal(f.status, 200, await f.clone().text());
  const got = await ins.json<{ assignments: { id: string; status: string; submission: { text: string; fileName: string } }[] }>("GET", `/api/app/instructor/assignments?studentId=${ids.stu}`);
  const mine = got.assignments.find((x) => x.id === ids.a)!;
  assert.deepEqual([mine.status, mine.submission.text, mine.submission.fileName], ["submitted", "Here is my page", "page.zip"]);
  assert.equal((await insB.get(`/api/app/files/submission/${ids.a}`)).status, 404, "other instructors cannot download");
  assert.equal((await ins.get(`/api/app/files/submission/${ids.a}`)).status, 200);
  assert.equal((await ins.send("POST", `/api/app/instructor/assignments/${ids.a}/grade`, { score: 25 })).status, 400, "score above max refused");
  await ins.json("POST", `/api/app/instructor/assignments/${ids.a}/grade`, { score: 17, feedback: "Good structure" });
  assert.equal((await stu.send("POST", `/api/app/student/assignments/${ids.a}/submission`, { text: "change" })).status, 400, "graded work is locked");
  const overdue = await ins.json<{ assignment: { id: string } }>("POST", "/api/app/instructor/assignments", { studentId: ids.stu, title: "Late one", dueAt: new Date(Date.now() - 86400_000 * 9).toISOString() });
  const s = await stu.json<{ assignments: { id: string; status: string }[] }>("GET", "/api/app/student/assignments");
  assert.equal(s.assignments.find((x) => x.id === overdue.assignment.id)?.status, "overdue", "overdue work from earlier weeks stays visible");
});

test("quizzes: answers are never sent before marking; multiple choice is marked automatically; time limit enforced", async () => {
  const q = await ins.json<{ quiz: { id: string; maxScore: number } }>("POST", "/api/app/instructor/quizzes", { studentId: ids.stu, kind: "quiz", title: "HTML basics", durationMin: 10, dueAt: future(3),
    questions: [{ type: "mcq", prompt: "Main landmark?", options: ["<div>", "<main>"], answer: 1, points: 2 }, { type: "mcq", prompt: "Nav element?", options: ["<nav>", "<menu>", "<ul>"], answer: 0, points: 3 }] });
  assert.equal(q.quiz.maxScore, 5);
  const view = await stu.json<{ quiz: { questions: Record<string, unknown>[] } }>("GET", `/api/app/student/quizzes/${q.quiz.id}`);
  assert.ok(view.quiz.questions.every((x) => !("answer" in x)), "no answers in the student's copy");
  assert.equal((await stu.send("POST", `/api/app/student/quizzes/${q.quiz.id}/submit`, { answers: [1, 0] })).status, 400, "must start first");
  await stu.json("POST", `/api/app/student/quizzes/${q.quiz.id}/start`);
  const r = await stu.json<{ quiz: { status: string; score: number; questions: { answer?: number }[] } }>("POST", `/api/app/student/quizzes/${q.quiz.id}/submit`, { answers: [1, 2] });
  assert.deepEqual([r.quiz.status, r.quiz.score], ["graded", 2]);
  assert.equal(r.quiz.questions[0].answer, 1, "answers revealed after marking");
  assert.equal((await stu.send("POST", `/api/app/student/quizzes/${q.quiz.id}/submit`, { answers: [1, 0] })).status, 400, "one attempt");
  const timed = await ins.json<{ quiz: { id: string } }>("POST", "/api/app/instructor/quizzes", { studentId: ids.stu, title: "Speed", durationMin: 1, dueAt: future(1), questions: [{ prompt: "1+1?", options: ["2", "3"], answer: 0 }] });
  await stu.json("POST", `/api/app/student/quizzes/${timed.quiz.id}/start`);
  await (await w.db()).prepare("UPDATE quiz_attempts SET started_at = ? WHERE quiz_id = ?").bind(new Date(Date.now() - 10 * 60_000).toISOString(), timed.quiz.id).run();
  const late = await stu.json<{ late: boolean; quiz: { score: number } }>("POST", `/api/app/student/quizzes/${timed.quiz.id}/submit`, { answers: [0] });
  assert.deepEqual([late.late, late.quiz.score], [true, 0], "past the limit, no answers count");
  assert.equal((await ins.send("POST", "/api/app/instructor/quizzes", { studentId: ids.stu, kind: "quiz", title: "x", dueAt: future(1), questions: [{ type: "text", prompt: "Explain" }] })).status, 400, "quizzes are multiple choice");
});

test("assessments: written answers are marked by the instructor", async () => {
  const a = await ins.json<{ quiz: { id: string } }>("POST", "/api/app/instructor/quizzes", { studentId: ids.stu, kind: "assessment", title: "Module 1 assessment", dueAt: future(5),
    questions: [{ type: "text", prompt: "Explain the box model", points: 10 }, { type: "mcq", prompt: "CSS stands for?", options: ["Cascading Style Sheets", "Computer Style"], answer: 0, points: 2 }] });
  await stu.json("POST", `/api/app/student/quizzes/${a.quiz.id}/start`);
  const s = await stu.json<{ quiz: { status: string; score: number | null } }>("POST", `/api/app/student/quizzes/${a.quiz.id}/submit`, { answers: ["Content, padding, border, margin", 0] });
  assert.deepEqual([s.quiz.status, s.quiz.score], ["submitted", null]);
  assert.ok(await w.waitFor((c) => c.some((x) => x.body.includes("i3@example.com") && x.body.includes("To mark"))));
  await ins.json("POST", `/api/app/instructor/quizzes/${a.quiz.id}/grade`, { score: 11, feedback: "Clear" });
  const g = await stu.json<{ assignments: unknown[]; quizzes: { kind: string; score: number }[] }>("GET", `/api/app/students/${ids.stu}/grades`);
  assert.ok(g.quizzes.some((q) => q.kind === "assessment" && q.score === 11));
  assert.equal(g.assignments.length, 1);
  assert.equal((await stuB.get(`/api/app/students/${ids.stu}/grades`)).status, 403, "students cannot see each other's grades");
  assert.equal((await insB.get(`/api/app/students/${ids.stu}/grades`)).status, 403, "unassigned instructors cannot either");
});

test("progress: lessons, assignments, quizzes, attendance and 'needs attention' flags", async () => {
  const c = await admin.json<{ course: { id: string } }>("POST", "/api/app/admin/courses", { programme: "webdev", title: "HTML" });
  const l1 = await admin.json<{ lesson: { id: string } }>("POST", `/api/app/admin/courses/${c.course.id}/lessons`, { title: "Elements" });
  await admin.json("POST", `/api/app/admin/courses/${c.course.id}/lessons`, { title: "Forms" });
  await stu.json("POST", `/api/app/student/lessons/${l1.lesson.id}/complete`);
  assert.equal((await stuB.send("POST", `/api/app/student/lessons/${l1.lesson.id}/complete`)).status, 404, "not their programme");
  const p = await stu.json<{ progress: { lessons: { pct: number }; assignments: { submitted: number; total: number; overdue: number }; quizzes: { done: number }; overall: number; needsAttention: string[] }[] }>("GET", `/api/app/students/${ids.stu}/progress`);
  const pr = p.progress[0];
  assert.equal(pr.lessons.pct, 50);
  assert.deepEqual([pr.assignments.submitted, pr.assignments.total, pr.assignments.overdue], [1, 2, 1]);
  assert.equal(pr.quizzes.done, 3);
  assert.ok(pr.overall > 0 && pr.overall <= 100);
  assert.ok(pr.needsAttention.some((x) => /overdue assignment/.test(x)));
  const view = await ins.json<{ student: { fullName: string }; progress: unknown[] }>("GET", `/api/app/instructor/students/${ids.stu}`);
  assert.equal(view.student.fullName, "Segun Student");
  assert.equal((await insB.get(`/api/app/instructor/students/${ids.stu}`)).status, 403);
});

test("profile photos: images only, 3 MB max", async () => {
  assert.equal((await upload(stu, "/api/me/photo", "me.pdf", "x")).status, 400);
  // Size limits are checked from Content-Length before anything is read (tested directly; the local test client
  // cannot receive an early 413 while it is still sending a large body).
  const big = checkUpload("me.png", MAX_PHOTO_MB * 1024 * 1024 + 1, PHOTO_TYPES, MAX_PHOTO_MB);
  assert.equal(big.ok ? 0 : big.status, 413);
  const doc = checkUpload("notes.pdf", MAX_FILE_MB * 1024 * 1024 + 1, DOC_TYPES, MAX_FILE_MB);
  assert.equal(doc.ok ? 0 : doc.status, 413);
  assert.equal(checkUpload("../../etc/passwd.pdf", 10, DOC_TYPES, 25).ok && (checkUpload("../../etc/passwd.pdf", 10, DOC_TYPES, 25) as { name: string }).name.includes("/"), false, "no path tricks");
  assert.equal((await upload(stu, "/api/me/photo", "me.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png")).status, 200);
  const me = await stu.json<{ user: { photo: string } }>("GET", "/api/me");
  assert.equal((await ins.get(me.user.photo)).headers.get("content-disposition")?.startsWith("inline"), true);
  assert.equal((await w.fetchApi(me.user.photo)).status, 401, "signed-in users only");
});

test("uploads not set up (no R2): clear 503, typed answers still work", async () => {
  const x = await startWorker({ r2: false });
  try {
    const s = await setup(x);
    const insId = await s.make("instructor", "ix@example.com", "Ix");
    const stuId = await s.make("student", "sx@example.com", "Sx");
    await s.admin.json("POST", "/api/app/admin/enrolments", { studentId: stuId, programme: "cloud", instructorId: insId });
    const i = await signIn(x, "ix@example.com");
    const st = await signIn(x, "sx@example.com");
    const a = await i.json<{ assignment: { id: string } }>("POST", "/api/app/instructor/assignments", { studentId: stuId, title: "T", dueAt: future(1) });
    const r = await x.fetchApi(`/api/app/student/assignments/${a.assignment.id}/submission/file?name=a.pdf`, { method: "PUT", headers: { cookie: st.cookie, origin: "https://skillmountainacademy.com", "content-length": "3" }, body: "abc" });
    assert.equal(r.status, 503);
    assert.match((await r.json() as { message: string }).message, /type your answer instead/);
    assert.equal((await st.send("POST", `/api/app/student/assignments/${a.assignment.id}/submission`, { text: "typed" })).status, 200);
  } finally { await x.dispose(); }
});
