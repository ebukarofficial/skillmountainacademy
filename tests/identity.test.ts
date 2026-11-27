// Institutional numbers, admin admission of offline payments, sign-in link hardening and notification priority.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startWorker } from "./worker-harness.ts";
import { setup, signIn, eligible } from "./lms-helpers.ts";

let w: Awaited<ReturnType<typeof startWorker>>;
before(async () => { w = await startWorker(); });
after(async () => { await w.dispose(); });
const yy = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "2-digit" }).format(new Date());
const mails = (from: number, to: string) => w.calls.slice(from).filter((x) => x.url.includes("api.resend.com") && x.body.includes(to)).map((x) => JSON.parse(x.body) as { subject: string; html: string });

test("staff and students get unique, sequential institutional numbers", async () => {
  const { admin, make } = await setup(w);
  const me = await admin.json<{ user: { staffNo: string } }>("GET", "/api/me");
  assert.match(me.user.staffNo, /^SMA\/ADM\/\d{6}$/);
  const a = await make("student", "num-a@example.com", "Num A");
  const b = await make("student", "num-b@example.com", "Num B");
  const ua = (await admin.json<{ user: { studentNo: string } }>("GET", `/api/app/admin/users/${a}`)).user.studentNo;
  const ub = (await admin.json<{ user: { studentNo: string } }>("GET", `/api/app/admin/users/${b}`)).user.studentNo;
  assert.match(ua, new RegExp(`^SMA/${yy}/\\d{6}$`));
  assert.equal(Number(ub.slice(-6)), Number(ua.slice(-6)) + 1, "sequential");
  const ins = await make("instructor", "num-ins@example.com", "Num Instructor");
  assert.match((await admin.json<{ user: { staffNo: string } }>("GET", `/api/app/admin/users/${ins}`)).user.staffNo, /^SMA\/FAC\/\d{6}$/, "faculty number on approval");
  const cand = await admin.json<{ user: { id: string } }>("POST", "/api/app/admin/users", { email: "num-cand@example.com", role: "instructor", fullName: "Not Yet" });
  assert.equal((await admin.json<{ user: { staffNo: string | null } }>("GET", `/api/app/admin/users/${cand.user.id}`)).user.staffNo, null, "no number before approval");
  const dup = await (await w.db()).prepare("UPDATE users SET student_no = ? WHERE id = ?").bind(ua, b).run().then(() => "ok", (e: Error) => e.message);
  assert.match(dup, /UNIQUE/i, "the database refuses a duplicate number");
});

test("admin admits a student who paid offline: records, registration number, payment, emails; no duplicates", async () => {
  const { admin, make } = await setup(w);
  const ins = await make("instructor", "admit-ins@example.com", "Admit Instructor");
  await eligible(admin, ins, "cloud"); // Stage C: the instructor must be approved for the programme
  const before = w.calls.length;
  const r = await admin.json<{ student: { id: string; studentNo: string }; order: { reference: string; paidNaira: number; totalNaira: number } }>("POST", "/api/app/admin/admit", {
    firstName: "Ada", surname: "Okafor", email: "ada.offline@example.com", phone: "08030000000", country: "Nigeria", programme: "cloud", plan: "parts", paidParts: 1, paymentReference: "UBA 12345", instructorId: ins,
  });
  assert.match(r.student.studentNo, new RegExp(`^SMA/${yy}/\\d{6}$`));
  assert.equal(r.order.totalNaira, 450000, "price comes from the catalogue");
  assert.equal(r.order.paidNaira, 225000);
  assert.ok(await w.waitFor((cs) => cs.slice(before).filter((x) => x.url.includes("api.resend.com") && x.body.includes("ada.offline@example.com")).length >= 2));
  const m = mails(before, "ada.offline@example.com");
  const conf = m.find((x) => /Admission confirmed/.test(x.subject))!;
  assert.ok(conf.html.includes(r.student.studentNo), "registration number in the admission confirmation");
  assert.ok(m.some((x) => /learning space is ready/.test(x.subject) && /\/app\/confirm\/\?t=/.test(x.html)), "separate access email");
  const db = await w.db();
  const enr = await db.prepare("SELECT instructor_id, status FROM enrolments WHERE student_id = ? AND programme_slug = 'cloud'").bind(r.student.id).first<{ instructor_id: string; status: string }>();
  assert.deepEqual(enr, { instructor_id: ins, status: "active" });
  const ord = await db.prepare("SELECT status FROM orders WHERE reference = ?").bind(r.order.reference).first<{ status: string }>();
  assert.equal(ord?.status, "part_paid");
  assert.equal((await admin.send("POST", "/api/app/admin/admit", { firstName: "Ada", surname: "Okafor", email: "ada.offline@example.com", programme: "cloud", plan: "full" })).status, 409, "no second admission");
  assert.ok((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'admission.admin'").first<{ n: number }>())!.n >= 1);
  // The student can sign in and sees their number.
  const s = await signIn(w, "ada.offline@example.com");
  assert.equal((await s.json<{ user: { studentNo: string } }>("GET", "/api/me")).user.studentNo, r.student.studentNo);
  assert.equal((await s.send("POST", "/api/app/admin/admit", { firstName: "X", surname: "Y", email: "x@example.com", programme: "cloud" })).status, 403);
});

test("a new sign-in link replaces older ones; links carry only a safe return path", async () => {
  const { make } = await setup(w);
  await make("student", "relink@example.com", "Re Link");
  const ask = async (next?: string) => {
    const b = w.calls.length;
    await w.post("/api/auth/request", { email: "relink@example.com", turnstileToken: "good-token", next }, { "cf-connecting-ip": `10.55.0.${b % 200}` });
    assert.ok(await w.waitFor((cs) => cs.slice(b).some((x) => x.url.includes("api.resend.com") && x.body.includes("relink@example.com"))));
    return mails(b, "relink@example.com").at(-1)!.html;
  };
  const first = (await ask("/app/?tab=assignments")).match(/confirm\/\?t=([\w-]+)&amp;p=\w+(&amp;next=([^"&]+))?/)!;
  assert.equal(decodeURIComponent(first[3]), "/app/?tab=assignments");
  const second = (await ask("https://evil.example.com/")).match(/confirm\/\?t=([\w-]+)&amp;p=\w+(&amp;next=)?/)!;
  assert.equal(second[2], undefined, "an outside address is never used as the return path");
  assert.equal((await w.post("/api/auth/verify", { token: first[1] })).status, 400, "the earlier link stopped working");
  assert.equal((await w.post("/api/auth/verify", { token: second[1] })).status, 200);
  assert.equal((await w.post("/api/auth/verify", { token: second[1] })).status, 400, "single use");
});

test("notifications carry priority; email preferences are saved", async () => {
  const { make } = await setup(w);
  await make("student", "prefs@example.com", "Pref Student");
  const s = await signIn(w, "prefs@example.com");
  const u = await s.json<{ user: { emailPrefs: { reminders: boolean } } }>("PATCH", "/api/me", { emailPrefs: { reminders: false, updates: true } });
  assert.equal(u.user.emailPrefs.reminders, false);
  const { priorityOf, categoryOf } = await import("../lib/notify-rules.ts");
  assert.equal(priorityOf("meet.link"), "urgent");
  assert.equal(priorityOf("reminder.15m"), "urgent");
  assert.equal(priorityOf("assignment.new"), "normal");
  assert.equal(categoryOf("reminder.24h"), "reminders");
  assert.equal(categoryOf("assignment.graded"), "essential");
});

test("an outdated database gives the admin a plain instruction instead of a raw error", async () => {
  const { admin } = await setup(w);
  const db = await w.db();
  await db.prepare("ALTER TABLE users RENAME COLUMN verification TO verification_old").run();
  try {
    const r = await admin.send("POST", "/api/app/admin/users", { email: "old-db@example.com", role: "instructor", fullName: "Old Db" });
    assert.equal(r.status, 503);
    assert.match(((await r.json()) as { message: string }).message, /npm run db:migrate/);
  } finally {
    await db.prepare("ALTER TABLE users RENAME COLUMN verification_old TO verification").run();
  }
});

test("each entrance signs in only its own role; others are told where their entrance is, with no link", async () => {
  const { make } = await setup(w);
  await make("student", "portal-stu@example.com", "Portal Student");
  const req = async (email: string, portal: string) => {
    const before = w.calls.length;
    const r = await w.post("/api/auth/request", { email, portal, turnstileToken: "good-token" }, { "cf-connecting-ip": `10.9.${portal.length}.${email.length}` });
    assert.equal(r.status, 200);
    assert.ok(await w.waitFor((c) => c.slice(before).some((x) => x.url.includes("api.resend.com") && x.body.includes(email))));
    return mails(before, email);
  };
  const wrong = await req("portal-stu@example.com", "admin");
  assert.equal(wrong.length, 1);
  assert.match(wrong[0].subject, /use your Skill Mountain Academy entrance/);
  assert.doesNotMatch(wrong[0].html, /confirm\/\?t=/, "no sign-in link from the wrong entrance");
  assert.match(wrong[0].html, /\/app\/student\/login\//);
  const right = await req("portal-stu@example.com", "student");
  assert.match(right[0].html, /\/app\/confirm\/\?t=/);
  assert.ok(right.every((m) => typeof m.html === "string"));
});

test("email failures are recorded with Resend's reason, and admins can send a test email", async () => {
  const { admin } = await setup(w);
  const ok = await admin.json<{ sent: boolean; reason: string; to: string }>("POST", "/api/app/admin/test-email");
  assert.equal(ok.sent, true);
  const { deliver } = await import("../src/server/email.ts");
  const r = await deliver({} as never, { to: "x@example.com", subject: "s", html: "<p>x</p>" });
  assert.deepEqual([r.ok, /RESEND_API_KEY/.test(r.reason)], [false, true], "a missing key is named");
});
