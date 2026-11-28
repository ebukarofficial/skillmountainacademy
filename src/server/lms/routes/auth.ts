// Sign-in with one-time email links. No passwords.
//   POST /api/auth/request {email, turnstileToken, portal} -> emails a link to /app/confirm/?t=<token> (15 minutes, single use)
// Three private entrances, one per role: students /app/student/login/, instructors /app/instructor/login/, administrators
// /app/login/. A link is only sent to the person whose role matches the entrance used; anyone else is emailed the right
// entrance instead (no link), so the answer on screen never reveals whether an account exists.
//   POST /api/auth/verify  {token}                  -> sets the HttpOnly session cookie (students: 12 h, ends after 10 min idle;
//                                                      staff: 30 days sliding). Administrators with an authenticator app
//                                                      get a session limited to /api/auth/mfa/verify until they enter a code.
//   POST /api/auth/logout                           -> ends this session
//   POST /api/auth/logout-all                       -> ends every session of this account, on every device
//   POST /api/auth/activity {ago?}                  -> records GENUINE user activity (idle timeout); never revives a lapsed session
//   GET  /api/me                                    -> who is signed in (or 401)
// The confirm page needs a click (POST) on purpose: email security scanners open links, and a GET must not sign anyone in.
import { siteUrl } from "../../env";
import { ApiError, clientIp, getCookie, nowIso, sha256 } from "../../http";
import { button, esc, layout, sendEmail, table } from "../../email";
import { verifyTurnstile } from "../../turnstile";
import { EMAIL_RE } from "../../validate";
import { Repo } from "../../repo";
import { ALL, clearCookie, ok, publicRoute, route, SESSION_COOKIE } from "../api";
import { audit, canSignIn, isApproved, logError, consumeToken, revokeTokens, createSession, createToken, createUser, deleteSession, deleteUserSessions, getUser, getUserByEmail, recordActivity, updateUser, type User } from "../data/users";
import { activeFactor } from "../data/mfa";
import { areasFor, ownerEmail } from "../permissions";
import { ACTIVITY_THROTTLE_SECONDS, policyFor } from "../session-policy";
import { selfView } from "../views";
import { newStaffNo } from "../ids";
import { getOwnerRecord } from "../data/owner";

const TOKEN_MINUTES = 15;
const INVITE_MINUTES = 24 * 60;
const b64u = (n: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const sessionCookie = (v: string, maxAge: number) => `${SESSION_COOKIE}=${v}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
export const newSessionToken = () => b64u(32);
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
  // 20 per address allows a classroom or office behind one shared address; 4 per email stops mailbox flooding.
  await repo.limitOrThrow(`login:${c.ipHash}`, 20, 600);
  await repo.limitOrThrow(`login-email:${email}`, 4, 600);
  let user = await getUserByEmail(c.db, email);
  // First sign-in of an owner listed in ADMIN_EMAILS creates their admin account.
  // The owner (OWNER_EMAIL) is bootstrapped the same way; their group is set later by the owner set-up, never here.
  // Owner email transition safety: once the owner is bootstrapped, a NEW OWNER_EMAIL address never gets an account
  // created here. The existing owner account keeps its identity and is moved to the new address by the documented
  // transition (scripts/owner/transition-email.mts); until then nobody is the owner ("mismatch"), and no duplicate
  // administrator account appears for the new address.
  const rec = !user && email === ownerEmail(c.env) ? await getOwnerRecord(c.db).catch(() => null) : null;
  const blocked = !!rec && rec !== "missing_table" && rec.email.toLowerCase() !== email;
  if (!user && !blocked && (portal === null || portal === "admin") && [...adminEmails(c.env.ADMIN_EMAILS), ownerEmail(c.env)].filter(Boolean).includes(email)) {
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
  const { cookie, mfa } = await startSession(c, user, "auth.login");
  return ok({ role: user.role, mfaRequired: mfa }, 200, { "set-cookie": cookie });
});

// Starts a session for a person who has just proved control of their email (a sign-in link or an accepted staff
// invitation). Session fixation: any session cookie the browser already had is discarded; the new token is made here.
// Administrators with an authenticator app get a session limited to the code check until they enter a code.
export async function startSession(c: { db: D1Database; req: Request; env: Parameters<typeof policyFor>[1]; ipHash: string }, user: User, action: string) {
  const now = nowIso();
  const old = getCookie(c.req, SESSION_COOKIE);
  if (old && old.length <= 200) await deleteSession(c.db, await sha256(`s|${old}`));
  const policy = policyFor(user.role, c.env);
  const mfa = await activeFactor(c.db, user.id);
  const session = newSessionToken();
  await createSession(c.db, { token_hash: await sha256(`s|${session}`), user_id: user.id, created_at: now, expires_at: new Date(Date.now() + policy.absoluteHours * 3600_000).toISOString(),
    last_seen_at: now, user_agent: (c.req.headers.get("user-agent") || "").slice(0, 200), mfa_pending: mfa ? 1 : 0 });
  await updateUser(c.db, user.id, { last_login_at: now });
  await audit(c.db, { actor_id: user.id, action: mfa ? `${action}.mfa_pending` : action, target_type: "user", target_id: user.id, ip_hash: c.ipHash });
  return { cookie: sessionCookie(session, policy.absoluteHours * 3600), mfa: !!mfa };
}

// Stage E staff invitation: one email to one person, with a single-use link that expires. The token is passed in by the
// caller, which stores only its hash; it is never logged or returned by any API.
export function sendStaffInvitation(env: Parameters<typeof sendEmail>[0], to: { email: string; fullName: string }, token: string, roleLabel: string, expiresAt: string) {
  const site = siteUrl(env);
  const link = `${site}/app/invite/?t=${token}`;
  return sendEmail(env, {
    to: to.email,
    subject: "Your invitation to join Skill Mountain Academy staff",
    html: layout(`Dear ${esc(to.fullName.split(" ")[0])}`, `<p>Skill Mountain Academy has invited you to join its staff as <b>${esc(roleLabel)}</b>.</p>
      <p>Open the link below to review the invitation and accept or decline it. The link works once and expires on ${esc(new Date(expiresAt).toUTCString())}.</p>
      ${button(link, "Review my invitation")}
      <p style="opacity:.7;font-size:14px">If you were not expecting this, ignore this email. Nobody can join with your address without this link.</p>`,
      { headline: "You are invited", kind: "admin" }),
  });
}

publicRoute("POST", "/api/auth/logout", async (c) => {
  const t = getCookie(c.req, SESSION_COOKIE);
  if (t && t.length <= 200) await deleteSession(c.db, await sha256(`s|${t}`));
  if (c.user) await audit(c.db, { actor_id: c.user.id, action: "auth.logout", target_type: "user", target_id: c.user.id, ip_hash: c.ipHash });
  return ok({}, 200, { "set-cookie": clearCookie });
});

route("POST", "/api/auth/logout-all", ALL, async (c) => {
  await deleteUserSessions(c.db, c.user.id);
  await c.audit("auth.logout_all", "user", c.user.id);
  return ok({}, 200, { "set-cookie": clearCookie });
});

// Called by the dashboard only after a real click, key press, touch or deliberate scroll (throttled in the browser too).
// `ago` lets the browser report how long ago that action happened (0 to 30 s): the server can only move the timestamp
// BACK by it, never forward, so a late report cannot lengthen the session.
route("POST", "/api/auth/activity", ALL, async (c) => {
  if (!c.sessionHash || c.session?.legacy) return ok({ recorded: false });
  const b = await c.body<{ ago?: number }>().catch(() => ({} as { ago?: number }));
  const ago = Math.min(30_000, Math.max(0, Math.floor(Number(b.ago) || 0)));
  const at = new Date(Date.now() - ago).toISOString();
  const notAfter = new Date(Date.now() - ACTIVITY_THROTTLE_SECONDS * 1000).toISOString();
  await recordActivity(c.db, c.sessionHash, at, notAfter);
  return ok({ recorded: true, idleMinutes: c.policy?.idleMinutes ?? null });
});

route("GET", "/api/me", ALL, async (c) => {
  const s = c.session;
  const p = c.policy;
  const mfa = c.user.role === "admin" ? await activeFactor(c.db, c.user.id).catch(() => null) : null;
  return ok({
    user: selfView(c.user),
    session: s && p ? {
      idleMinutes: p.idleMinutes, now: new Date().toISOString(),
      lastActivityAt: s.legacy ? null : (s.last_activity_at ?? s.created_at),
      expiresAt: new Date(Math.min(Date.parse(s.expires_at), Date.parse(s.created_at) + p.absoluteHours * 3600_000)).toISOString(),
    } : null,
    mfa: c.user.role === "admin" ? {
      enabled: !!mfa, pending: !!s?.mfa_pending, enforced: c.env.MFA_ENFORCE_ADMINS === "true",
      setupRequired: c.env.MFA_ENFORCE_ADMINS === "true" && !s?.mfa_verified_at && !s?.legacy,
    } : null,
    admin: c.user.role === "admin" ? { role: c.user.admin_role ?? null, applied: c.effectiveAdminRole, owner: c.isOwner, areas: areasFor(c.effectiveAdminRole, c.isOwner) } : null,
  });
});
