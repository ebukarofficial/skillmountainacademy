// LMS 1: sign-in links, sessions, roles and permissions, user management, audit log, accounts from payments.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { read } from "./helpers.ts";
import { SECRETS, learner, registration, startWorker } from "./worker-harness.ts";
import { session, setup, signIn } from "./lms-helpers.ts";

let w: Awaited<ReturnType<typeof startWorker>>;
before(async () => { w = await startWorker(); });
after(async () => { await w.dispose(); });

test("owner bootstrap: an ADMIN_EMAILS address becomes admin on first sign-in; cookie is HttpOnly, Secure, SameSite", async () => {
  const before = w.calls.length;
  await w.post("/api/auth/request", { email: "owner@example.com", turnstileToken: "good-token" });
  await w.waitFor((c) => c.slice(before).some((x) => x.url.includes("api.resend.com")));
  const mail = w.calls.slice(before).find((x) => x.url.includes("api.resend.com"))!;
  const token = JSON.parse(mail.body).html.match(/confirm\/\?t=([\w-]+)/)[1];
  assert.equal((await w.fetchApi(`/api/auth/verify?token=${token}`)).status, 405, "a GET (email scanner) cannot sign anyone in");
  const v = await w.post("/api/auth/verify", { token });
  assert.equal(v.status, 200);
  const sc = v.headers.getSetCookie()[0];
  for (const a of ["sma_session=", "HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) assert.ok(sc.includes(a), a);
  const s = session(w, sc.split(";")[0]);
  const me = await s.json<{ user: { role: string; email: string } }>("GET", "/api/me");
  assert.deepEqual([me.user.role, me.user.email], ["admin", "owner@example.com"]);
  const again = await w.post("/api/auth/verify", { token });
  assert.equal(again.status, 400, "links work once");
  const row = await (await w.db()).prepare("SELECT COUNT(*) AS n FROM auth_tokens WHERE token_hash = ?").bind(token).first<{ n: number }>();
  assert.equal(row?.n, 0, "only a hash of the token is stored");
});

test("unknown emails get the same answer and no email; Turnstile and rate limits apply", async () => {
  const before = w.calls.length;
  const r = await w.post("/api/auth/request", { email: "nobody@example.com", turnstileToken: "good-token" }, { "cf-connecting-ip": "10.1.1.1" });
  const j = await r.json() as { message: string };
  assert.match(j.message, /If this email has an account/);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!w.calls.slice(before).some((c) => c.url.includes("api.resend.com")), "no email for unknown addresses");
  assert.equal((await w.post("/api/auth/request", { email: "nobody@example.com" })).status, 400, "Turnstile required");
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await w.post("/api/auth/request", { email: `x${i}@example.com`, turnstileToken: "good-token" }, { "cf-connecting-ip": "10.1.1.2" })).status);
  assert.equal(codes.at(-1), 429);
});

test("expired links fail; sign-out ends the session", async () => {
  const { make } = await setup(w);
  await make("student", "exp@example.com", "Exp Student");
  const before = w.calls.length;
  await w.post("/api/auth/request", { email: "exp@example.com", turnstileToken: "good-token" }, { "cf-connecting-ip": "10.1.1.3" });
  await w.waitFor((c) => c.slice(before).some((x) => x.url.includes("api.resend.com") && x.body.includes("exp@example.com")));
  const token = JSON.parse(w.calls.slice(before).find((x) => x.body.includes("exp@example.com"))!.body).html.match(/confirm\/\?t=([\w-]+)/)[1];
  await (await w.db()).prepare("UPDATE auth_tokens SET expires_at = '2000-01-01T00:00:00Z' WHERE used_at IS NULL").run();
  assert.equal((await w.post("/api/auth/verify", { token })).status, 400);
  const s = await signIn(w, "exp@example.com");
  assert.equal((await s.get("/api/me")).status, 200);
  await s.send("POST", "/api/auth/logout");
  assert.equal((await s.get("/api/me")).status, 401);
});

test("roles are enforced on the server: 401 signed out, 403 for the wrong role, CSRF refused", async () => {
  const { admin, make } = await setup(w);
  await make("instructor", "ins1@example.com", "Ins One");
  await make("student", "stu1@example.com", "Stu One");
  const ins = await signIn(w, "ins1@example.com");
  const stu = await signIn(w, "stu1@example.com");
  assert.equal((await w.fetchApi("/api/app/admin/users")).status, 401);
  assert.equal((await stu.get("/api/app/admin/users")).status, 403);
  assert.equal((await ins.get("/api/app/admin/users")).status, 403);
  assert.equal((await admin.get("/api/app/admin/users")).status, 200);
  const csrf = await w.fetchApi("/api/app/admin/users", { method: "POST", headers: { cookie: admin.cookie, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
  assert.equal(csrf.status, 403);
});

test("admin manages users: create with student number, invite, edit, suspend (sessions end at once), no self-lockout", async () => {
  const { admin } = await setup(w);
  const before = w.calls.length;
  const created = await admin.json<{ user: { id: string; studentNo: string; role: string } }>("POST", "/api/app/admin/users", { email: "NEW@Example.com", role: "student", fullName: "New Student", phone: "08030000000" });
  assert.match(created.user.studentNo, /^SMA\d{2}-[A-Z0-9]{5}$/);
  assert.ok(await w.waitFor((c) => c.slice(before).some((x) => x.url.includes("api.resend.com") && x.body.includes("new@example.com") && x.body.includes("account is ready"))), "invite email");
  assert.equal((await admin.send("POST", "/api/app/admin/users", { email: "new@example.com", role: "student", fullName: "Dup" })).status, 409);
  const stu = await signIn(w, "new@example.com");
  await admin.json("PATCH", `/api/app/admin/users/${created.user.id}`, { status: "suspended" });
  assert.equal((await stu.get("/api/me")).status, 401, "suspended user is signed out immediately");
  const r = await w.post("/api/auth/request", { email: "new@example.com", turnstileToken: "good-token" }, { "cf-connecting-ip": "10.1.1.9" });
  assert.equal(r.status, 200);
  const me = await admin.json<{ user: { id: string } }>("GET", "/api/me");
  assert.equal((await admin.send("PATCH", `/api/app/admin/users/${me.user.id}`, { status: "suspended" })).status, 400);
  const list = await admin.json<{ users: { email: string }[] }>("GET", "/api/app/admin/users?role=student&q=new");
  assert.ok(list.users.some((u) => u.email === "new@example.com"));
  const audit = await admin.json<{ entries: { action: string }[] }>("GET", "/api/app/admin/audit");
  for (const a of ["user.create", "user.update", "auth.login", "admin.bootstrap"]) assert.ok(audit.entries.some((e) => e.action === a), a);
});

test("profiles: users edit their own; students cannot set instructor fields; links must be https", async () => {
  const { make } = await setup(w);
  await make("instructor", "ins2@example.com", "Ins Two");
  await make("student", "stu2@example.com", "Stu Two");
  const ins = await signIn(w, "ins2@example.com");
  const j = await ins.json<{ user: { specialization: string; links: Record<string, string>; qualifications: string[] } }>("PATCH", "/api/me", { specialization: "Cloud", qualifications: ["AWS SA"], links: { linkedin: "https://linkedin.com/in/x" } });
  assert.equal(j.user.specialization, "Cloud");
  assert.deepEqual(j.user.qualifications, ["AWS SA"]);
  assert.equal((await ins.send("PATCH", "/api/me", { links: { portfolio: "javascript:alert(1)" } })).status, 400);
  const stu = await signIn(w, "stu2@example.com");
  const s = await stu.json<{ user: { specialization: string | null; bio: string } }>("PATCH", "/api/me", { specialization: "Hacker", bio: "Hello" });
  assert.equal(s.user.specialization, null);
  assert.equal(s.user.bio, "Hello");
});

test("first payment creates the student account and enrolment; the welcome email points to the dashboard", async () => {
  const reg = await (await w.post("/api/register", registration({ learner: learner({ email: "payer@example.com", firstName: "Pay", surname: "Er" }) }), { "cf-connecting-ip": "10.2.0.1" })).json() as { reference: string };
  const init = w.calls.map((c) => c.url.endsWith("/transaction/initialize") ? JSON.parse(c.body) : null).find((b) => b?.reference.startsWith(reg.reference))!;
  const body = JSON.stringify({ event: "charge.success", data: { id: 777001, reference: init.reference, amount: init.amount, currency: "NGN", status: "success" } });
  await w.fetchApi("/api/paystack/webhook", { method: "POST", headers: { "x-paystack-signature": createHmac("sha512", SECRETS.PAYSTACK_SECRET_KEY).update(body).digest("hex") }, body });
  assert.ok(await w.waitFor((c) => c.some((x) => x.url.includes("api.resend.com") && x.body.includes("payer@example.com") && x.body.includes("/app/login/"))));
  const db = await w.db();
  const u = await db.prepare("SELECT * FROM users WHERE email = 'payer@example.com'").first<Record<string, string>>();
  assert.equal(u?.role, "student");
  assert.equal(u?.full_name, "Pay Er");
  const e = await db.prepare("SELECT * FROM enrolments WHERE student_id = ?").bind(u?.id).first<Record<string, string>>();
  assert.equal(e?.programme_slug, "cloud");
  assert.ok(e?.order_id);
  const s = await signIn(w, "payer@example.com");
  assert.equal((await s.json<{ user: { role: string } }>("GET", "/api/me")).user.role, "student");
});

test("only data-layer files contain SQL", () => {
  for (const f of ["src/server/lms/api.ts", "src/server/lms/routes/auth.ts", "src/server/lms/routes/users.ts", "src/server/lms/accounts.ts"]) assert.doesNotMatch(read(f), /\.prepare\(|SELECT |INSERT INTO|UPDATE \w+ SET/, f);
});
