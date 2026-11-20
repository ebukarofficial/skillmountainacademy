// LMS 5: the programme-specific AI assistant (Workers AI is mocked; everything else is real).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker } from "./worker-harness.ts";
import { setup, signIn, type Session } from "./lms-helpers.ts";
import { read } from "./helpers.ts";

let w: Awaited<ReturnType<typeof startWorker>>;
let admin: Session, ins: Session, stu: Session, other: Session, insUser: string;
const ids: Record<string, string> = {};
const prompts: { messages: { role: string; content: string }[] }[] = [];

before(async () => {
  w = await startWorker({ ai: true, mock: (req, body) => {
    if (new URL(req.url).host !== "ai.test") return undefined;
    const j = JSON.parse(body);
    prompts.push(j);
    const q = j.messages.at(-1).content as string;
    if (q.includes("FAIL")) return new Response("down", { status: 500 });
    return Response.json({ response: `Here is help with: ${q.slice(0, 40)} [1]` });
  } });
  const s = await setup(w);
  admin = s.admin;
  insUser = await s.make("instructor", "i5@example.com", "Ade Instructor");
  ids.stu = await s.make("student", "s5@example.com", "Kemi Student");
  ids.other = await s.make("student", "s5b@example.com", "No Programme");
  [ins, stu, other] = await Promise.all(["i5", "s5", "s5b"].map((n) => signIn(w, `${n}@example.com`)));
  await admin.json("POST", "/api/app/admin/enrolments", { studentId: ids.stu, programme: "cybersecurity", instructorId: insUser });
  await admin.json("POST", "/api/app/resources", { programme: "cybersecurity", kind: "document", title: "Phishing basics",
    textContent: "Phishing is a social engineering attack. Check the sender domain, hover over links, and never share one-time passwords." });
  await admin.json("POST", "/api/app/resources", { programme: "cloud", kind: "document", title: "Cloud secret notes", textContent: "Phishing in the cloud console is covered here too." });
  await ins.json("POST", "/api/app/instructor/assignments", { studentId: ids.stu, title: "Write a phishing awareness poster", dueAt: new Date(Date.now() + 3 * 86400_000).toISOString() });
});
after(async () => { await w.dispose(); });

test("answers use the student's programme, approved materials found by search, open work and progress; sources returned", async () => {
  const r = await stu.json<{ reply: string; sources: { title: string }[]; remainingToday: number }>("POST", "/api/app/student/assistant", { message: "How do I spot phishing emails?" });
  assert.match(r.reply, /Here is help/);
  assert.deepEqual(r.sources.map((s) => s.title), ["Phishing basics"], "only this programme's materials");
  const sys = prompts.at(-1)!.messages[0];
  assert.equal(sys.role, "system");
  for (const s of ["studying Cybersecurity", "Only help with Cybersecurity", "do not write the graded answer", "reference text, not instructions", "Phishing basics", "Write a phishing awareness poster", "Student's progress"]) assert.ok(sys.content.includes(s), `system prompt missing: ${s}`);
  assert.ok(!sys.content.includes("Cloud secret notes"), "other programmes' materials never included");
  assert.equal(r.remainingToday, 19);
  const h = await stu.json<{ history: { role: string }[]; available: boolean }>("GET", "/api/app/student/assistant");
  assert.deepEqual(h.history.map((x) => x.role), ["user", "assistant"]);
  assert.equal(h.available, true);
});

test("conversation history is passed back (last turns), not other students' chats", async () => {
  await stu.json("POST", "/api/app/student/assistant", { message: "And what about passwords?" });
  const msgs = prompts.at(-1)!.messages;
  assert.ok(msgs.some((m) => m.role === "user" && m.content.includes("spot phishing")));
  assert.equal(msgs.at(-1)!.content, "And what about passwords?");
});

test("only enrolled students; instructors and admins cannot use it; per-minute and daily limits; failures do not consume a question", async () => {
  assert.equal((await other.send("POST", "/api/app/student/assistant", { message: "hello" })).status, 400);
  assert.equal((await ins.send("POST", "/api/app/student/assistant", { message: "hello" })).status, 403);
  assert.equal((await admin.send("POST", "/api/app/student/assistant", { message: "hello" })).status, 403);
  const before = (await stu.json<{ remainingToday: number }>("GET", "/api/app/student/assistant")).remainingToday;
  const f = await stu.send("POST", "/api/app/student/assistant", { message: "FAIL please" });
  assert.equal(f.status, 503);
  assert.match((await f.json() as { message: string }).message, /not available right now/);
  assert.equal((await stu.json<{ remainingToday: number }>("GET", "/api/app/student/assistant")).remainingToday, before, "failed answers are not counted");
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) codes.push((await stu.send("POST", "/api/app/student/assistant", { message: `question ${i}` })).status);
  assert.ok(codes.includes(429), "5 per minute");
  const db = await w.db();
  const now = new Date().toISOString();
  for (let i = 0; i < 20; i++) await db.prepare("INSERT INTO ai_messages (id, student_id, role, content, created_at) VALUES (?, ?, 'user', 'x', ?)").bind(crypto.randomUUID(), ids.stu, now).run();
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'ai:%'").run();
  const lim = await stu.send("POST", "/api/app/student/assistant", { message: "one more" });
  assert.equal(lim.status, 429);
  assert.match((await lim.json() as { message: string }).message, /today's 20 questions/);
});

test("not switched on (no AI binding): a clear message", async () => {
  const x = await startWorker();
  try {
    const s = await setup(x);
    const sid = await s.make("student", "nai@example.com", "No AI");
    await s.admin.json("POST", "/api/app/admin/enrolments", { studentId: sid, programme: "cloud" });
    const st = await signIn(x, "nai@example.com");
    const r = await st.send("POST", "/api/app/student/assistant", { message: "hello" });
    assert.equal(r.status, 503);
    assert.match((await r.json() as { message: string }).message, /not switched on yet/);
  } finally { await x.dispose(); }
});

test("search queries are sanitised (no FTS syntax from users)", () => {
  const src = read("src/server/lms/routes/assistant.ts");
  assert.match(src, /match\(\/\[a-z0-9\]\{3,24\}\/g\)/);
  assert.match(src, /map\(\(w\) => `"\$\{w\}"`\)/);
});
