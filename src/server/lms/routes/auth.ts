// Sign-in with one-time email links. No passwords.
//   POST /api/auth/request {email, turnstileToken}  -> emails a link to /app/login/confirm/?t=<token> (15 minutes, single use)
//   POST /api/auth/verify  {token}                  -> sets the HttpOnly session cookie (30 days, sliding)
//   POST /api/auth/logout                           -> ends this session
//   GET  /api/me                                    -> who is signed in (or 401)
// The confirm page needs a click (POST) on purpose: email security scanners open links, and a GET must not sign anyone in.
import { siteUrl } from "../../env";
import { ApiError, clientIp, getCookie, nowIso, sha256 } from "../../http";
import { button, esc, layout, sendEmail } from "../../email";
import { verifyTurnstile } from "../../turnstile";
import { EMAIL_RE } from "../../validate";
import { Repo } from "../../repo";
import { ALL, ok, publicRoute, route, SESSION_COOKIE, SESSION_DAYS } from "../api";
import { audit, canSignIn, consumeToken, revokeTokens, createSession, createToken, createUser, deleteSession, getUser, getUserByEmail, updateUser, type User } from "../data/users";
import { selfView } from "../views";
import { newStaffNo } from "../ids";

const TOKEN_MINUTES = 15;
const b64u = (n: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const cookie = (v: string, maxAge: number) => `${SESSION_COOKIE}=${v}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const adminEmails = (v?: string) => (v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Only a path inside the learning platform may be used as the place to return to after signing in.
export const safeNext = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\/app\/[\w\-/]*(\?[\w\-=&%.]*)?$/.test(s) && s.length <= 200 && !s.startsWith("/app/login") && !s.startsWith("/app/staff") ? s : null;
};

// Emails a fresh single-use sign-in link. Any earlier unused link for the same person stops working at once.
export async function sendSignInLink(env: Parameters<typeof sendEmail>[0], db: D1Database, user: User, invite = false, next: string | null = null) {
  const token = b64u(32);
  const now = Date.now();
  await revokeTokens(db, user.id, new Date(now).toISOString());
  await createToken(db, { token_hash: await sha256(`t|${token}`), user_id: user.id, expires_at: new Date(now + TOKEN_MINUTES * 60_000).toISOString(), created_at: new Date(now).toISOString() });
  const site = siteUrl(env);
  const link = `${site}/app/login/confirm/?t=${token}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
  const staff = user.role !== "student";
  const place = staff ? "the Skill Mountain Academy staff workspace" : "your learning space";
  const entry = staff ? `${site}/app/staff/` : `${site}/app/login/`;
  const number = user.role === "student" ? user.student_no : user.staff_no;
  return sendEmail(env, {
    to: user.email,
    subject: invite ? (staff ? "Your Skill Mountain Academy staff access" : "Your learning space is ready") : "Your Skill Mountain Academy sign-in link",
    html: layout(`Dear ${esc(user.full_name.split(" ")[0])}`, `<p>${invite ? `Your access to ${place} is ready.` : `Here is your link to ${place}.`} It works once and expires in ${TOKEN_MINUTES} minutes.</p>
      ${number ? `<p style="opacity:.8">${staff ? "Staff number" : "Registration No"}: <b>${esc(number)}</b></p>` : ""}
      ${button(link, staff ? "Enter the staff workspace" : "Enter my learning space")}
      <p style="opacity:.7;font-size:14px">If you did not ask for this, ignore this email; nobody can use your account without it. Next time, request a new link at ${entry}</p>`),
  });
}

publicRoute("POST", "/api/auth/request", async (c) => {
  const b = await c.body<{ email?: string; turnstileToken?: string; next?: string }>();
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
      specialization: null, qualifications: null, links: null, registration_id: null, created_at: nowIso(), last_login_at: null,
      staff_no: (await newStaffNo(c.db, "admin")) ?? undefined };
    await createUser(c.db, user);
    await audit(c.db, { actor_id: user.id, action: "admin.bootstrap", target_type: "user", target_id: user.id, ip_hash: c.ipHash });
  }
  if (user && canSignIn(user)) c.exec.waitUntil(sendSignInLink(c.env, c.db, user, false, safeNext(b.next)));
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
  if (!user || !canSignIn(user)) throw new ApiError(400, "invalid_link", "This sign-in link has expired or was already used. Please request a new one.");
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
