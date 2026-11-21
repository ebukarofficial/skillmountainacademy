// Learning materials, assignments and submissions (with file uploads to R2), quizzes and assessments, grades,
// lesson progress and progress summaries.
import { findProgramme, PROGRAMMES } from "../../../../lib/config.ts";
import { ApiError, nowIso } from "../../http";
import { Checker } from "../../validate";
import { ALL, notFound, ok, page, route, type Ctx } from "../api";
import { assertStudentAccess } from "../access";
import {
  completeLesson, completedLessons, createAssignment, getSubmission, createQuiz, createResource, deleteResource, getAssignment, getAttempt, getQuiz, getResource, gradeAttempt,
  gradeSubmission, listAssignments, listQuizzes, listResources, progressStats, startAttempt, submitAttempt, updateResource, upsertSubmission, uncompleteLesson,
  type Question, type QuizRow, type Resource,
} from "../data/coursework";
import { findEnrolment, instructorEnrolments, studentEnrolments, teaches, type Enrolment } from "../data/enrolments";
import { getLesson } from "../data/teaching";
import { getUser, updateUser, type User } from "../data/users";
import { notify } from "../notify";
import { addDays, lagosDate, lagosText, lagosToIso, weekdayOf } from "../time";
import { studentForInstructor } from "../views";
import { indexResource, removeResourceIndex } from "../ai-index";
import { checkUpload, DOC_TYPES, MAX_FILE_MB, MAX_PHOTO_MB, PHOTO_TYPES } from "../upload-rules";

const progName = (s: string) => findProgramme(s)?.name ?? s;

// ---------- uploads ----------
export { MAX_FILE_MB };

// Streams the request body straight into R2 (no buffering, so large files cost almost no Worker CPU).
export async function putUpload(c: Ctx, prefix: string, types: Record<string, string>, maxMb: number) {
  if (!c.env.BUCKET) throw new ApiError(503, "not_configured", "File uploads are not set up yet. You can type your answer instead, or send the file to your instructor by email.");
  const chk = checkUpload(c.url.searchParams.get("name") || "", Number(c.req.headers.get("content-length") || 0), types, maxMb);
  if (!chk.ok) { await c.req.body?.cancel().catch(() => undefined); throw new ApiError(chk.status, chk.code, chk.message); }
  const { name, type } = chk;
  if (!c.req.body) throw new ApiError(400, "empty", "The file is empty.");
  const key = `${prefix}/${crypto.randomUUID()}-${name}`;
  await c.env.BUCKET.put(key, c.req.body, { httpMetadata: { contentType: type }, customMetadata: { name, by: c.user.id } });
  return { key, name };
}

// Sends a stored file. Always as a download (or an image), with no-sniff and a sandbox so a file can never run as a page.
export async function sendFile(c: Ctx, key: string | null, name: string | null, inline = false) {
  if (!key) throw notFound("That file");
  if (!c.env.BUCKET) throw new ApiError(503, "not_configured", "File storage is not set up yet.");
  const obj = await c.env.BUCKET.get(key);
  if (!obj) throw notFound("That file");
  const type = obj.httpMetadata?.contentType || "application/octet-stream";
  const h = new Headers({ "content-type": type, "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'", "cache-control": "private, max-age=300",
    "content-disposition": `${inline && type.startsWith("image/") ? "inline" : "attachment"}; filename="${(name || "file").replace(/["\\\r\n]/g, "_")}"` });
  if (obj.size) h.set("content-length", String(obj.size));
  return new Response(obj.body, { headers: h });
}

// ---------- helpers ----------
function dueIso(ch: Checker, b: Record<string, unknown>): string {
  if (typeof b.dueAt === "string" && !Number.isNaN(Date.parse(b.dueAt))) return new Date(b.dueAt).toISOString();
  if (typeof b.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)) return lagosToIso(b.dueDate, typeof b.dueTime === "string" && /^\d{2}:\d{2}$/.test(b.dueTime) ? b.dueTime : "23:59");
  ch.errors.push("Give a due date.");
  return "";
}
// The instructor's enrolment for this student (they must teach them).
async function enrolmentFor(c: Ctx, studentId: string, programme?: unknown): Promise<Enrolment> {
  if (!(await teaches(c.db, c.user.id, studentId))) throw new ApiError(403, "forbidden", "This student is not assigned to you.");
  const all = (await studentEnrolments(c.db, studentId)).filter((e) => e.instructor_id === c.user.id && e.status !== "withdrawn");
  const e = programme ? all.find((x) => x.programme_slug === programme) : all[0];
  if (!e) throw new ApiError(400, "invalid", "No matching enrolment for this student.");
  return e;
}
const studentRcp = async (c: Ctx, id: string) => { const u = await getUser(c.db, id); return u ? [{ id: u.id, email: u.email, name: u.full_name }] : []; };

export function assignmentStatus(a: { sub_id: string | null; graded_at: string | null; due_at: string; submitted_at: string | null }) {
  if (a.graded_at) return "graded";
  if (a.sub_id) return a.submitted_at && a.submitted_at > a.due_at ? "submitted_late" : "submitted";
  return Date.parse(a.due_at) < Date.now() ? "overdue" : "pending";
}
const assignmentView = (a: Awaited<ReturnType<typeof getAssignment>> & object) => ({
  id: a.id, title: a.title, description: a.description, dueAt: a.due_at, dueText: lagosText(a.due_at), maxScore: a.max_score, programme: a.programme_slug,
  programmeName: progName(a.programme_slug), status: assignmentStatus(a), studentId: a.student_id, studentName: a.student_name,
  submission: a.sub_id ? { text: a.sub_text, fileName: a.sub_file_name, file: a.sub_file_name ? `/api/app/files/submission/${a.id}` : null, submittedAt: a.submitted_at } : null,
  grade: a.graded_at ? { score: a.score, feedback: a.feedback, gradedAt: a.graded_at } : null,
});

// Quiz questions WITHOUT the answers, for students.
const publicQuestions = (qs: Question[]) => qs.map((q, i) => (q.type === "mcq" ? { n: i, type: q.type, prompt: q.prompt, options: q.options, points: q.points } : { n: i, type: q.type, prompt: q.prompt, points: q.points }));
function quizView(q: QuizRow, viewer: User) {
  const qs = JSON.parse(q.questions) as Question[];
  const status = q.graded_at ? "graded" : q.submitted_at ? "submitted" : q.started_at ? "in_progress" : Date.parse(q.due_at) < Date.now() ? "missed" : "open";
  const reveal = viewer.role !== "student" || !!q.graded_at; // answers shown to students only after marking
  return {
    id: q.id, kind: q.kind, title: q.title, instructions: q.instructions, durationMin: q.duration_min, dueAt: q.due_at, dueText: lagosText(q.due_at), maxScore: q.max_score,
    programme: q.programme_slug, programmeName: progName(q.programme_slug), studentId: q.student_id, studentName: q.student_name, status,
    startedAt: q.started_at, submittedAt: q.submitted_at, score: q.graded_at ? q.score : null, feedback: q.graded_at ? q.feedback : null,
    questions: reveal ? qs : publicQuestions(qs), answers: q.answers && (viewer.role !== "student" || q.submitted_at) ? JSON.parse(q.answers) : null,
  };
}
function readQuestions(ch: Checker, raw: unknown, kind: "quiz" | "assessment"): Question[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) { ch.errors.push("Add between 1 and 50 questions."); return []; }
  return raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const prompt = ch.req(o.prompt, `Question ${i + 1}`, 1000);
    const points = Number.isInteger(o.points) && Number(o.points) > 0 && Number(o.points) <= 100 ? Number(o.points) : 1;
    if (o.type === "text") { if (kind === "quiz") ch.errors.push(`Question ${i + 1}: quizzes are marked automatically, so use multiple choice (or create an assessment).`); return { type: "text" as const, prompt, points }; }
    const options = Array.isArray(o.options) ? o.options.map((x) => String(x ?? "").trim().slice(0, 300)).filter(Boolean) : [];
    if (options.length < 2 || options.length > 6) ch.errors.push(`Question ${i + 1}: give 2 to 6 options.`);
    const answer = Number(o.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) ch.errors.push(`Question ${i + 1}: choose the correct option.`);
    return { type: "mcq" as const, prompt, options, answer, points };
  });
}

// ======================= RESOURCES =======================
const resourceView = (r: Resource) => ({ id: r.id, programme: r.programme_slug, programmeName: progName(r.programme_slug), courseId: r.course_id, title: r.title, kind: r.kind,
  url: r.url, file: r.file_key ? `/api/app/files/resource/${r.id}` : null, fileName: r.file_name, approved: !!r.approved, hasText: !!r.text_content, createdAt: r.created_at });
async function mySlugs(c: Ctx) {
  if (c.user.role === "admin") return PROGRAMMES.map((p) => p.slug);
  if (c.user.role === "instructor") return [...new Set((await instructorEnrolments(c.db, c.user.id)).map((e) => e.programme_slug))];
  return (await studentEnrolments(c.db, c.user.id)).filter((e) => e.status !== "withdrawn").map((e) => e.programme_slug);
}
async function loadResource(c: Ctx, write = false) {
  const r = await getResource(c.db, c.params.id);
  if (!r) throw notFound("That resource");
  const slugs = await mySlugs(c);
  if (!slugs.includes(r.programme_slug) || (c.user.role === "student" && !r.approved)) throw notFound("That resource");
  if (write && c.user.role === "instructor" && r.created_by !== c.user.id) throw new ApiError(403, "forbidden", "Only the instructor who added it, or an admin, can change it.");
  if (write && c.user.role === "student") throw new ApiError(403, "forbidden", "You do not have access to this.");
  return r;
}

route("GET", "/api/app/resources", ALL, async (c) => {
  const slugs = await mySlugs(c);
  const want = c.url.searchParams.get("programme");
  return ok({ resources: (await listResources(c.db, want ? slugs.filter((s) => s === want) : slugs, c.user.role === "student")).map(resourceView) });
});

// Admins add approved materials; instructors add materials for their programmes, which an admin approves before students see them.
route("POST", "/api/app/resources", ["admin", "instructor"], async (c) => {
  const b = await c.body();
  const ch = new Checker();
  const slugs = await mySlugs(c);
  const programme = ch.oneOf(b.programme, slugs, "one of your programmes");
  const kind = ch.oneOf(b.kind ?? "document", ["document", "video", "link", "exercise"] as const, "a type");
  const url = ch.opt(b.url, 500);
  if (url && !/^https:\/\/[^\s<>"]+$/.test(url)) ch.errors.push("Links must start with https://");
  const r: Resource = { id: crypto.randomUUID(), programme_slug: programme, course_id: ch.opt(b.courseId, 64), title: ch.req(b.title, "Title", 200), kind, url,
    file_key: null, file_name: null, text_content: ch.opt(b.textContent, 60_000), approved: c.user.role === "admin" ? 1 : 0, created_by: c.user.id, created_at: nowIso() };
  ch.done();
  await createResource(c.db, r);
  if (r.approved && r.text_content) await indexResource(c.db, r);
  await c.audit("resource.create", "resource", r.id, { programme, approved: !!r.approved });
  return ok({ resource: resourceView(r) }, 201);
});

route("PATCH", "/api/app/resources/:id", ["admin", "instructor"], async (c) => {
  const r = await loadResource(c, true);
  const b = await c.body();
  const ch = new Checker();
  const p: Partial<Resource> = {};
  if (b.title !== undefined) p.title = ch.req(b.title, "Title", 200);
  if (b.textContent !== undefined) p.text_content = ch.opt(b.textContent, 60_000);
  if (b.url !== undefined) { p.url = ch.opt(b.url, 500); if (p.url && !/^https:\/\/[^\s<>"]+$/.test(p.url)) ch.errors.push("Links must start with https://"); }
  if (b.approved !== undefined) { if (c.user.role !== "admin") ch.errors.push("Only an admin can approve materials."); else p.approved = b.approved ? 1 : 0; }
  ch.done();
  await updateResource(c.db, r.id, p);
  const next = { ...r, ...p };
  if (next.approved && next.text_content) await indexResource(c.db, next); else await removeResourceIndex(c.db, r.id);
  await c.audit("resource.update", "resource", r.id, Object.keys(p));
  return ok({ resource: resourceView(next) });
});

route("DELETE", "/api/app/resources/:id", ["admin", "instructor"], async (c) => {
  const r = await loadResource(c, true);
  await deleteResource(c.db, r.id);
  await removeResourceIndex(c.db, r.id);
  if (r.file_key && c.env.BUCKET) await c.env.BUCKET.delete(r.file_key);
  await c.audit("resource.delete", "resource", r.id);
  return ok({});
});

route("PUT", "/api/app/resources/:id/file", ["admin", "instructor"], async (c) => {
  const r = await loadResource(c, true);
  const f = await putUpload(c, `resources/${r.programme_slug}`, DOC_TYPES, MAX_FILE_MB);
  if (r.file_key && c.env.BUCKET) await c.env.BUCKET.delete(r.file_key);
  await updateResource(c.db, r.id, { file_key: f.key, file_name: f.name });
  await c.audit("resource.file", "resource", r.id);
  return ok({ resource: resourceView({ ...r, file_key: f.key, file_name: f.name }) });
});
route("GET", "/api/app/files/resource/:id", ALL, async (c) => { const r = await loadResource(c); return sendFile(c, r.file_key, r.file_name); });

// ======================= ASSIGNMENTS =======================
route("POST", "/api/app/instructor/assignments", ["instructor"], async (c) => {
  const b = await c.body();
  const ch = new Checker();
  const studentId = ch.req(b.studentId, "Student", 64);
  const title = ch.req(b.title, "Title", 200);
  const description = ch.opt(b.description, 5000);
  const maxScore = b.maxScore === undefined ? 100 : ch.int(b.maxScore, 1, 1000, "Maximum score");
  const due = dueIso(ch, b);
  ch.done();
  const e = await enrolmentFor(c, studentId, b.programme);
  const a = { id: crypto.randomUUID(), student_id: studentId, instructor_id: c.user.id, enrolment_id: e.id, title, description, due_at: due, max_score: maxScore, created_at: nowIso() };
  await createAssignment(c.db, a);
  await c.audit("assignment.create", "assignment", a.id, { studentId });
  c.exec.waitUntil(notify(c.env, c.db, await studentRcp(c, studentId), { kind: "assignment.new", title: `New assignment: ${title}`, body: `${progName(e.programme_slug)}. Due ${lagosText(due)}.`, link: "/app/" }));
  return ok({ assignment: assignmentView((await getAssignment(c.db, a.id))!) }, 201);
});

route("GET", "/api/app/instructor/assignments", ["instructor"], async (c) => {
  const studentId = c.url.searchParams.get("studentId") || undefined;
  return ok({ assignments: (await listAssignments(c.db, { instructorId: c.user.id, studentId, limit: 300 })).map(assignmentView) });
});

route("POST", "/api/app/instructor/assignments/:id/grade", ["instructor"], async (c) => {
  const a = await getAssignment(c.db, c.params.id);
  if (!a || a.instructor_id !== c.user.id) throw notFound("That assignment");
  if (!a.sub_id) throw new ApiError(400, "not_submitted", "There is no submission to grade yet.");
  const b = await c.body();
  const ch = new Checker();
  const score = ch.int(b.score, 0, a.max_score, "Score");
  const feedback = ch.opt(b.feedback, 5000);
  ch.done();
  await gradeSubmission(c.db, a.id, score, feedback, c.user.id, nowIso());
  await c.audit("assignment.grade", "assignment", a.id, { score });
  c.exec.waitUntil(notify(c.env, c.db, await studentRcp(c, a.student_id), { kind: "assignment.graded", title: `Graded: ${a.title}`, body: `You scored ${score}/${a.max_score}.${feedback ? ` Feedback: ${feedback.slice(0, 300)}` : ""}`, link: "/app/" }));
  return ok({ assignment: assignmentView((await getAssignment(c.db, a.id))!) });
});

// Students: this week's assignments by default (Monday to Sunday, Lagos), or ?scope=all.
route("GET", "/api/app/student/assignments", ["student"], async (c) => {
  let from: string | undefined, to: string | undefined;
  if (c.url.searchParams.get("scope") !== "all") {
    const today = lagosDate(new Date());
    const monday = addDays(today, -((weekdayOf(today) + 6) % 7));
    from = lagosToIso(monday, "00:00");
    // This week, plus the next two weeks, so work due early next week shows on a Saturday too.
    to = lagosToIso(addDays(today, 15), "00:00");
  }
  const rows = await listAssignments(c.db, { studentId: c.user.id, from, to, limit: 300 });
  // Overdue work from earlier weeks stays visible until it is submitted.
  const older = from ? (await listAssignments(c.db, { studentId: c.user.id, to: from, limit: 100 })).filter((a) => !a.sub_id) : [];
  return ok({ assignments: [...older, ...rows].map(assignmentView) });
});

async function myAssignment(c: Ctx) {
  const a = await getAssignment(c.db, c.params.id);
  if (!a || a.student_id !== c.user.id) throw notFound("That assignment");
  if (a.graded_at) throw new ApiError(400, "graded", "This assignment is already graded.");
  return a;
}
async function afterSubmit(c: Ctx, a: { id: string; title: string; instructor_id: string; student_name: string }) {
  await c.audit("assignment.submit", "assignment", a.id);
  const ins = await getUser(c.db, a.instructor_id);
  if (ins) c.exec.waitUntil(notify(c.env, c.db, [{ id: ins.id, email: ins.email, name: ins.full_name }], { kind: "assignment.submitted", title: `Submitted: ${a.title}`, body: `${a.student_name} submitted "${a.title}".`, link: "/app/" }));
}
route("POST", "/api/app/student/assignments/:id/submission", ["student"], async (c) => {
  const a = await myAssignment(c);
  const ch = new Checker();
  const text = ch.req((await c.body()).text, "Your answer", 20_000);
  ch.done();
  await upsertSubmission(c.db, { assignment_id: a.id, student_id: c.user.id, text, submitted_at: nowIso() });
  await afterSubmit(c, a);
  return ok({ assignment: assignmentView((await getAssignment(c.db, a.id))!) });
});
route("PUT", "/api/app/student/assignments/:id/submission/file", ["student"], async (c) => {
  const a = await myAssignment(c);
  const f = await putUpload(c, `submissions/${a.id}`, DOC_TYPES, MAX_FILE_MB);
  const prev = a.sub_id ? await getSubmission(c.db, a.id) : null;
  await upsertSubmission(c.db, { assignment_id: a.id, student_id: c.user.id, file_key: f.key, file_name: f.name, submitted_at: nowIso() });
  if (prev?.file_key && c.env.BUCKET) await c.env.BUCKET.delete(prev.file_key);
  await afterSubmit(c, a);
  return ok({ assignment: assignmentView((await getAssignment(c.db, a.id))!) });
});
route("GET", "/api/app/files/submission/:id", ALL, async (c) => {
  const a = await getAssignment(c.db, c.params.id);
  if (!a) throw notFound("That file");
  if (!(c.user.role === "admin" || a.student_id === c.user.id || a.instructor_id === c.user.id)) throw notFound("That file");
  const s = await getSubmission(c.db, a.id);
  return sendFile(c, s?.file_key ?? null, s?.file_name ?? null);
});

// ======================= QUIZZES AND ASSESSMENTS =======================
route("POST", "/api/app/instructor/quizzes", ["instructor"], async (c) => {
  const b = await c.body();
  const ch = new Checker();
  const studentId = ch.req(b.studentId, "Student", 64);
  const kind = ch.oneOf(b.kind ?? "quiz", ["quiz", "assessment"] as const, "quiz or assessment");
  const title = ch.req(b.title, "Title", 200);
  const questions = readQuestions(ch, b.questions, kind);
  const due = dueIso(ch, b);
  const duration = b.durationMin === undefined || b.durationMin === null ? null : ch.int(b.durationMin, 1, 300, "Duration (minutes)");
  ch.done();
  const e = await enrolmentFor(c, studentId, b.programme);
  const q = { id: crypto.randomUUID(), student_id: studentId, instructor_id: c.user.id, enrolment_id: e.id, kind, title, instructions: ch.opt(b.instructions, 3000),
    duration_min: duration, due_at: due, questions: JSON.stringify(questions), max_score: questions.reduce((n, x) => n + x.points, 0), created_at: nowIso() };
  await createQuiz(c.db, q);
  await c.audit("quiz.create", "quiz", q.id, { kind, studentId });
  c.exec.waitUntil(notify(c.env, c.db, await studentRcp(c, studentId), { kind: "quiz.new", title: `New ${kind}: ${title}`, body: `${progName(e.programme_slug)}. Due ${lagosText(due)}.${duration ? ` ${duration} minutes once you start.` : ""}`, link: "/app/" }));
  return ok({ quiz: quizView((await getQuiz(c.db, q.id))!, c.user) }, 201);
});
route("GET", "/api/app/instructor/quizzes", ["instructor"], async (c) =>
  ok({ quizzes: (await listQuizzes(c.db, { instructorId: c.user.id, limit: 300 })).filter((q) => !c.url.searchParams.get("studentId") || q.student_id === c.url.searchParams.get("studentId")).map((q) => quizView(q, c.user)) }));
route("POST", "/api/app/instructor/quizzes/:id/grade", ["instructor"], async (c) => {
  const q = await getQuiz(c.db, c.params.id);
  if (!q || q.instructor_id !== c.user.id) throw notFound("That quiz");
  if (!q.submitted_at) throw new ApiError(400, "not_submitted", "The student has not submitted yet.");
  const b = await c.body();
  const ch = new Checker();
  const score = ch.int(b.score, 0, q.max_score, "Score");
  const feedback = ch.opt(b.feedback, 5000);
  ch.done();
  await gradeAttempt(c.db, q.id, score, feedback, c.user.id, nowIso());
  await c.audit("quiz.grade", "quiz", q.id, { score });
  c.exec.waitUntil(notify(c.env, c.db, await studentRcp(c, q.student_id), { kind: "quiz.graded", title: `Marked: ${q.title}`, body: `You scored ${score}/${q.max_score}.`, link: "/app/" }));
  return ok({ quiz: quizView((await getQuiz(c.db, q.id))!, c.user) });
});

route("GET", "/api/app/student/quizzes", ["student"], async (c) => ok({ quizzes: (await listQuizzes(c.db, { studentId: c.user.id, limit: 300 })).map((q) => quizView(q, c.user)) }));
async function myQuiz(c: Ctx) {
  const q = await getQuiz(c.db, c.params.id);
  if (!q || q.student_id !== c.user.id) throw notFound("That quiz");
  return q;
}
route("GET", "/api/app/student/quizzes/:id", ["student"], async (c) => ok({ quiz: quizView(await myQuiz(c), c.user) }));
route("POST", "/api/app/student/quizzes/:id/start", ["student"], async (c) => {
  const q = await myQuiz(c);
  if (!q.started_at && Date.parse(q.due_at) < Date.now()) throw new ApiError(400, "closed", "This quiz is closed.");
  await startAttempt(c.db, { id: crypto.randomUUID(), quiz_id: q.id, student_id: c.user.id, started_at: nowIso(), submitted_at: null, answers: null, score: null, feedback: null, graded_at: null, graded_by: null });
  return ok({ quiz: quizView((await getQuiz(c.db, q.id))!, c.user) });
});
export const GRACE_MIN = 2;
route("POST", "/api/app/student/quizzes/:id/submit", ["student"], async (c) => {
  const q = await myQuiz(c);
  const att = await getAttempt(c.db, q.id);
  if (!att) throw new ApiError(400, "not_started", "Start the quiz first.");
  if (att.submitted_at) throw new ApiError(400, "submitted", "You have already submitted this.");
  const qs = JSON.parse(q.questions) as Question[];
  const raw = (await c.body()).answers;
  const late = q.duration_min ? Date.now() > Date.parse(att.started_at) + (q.duration_min + GRACE_MIN) * 60_000 : false;
  // Past the time limit, the attempt closes with no answers counted.
  const answers = late || !Array.isArray(raw) ? qs.map(() => null) : qs.map((qq, i) => (qq.type === "mcq" ? (Number.isInteger(raw[i]) ? Number(raw[i]) : null) : String(raw[i] ?? "").slice(0, 10_000)));
  const allMcq = qs.every((x) => x.type === "mcq");
  const auto = qs.reduce((n, qq, i) => n + (qq.type === "mcq" && answers[i] === qq.answer ? qq.points : 0), 0);
  const now = nowIso();
  await submitAttempt(c.db, q.id, { answers: JSON.stringify(answers), score: allMcq ? auto : null, submitted_at: now, graded_at: allMcq ? now : null });
  await c.audit("quiz.submit", "quiz", q.id, { late });
  if (!allMcq) {
    const ins = await getUser(c.db, q.instructor_id);
    if (ins) c.exec.waitUntil(notify(c.env, c.db, [{ id: ins.id, email: ins.email, name: ins.full_name }], { kind: "quiz.submitted", title: `To mark: ${q.title}`, body: `${q.student_name} submitted "${q.title}".`, link: "/app/" }));
  }
  return ok({ quiz: quizView((await getQuiz(c.db, q.id))!, c.user), late });
});

// ======================= LESSONS, GRADES, PROGRESS =======================
async function lessonForStudent(c: Ctx, studentId: string) {
  const l = await getLesson(c.db, c.params.id);
  if (!l) throw notFound("That lesson");
  const e = await findEnrolment(c.db, studentId, l.programme_slug);
  if (!e) throw notFound("That lesson");
  return l;
}
route("POST", "/api/app/student/lessons/:id/complete", ["student"], async (c) => { const l = await lessonForStudent(c, c.user.id); await completeLesson(c.db, c.user.id, l.id, nowIso()); return ok({}); });
route("DELETE", "/api/app/student/lessons/:id/complete", ["student"], async (c) => { const l = await lessonForStudent(c, c.user.id); await uncompleteLesson(c.db, c.user.id, l.id); return ok({}); });
// Instructors can tick lessons off for their students (e.g. covered in class).
route("POST", "/api/app/instructor/students/:studentId/lessons/:id/complete", ["instructor"], async (c) => {
  await assertStudentAccess(c.db, c.user, c.params.studentId);
  const l = await lessonForStudent(c, c.params.studentId);
  await completeLesson(c.db, c.params.studentId, l.id, nowIso());
  return ok({});
});

export async function progressFor(db: D1Database, e: Enrolment) {
  const s = (await progressStats(db, e.student_id, e.id, e.programme_slug, nowIso()))!;
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : null);
  const lessons = pct(s.lessons_done, s.lessons_total), assignments = pct(s.assignments_submitted, s.assignments_total), quizzes = pct(s.quizzes_done, s.quizzes_total);
  const parts = [lessons, assignments, quizzes].filter((x): x is number => x !== null);
  const attendance = pct(s.attended, s.attended + s.missed);
  const round = (v: number | null) => (v === null ? null : Math.round(v));
  const attention: string[] = [];
  if (s.assignments_overdue > 0) attention.push(`${s.assignments_overdue} overdue assignment${s.assignments_overdue === 1 ? "" : "s"}`);
  if (s.missed >= 2) attention.push(`${s.missed} missed classes`);
  if (s.assignment_pct !== null && s.assignment_pct < 50) attention.push("assignment scores below 50%");
  if (s.assessment_pct !== null && s.assessment_pct < 50) attention.push("assessment scores below 50%");
  if (e.status === "active" && s.last_class && Date.now() - Date.parse(s.last_class) > 21 * 86400_000) attention.push("no completed class in 3 weeks");
  return {
    enrolmentId: e.id, programme: e.programme_slug, programmeName: progName(e.programme_slug), status: e.status,
    overall: parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 0,
    lessons: { done: s.lessons_done, total: s.lessons_total, pct: lessons },
    assignments: { submitted: s.assignments_submitted, total: s.assignments_total, overdue: s.assignments_overdue, avgScorePct: round(s.assignment_pct), pct: assignments },
    quizzes: { done: s.quizzes_done, total: s.quizzes_total, avgScorePct: round(s.quiz_pct), pct: quizzes },
    assessments: { avgScorePct: round(s.assessment_pct) },
    attendance: { attended: s.attended, missed: s.missed, cancelled: s.cancelled, pct: attendance },
    needsAttention: attention,
  };
}

route("GET", "/api/app/students/:id/progress", ALL, async (c) => {
  await assertStudentAccess(c.db, c.user, c.params.id);
  let ens = (await studentEnrolments(c.db, c.params.id)).filter((e) => e.status !== "withdrawn");
  if (c.user.role === "instructor") ens = ens.filter((e) => e.instructor_id === c.user.id);
  const done = await completedLessons(c.db, c.params.id);
  return ok({ progress: await Promise.all(ens.map((e) => progressFor(c.db, e))), completedLessons: done.map((d) => d.lesson_id) });
});

route("GET", "/api/app/students/:id/grades", ALL, async (c) => {
  await assertStudentAccess(c.db, c.user, c.params.id);
  const ins = c.user.role === "instructor" ? c.user.id : undefined;
  const assignments = (await listAssignments(c.db, { studentId: c.params.id, instructorId: ins, limit: 500 })).filter((a) => a.graded_at);
  const quizzes = (await listQuizzes(c.db, { studentId: c.params.id, instructorId: ins, limit: 500 })).filter((q) => q.graded_at);
  return ok({
    assignments: assignments.map((a) => ({ id: a.id, title: a.title, programme: a.programme_slug, score: a.score, maxScore: a.max_score, feedback: a.feedback, gradedAt: a.graded_at })),
    quizzes: quizzes.map((q) => ({ id: q.id, kind: q.kind, title: q.title, programme: q.programme_slug, score: q.score, maxScore: q.max_score, feedback: q.feedback, gradedAt: q.graded_at })),
  });
});

// Instructor: one student's full picture.
route("GET", "/api/app/instructor/students/:id", ["instructor"], async (c) => {
  await assertStudentAccess(c.db, c.user, c.params.id);
  const u = await getUser(c.db, c.params.id);
  if (!u) throw notFound("That student");
  const ens = (await studentEnrolments(c.db, u.id)).filter((e) => e.instructor_id === c.user.id);
  return ok({ student: studentForInstructor(u), progress: await Promise.all(ens.map((e) => progressFor(c.db, e))) });
});

// ======================= PROFILE PHOTOS =======================
route("PUT", "/api/me/photo", ALL, async (c) => {
  const f = await putUpload(c, `photos/${c.user.id}`, PHOTO_TYPES, MAX_PHOTO_MB);
  if (c.user.photo_key && c.env.BUCKET) await c.env.BUCKET.delete(c.user.photo_key);
  await updateUser(c.db, c.user.id, { photo_key: f.key });
  return ok({ photo: `/api/app/files/photo/${c.user.id}` });
});
// Photos are visible to signed-in users only.
route("GET", "/api/app/files/photo/:id", ALL, async (c) => {
  const u = await getUser(c.db, c.params.id);
  return sendFile(c, u?.photo_key ?? null, "photo", true);
});

// Admin: coursework across the Academy (most recent first), for the Assessments area. Summary fields only: no answers.
route("GET", "/api/app/admin/coursework", ["admin"], async (c) => {
  const limit = page(c.url, 200).limit;
  const [as, qs] = await Promise.all([listAssignments(c.db, { limit: 500 }), listQuizzes(c.db, { limit })]);
  const row = (kind: string, x: { id: string; title: string; due_at: string; max_score: number; programme_slug: string; student_name: string; score: number | null; graded_at: string | null }, status: string) => ({
    id: x.id, kind, title: x.title, studentName: x.student_name, programmeName: progName(x.programme_slug), dueAt: x.due_at, dueText: lagosText(x.due_at), status,
    scorePct: x.graded_at && x.score !== null && x.max_score ? Math.round((x.score / x.max_score) * 100) : null,
  });
  const items = [
    ...as.map((a) => row("assignment", a, assignmentStatus(a))),
    ...qs.map((q) => row(q.kind, q, q.graded_at ? "graded" : q.submitted_at ? "submitted" : q.started_at ? "in_progress" : Date.parse(q.due_at) < Date.now() ? "missed" : "open")),
  ].sort((a, b) => b.dueAt.localeCompare(a.dueAt)).slice(0, limit);
  return ok({ coursework: items });
});
