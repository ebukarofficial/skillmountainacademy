// Sign-in with one-time email links. No passwords.
//   POST /api/auth/request {email, turnstileToken}  -> emails a link to /app/login/confirm/?t=<token> (15 minutes, single use)
//   POST /api/auth/verify  {token}                  -> sets the HttpOnly session cookie (30 days, sliding)
//   POST /api/auth/logout                           -> ends this session
//   GET  /api/me                                    -> who is signed in (or 401)
// The confirm page needs a click (POST) on purpose: email security scanners open links, and a GET must not sign anyone in.
import { siteUrl } from "../../env";
import { ApiError, clientIp, getCookie, nowIso, sha256 } from "../../http";
import { button, layout, sendEmail } from "../../email";
import { verifyTurnstile } from "../../turnstile";
import { EMAIL_RE } from "../../validate";
import { Repo } from "../../repo";
import { ALL, ok, publicRoute, route, SESSION_COOKIE, SESSION_DAYS } from "../api";
import { audit, consumeToken, createSession, createToken, createUser, deleteSession, getUser, getUserByEmail, updateUser, type User } from "../data/users";
import { selfView } from "../views";

const TOKEN_MINUTES = 15;
const b64u = (n: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const cookie = (v: string, maxAge: number) => `${SESSION_COOKIE}=${v}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const adminEmails = (v?: string) => (v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export async function sendSignInLink(env: Parameters<typeof sendEmail>[0], db: D1Database, user: User, invite = false) {
  const token = b64u(32);
  const now = Date.now();
  await createToken(db, { token_hash: await sha256(`t|${token}`), user_id: user.id, expires_at: new Date(now + TOKEN_MINUTES * 60_000).toISOString(), created_at: new Date(now).toISOString() });
  const link = `${siteUrl(env)}/app/login/confirm/?t=${token}`;
  return sendEmail(env, {
    to: user.email,
    subject: invite ? "Your Skill Mountain Academy account is ready" : "Your Skill Mountain Academy sign-in link",
    html: layout(`Hi ${user.full_name.split(" ")[0]}`, `<p>${invite ? "Your learning account is ready. " : ""}Use the button below to sign in. The link works once and expires in ${TOKEN_MINUTES} minutes.</p>
      ${button(link, "Sign in to Skill Mountain Academy")}<p>If you did not ask for this, you can ignore this email.</p>
      <p>Next time, sign in at ${siteUrl(env)}/app/login/ with this email address.</p>`),
  });
}

publicRoute("POST", "/api/auth/request", async (c) => {
  const b = await c.body<{ email?: string; turnstileToken?: string }>();
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
  if (!EMAIL_RE.test(email)) throw new ApiError(400, "invalid", "Please enter a valid email address.");
  await verifyTurnstile(c.env, b.turnstileToken, clientIp(c.req));
  const repo = new Repo(c.db);
  await repo.limitOrThrow(`login:${c.ipHash}`, 8, 600);
  await repo.limitOrThrow(`login-email:${email}`, 4, 600);
  let user = await getUserByEmail(c.db, email);
  // First sign-in of an owner listed in ADMIN_EMAILS creates their admin account.
  if (!user && adminEmails(c.env.ADMIN_EMAILS).includes(email)) {
    user = { id: crypto.randomUUID(), email, role: "admin", status: "active", full_name: "SMA Admin", phone: null, bio: null, photo_key: null, student_no: null,
      specialization: null, qualifications: null, links: null, registration_id: null, created_at: nowIso(), last_login_at: null };
    await createUser(c.db, user);
    await audit(c.db, { actor_id: user.id, action: "admin.bootstrap", target_type: "user", target_id: user.id, ip_hash: c.ipHash });
  }
  if (user && user.status === "active") c.exec.waitUntil(sendSignInLink(c.env, c.db, user));
  // Same answer whether or not the address has an account, so nobody can probe for accounts.
  return ok({ message: "If this email has an account, a sign-in link is on its way. It expires in 15 minutes." });
});

publicRoute("POST", "/api/auth/verify", async (c) => {
  const b = await c.body<{ token?: string }>();
  const token = String(b.token ?? "");
  if (!/^[\w-]{30,64}$/.test(token)) throw new ApiError(400, "invalid_link", "This sign-in link is not valid. Please request a new one.");
  const now = nowIso();
  const userId = await consumeToken(c.db, await sha256(`t|${token}`), now);
  const user = userId ? await getUser(c.db, userId) : null;
  if (!user || user.status !== "active") throw new ApiError(400, "invalid_link", "This sign-in link has expired or was already used. Please request a new one.");
  const session = b64u(32);
  await createSession(c.db, { token_hash: await sha256(`s|${session}`), user_id: user.id, created_at: now, expires_at: new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString(),
    last_seen_at: now, user_agent: (c.req.headers.get("user-agent") || "").slice(0, 200) });
  await updateUser(c.db, user.id, { last_login_at: now });
  await audit(c.db, { actor_id: user.id, action: "auth.login", target_type: "user", target_id: user.id, ip_hash: c.ipHash });
  return ok({ role: user.role }, 200, { "set-cookie": cookie(session, SESSION_DAYS * 86400) });
});

publicRoute("POST", "/api/auth/logout", async (c) => {
  const t = getCookie(c.req, SESSION_COOKIE);
  if (t && t.length <= 200) await deleteSession(c.db, await sha256(`s|${t}`));
  return ok({}, 200, { "set-cookie": cookie("", 0) });
});

route("GET", "/api/me", ALL, async (c) => ok({ user: selfView(c.user) }));
