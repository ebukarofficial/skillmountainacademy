// Sign-in with one-time email links. No passwords.
//   POST /api/auth/request {email, turnstileToken, portal} -> emails a link to /app/confirm/?t=<token> (15 minutes, single use)
// Three private entrances, one per role: students /app/student/login/, instructors /app/instructor/login/, administrators
// /app/login/. A link is only sent to the person whose role matches the entrance used; anyone else is emailed the right
// entrance instead (no link), so the answer on screen never reveals whether an account exists.
//   POST /api/auth/verify  {token}                  -> sets the HttpOnly session cookie (30 days, sliding)
//   POST /api/auth/logout                           -> ends this session
//   GET  /api/me                                    -> who is signed in (or 401)
// The confirm page needs a click (POST) on purpose: email security scanners open links, and a GET must not sign anyone in.
import { siteUrl } from "../../env";
import { ApiError, clientIp, getCookie, nowIso, sha256 } from "../../http";
import { button, esc, layout, sendEmail, table } from "../../email";
import { verifyTurnstile } from "../../turnstile";
import { EMAIL_RE } from "../../validate";
import { Repo } from "../../repo";
import { ALL, ok, publicRoute, route, SESSION_COOKIE, SESSION_DAYS } from "../api";
import { audit, canSignIn, isApproved, logError, consumeToken, revokeTokens, createSession, createToken, createUser, deleteSession, getUser, getUserByEmail, updateUser, type User } from "../data/users";
import { selfView } from "../views";
import { newStaffNo } from "../ids";

const TOKEN_MINUTES = 15;
const INVITE_MINUTES = 24 * 60;
const b64u = (n: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const cookie = (v: string, maxAge: number) => `${SESSION_COOKIE}=${v}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const adminEmails = (v?: string) => (v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Only a path inside the learning platform may be used as the place to return to after signing in.
export const safeNext = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\/app\/[\w\-/]*(\?[\w\-=&%.]*)?$/.test(s) && s.length <= 200 && !/^\/app\/(login|staff|confirm|student\/login|instructor\/login)\b/.test(s) ? s : null;
};

export type Portal = "student" | "instructor" | "admin";
export const PORTALS: Record<Portal, string> = { student: "/app/student/login/", instructor: "/app/instructor/login/", admin: "/app/login/" };
export const portalOf = (role: string): Portal => (role === "admin" ? "admin" : role === "instructor" ? "instructor" : "student");

// Emails a fresh single-use sign-in link. Any earlier unused link for the same person stops working at once.
export async function sendSignInLink(env: Parameters<typeof sendEmail>[0], db: D1Database, user: User, invite = false, next: string | null = null) {
  const token = b64u(32);
  const now = Date.now();
  // Invitations last a day (people may not open them at once); ordinary sign-in links last 15 minutes.
  const minutes = invite ? INVITE_MINUTES : TOKEN_MINUTES;
  await revokeTokens(db, user.id, new Date(now).toISOString());
  await createToken(db, { token_hash: await sha256(`t|${token}`), user_id: user.id, expires_at: new Date(now + minutes * 60_000).toISOString(), created_at: new Date(now).toISOString() });
  const site = siteUrl(env);
  const portal = portalOf(user.role);
  const link = `${site}/app/confirm/?t=${token}&p=${portal}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
  const entry = `${site}${PORTALS[portal]}`;
  const first = esc(user.full_name.split(" ")[0]);
  const kind = portal === "admin" ? "admin" : portal === "instructor" ? "instructor" : "login";
  const expiry = invite ? "It works once and expires in 24 hours." : `It works once and expires in ${TOKEN_MINUTES} minutes.`;
  const later = `<p style="opacity:.7;font-size:14px">If you did not ask for this, ignore this email; nobody can use your account without it. Next time, request a new link at <a href="${entry}">${entry.replace("https://", "")}</a> with this email address.</p>`;

  // A new instructor, added by the Academy and not yet verified: congratulations and the onboarding steps.
  if (invite && user.role === "instructor" && !isApproved(user)) {
    return sendEmail(env, {
      to: user.email,
      subject: "Congratulations: you are invited to join the Skill Mountain Academy faculty",
      html: layout(`Dear ${first}`, `<p>Congratulations. Skill Mountain Academy has invited you to join its faculty.</p>
        ${table([["Faculty entrance", entry.replace("https://", "")], ["Sign in with", user.email], ["Password", "None needed: we email you a secure link each time"]])}
        <p>Please sign in and complete your faculty profile, then submit it for verification:</p>
        <ol style="padding-left:20px;margin:0 0 8px">
          <li>A passport-style profile photo</li>
          <li>Your biography and a one-line professional citation</li>
          <li>Your LinkedIn, X (Twitter), Facebook and portfolio links</li>
          <li>Your achievements and certifications, each with its public verification link</li>
          <li>The languages you speak, your country of origin and your country of residence</li>
        </ol>
        <p>The Academy then verifies your information. Once approved, a verified badge shows next to your name and your full faculty workspace opens.</p>
        ${button(link, "Sign in and complete my profile")}
        <p style="opacity:.8;font-size:14px">This button ${expiry.toLowerCase().replace("it ", "")}</p>${later}`,
        { headline: "Welcome to the faculty", kind: "instructor" }),
    });
  }

  const staff = user.role !== "student";
  const place = portal === "admin" ? "Academy administration" : portal === "instructor" ? "the faculty workspace" : "your learning space";
  const number = user.role === "student" ? user.student_no : user.staff_no;
  return sendEmail(env, {
    to: user.email,
    subject: invite ? (portal === "admin" ? "Your Skill Mountain Academy administrator access" : portal === "instructor" ? "Your Skill Mountain Academy faculty access" : "Your learning space is ready") : "Your Skill Mountain Academy sign-in link",
    html: layout(`Dear ${first}`, `<p>${invite ? `Your access to ${place} is ready.` : `Here is your link to ${place}.`} ${expiry}</p>
      ${number ? `<p style="opacity:.8">${staff ? (portal === "admin" ? "Staff number" : "Faculty number") : "Registration No"}: <b>${esc(number)}</b></p>` : ""}
      ${button(link, portal === "admin" ? "Continue to administration" : portal === "instructor" ? "Enter the faculty workspace" : "Enter my learning space")}
      ${later}`,
      { headline: invite ? (portal === "admin" ? "Your administrator access is ready" : portal === "instructor" ? "Your faculty access is ready" : "Your learning space is ready") : "Your secure sign-in link", kind }),
  });
}

// Someone used another role's entrance: tell them where theirs is. No sign-in link is included.
function sendWrongEntrance(env: Parameters<typeof sendEmail>[0], user: User) {
  const p = portalOf(user.role);
  const url = `${siteUrl(env)}${PORTALS[p]}`;
  const who = p === "admin" ? "administrators" : p === "instructor" ? "faculty" : "students";
  return sendEmail(env, {
    to: user.email,
    subject: "Please use your Skill Mountain Academy entrance",
    html: layout(`Dear ${esc(user.full_name.split(" ")[0])}`, `<p>A sign-in link was requested for this email address on an entrance that is not for your account. For security, no link was sent.</p><p>Your entrance (for ${who}) is:</p>${button(url, "Go to my entrance")}<p style="opacity:.7;font-size:14px">If you did not ask for this, you can ignore this email.</p>`,
      { headline: "Please use your own entrance", kind: p === "admin" ? "admin" : p === "instructor" ? "instructor" : "login" }),
  });
}

publicRoute("POST", "/api/auth/request", async (c) => {
  const b = await c.body<{ email?: string; turnstileToken?: string; next?: string; portal?: string }>();
  // Older cached pages send no portal: they are treated as allowing any role.
  const portal = b.portal && b.portal in PORTALS ? (b.portal as Portal) : null;
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
  if (!EMAIL_RE.test(email)) throw new ApiError(400, "invalid", "Please enter a valid email address.");
  await verifyTurnstile(c.env, b.turnstileToken, clientIp(c.req));
  const repo = new Repo(c.db);
  await repo.limitOrThrow(`login:${c.ipHash}`, 8, 600);
  await repo.limitOrThrow(`login-email:${email}`, 4, 600);
  let user = await getUserByEmail(c.db, email);
  // First sign-in of an owner listed in ADMIN_EMAILS creates their admin account.
  if (!user && (portal === null || portal === "admin") && adminEmails(c.env.ADMIN_EMAILS).includes(email)) {
    user = { id: crypto.randomUUID(), email, role: "admin", status: "active", full_name: "SMA Admin", phone: null, bio: null, photo_key: null, student_no: null,
      specialization: null, qualifications: null, links: null, registration_id: null, created_at: nowIso(), last_login_at: null,
      staff_no: (await newStaffNo(c.db, "admin")) ?? undefined };
    await createUser(c.db, user);
    await audit(c.db, { actor_id: user.id, action: "admin.bootstrap", target_type: "user", target_id: user.id, ip_hash: c.ipHash });
  }
  if (user && canSignIn(user)) {
    if (portal === null || portalOf(user.role) === portal) c.exec.waitUntil(sendSignInLink(c.env, c.db, user, false, safeNext(b.next)).catch((e) => logError(c.db, "/api/auth/request", `Sign-in email for ${user!.email} failed: ${String((e as Error)?.stack ?? e)}`)));
    else c.exec.waitUntil(sendWrongEntrance(c.env, user));
  }
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
