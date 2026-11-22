// The learning platform's request framework: routes with :params, role checks on the SERVER for every
// /api/app/* call, same-origin checks on every change, JSON helpers and the audit trail.
import type { AppEnv } from "../env";
import { ApiError, clientIp, getCookie, json, readJson, sameOrigin, sha256 } from "../http";
import { ipPseudonym } from "../privacy";
import { audit, canSignIn, deleteSession, isApproved, logError, sessionWithUser, touchSession, type Role, type SessionRow, type User } from "./data/users";
import { adminMay, areaFor, isOwner } from "./permissions";
import { mfaKeyUsable } from "./mfa-crypto";
import { MFA_PENDING_MINUTES, policyFor, type SessionPolicy } from "./session-policy";

export type Ctx = {
  req: Request; env: AppEnv; exec: ExecutionContext; url: URL; params: Record<string, string>;
  user: User; db: D1Database; ipHash: string; body: <T = Record<string, unknown>>() => Promise<T>;
  session: SessionRow | null; sessionHash: string | null; policy: SessionPolicy | null; routePath: string; isOwner: boolean;
  audit: (action: string, target_type?: string, target_id?: string, detail?: unknown) => Promise<unknown>;
};
type PublicCtx = Omit<Ctx, "user" | "audit"> & { user: User | null };
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const ONBOARDING_PATHS = /^\/api\/(me(\/photo)?|auth\/(logout|logout-all|activity)|app\/instructor\/onboarding(\/submit)?|app\/notifications(\/read)?|app\/files\/photo\/[\w-]+)$/;
type Route = { method: Method; path: string; parts: string[]; roles: Role[] | "public"; handler: (c: Ctx) => Promise<Response> };

const routes: Route[] = [];
export const ALL: Role[] = ["student", "instructor", "admin"];
export function route(method: Method, path: string, roles: Role[] | "public", handler: (c: Ctx) => Promise<Response>) {
  routes.push({ method, path, parts: path.split("/").filter(Boolean), roles, handler });
}
// Every registered route (method, path, roles), for the permission-completeness tests and the API docs.
export const routeList = () => routes.map((r) => ({ method: r.method, path: r.path, roles: r.roles }));
export const publicRoute = (method: Method, path: string, handler: (c: PublicCtx) => Promise<Response>) => route(method, path, "public", handler as (c: Ctx) => Promise<Response>);

export const SESSION_COOKIE = "sma_session";
export const SESSION_DAYS = 30; // staff default; see session-policy.ts
export const clearCookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// While a session waits for the administrator's authenticator code, only these routes answer.
const MFA_PENDING_PATHS = /^\/api\/(me|auth\/logout|auth\/mfa\/verify|auth\/owner-recovery)$/;
// An administrator who must set up two-step sign-in (MFA_ENFORCE_ADMINS) can only reach the setup routes.
const MFA_SETUP_PATHS = /^\/api\/(me|auth\/logout|auth\/logout-all|auth\/activity|auth\/mfa\/(status|setup|enable))$/;

export type Expiry = "idle" | "lifetime" | "mfa_timeout";
export type Resolved = { user: User | null; session: SessionRow | null; hash: string | null; policy: SessionPolicy | null; expired: Expiry | null; stale: boolean };

// Reads the session cookie and applies every server-side rule: absolute lifetime, the idle limit for the role (students:
// 10 minutes since the last GENUINE activity), and the time allowed to enter an authenticator code. An expired session
// is deleted at once, so the same cookie can never work again (refresh, wake from sleep or a reopened browser included).
export async function resolveSession(req: Request, env: AppEnv, db: D1Database, nowMs = Date.now()): Promise<Resolved> {
  const none: Resolved = { user: null, session: null, hash: null, policy: null, expired: null, stale: false };
  const token = getCookie(req, SESSION_COOKIE);
  if (!token || token.length > 200) return none;
  const hash = await sha256(`s|${token}`);
  const r = await sessionWithUser(db, hash);
  if (!r) return { ...none, stale: true };
  const { user, session } = r;
  if (!canSignIn(user)) { await deleteSession(db, hash); return { ...none, stale: true }; }
  const policy = policyFor(user.role, env);
  const created = Date.parse(session.created_at);
  let expired: Expiry | null = null;
  if (Date.parse(session.expires_at) <= nowMs || nowMs - created > policy.absoluteHours * 3600_000) expired = "lifetime";
  else if (session.mfa_pending && nowMs - created > MFA_PENDING_MINUTES * 60_000) expired = "mfa_timeout";
  else if (policy.idleMinutes !== null && !session.legacy) {
    const last = Date.parse(session.last_activity_at ?? session.created_at);
    if (nowMs - last > policy.idleMinutes * 60_000) expired = "idle";
  }
  if (expired) { await deleteSession(db, hash); return { ...none, expired, stale: true }; }
  // Staff sessions keep their sliding 30-day window (written at most once a day). Student sessions never slide.
  if (policy.sliding && nowMs - Date.parse(session.last_seen_at) > 86400_000)
    await touchSession(db, hash, new Date(nowMs).toISOString(), new Date(nowMs + policy.absoluteHours * 3600_000).toISOString());
  return { user, session, hash, policy, expired: null, stale: false };
}

export async function currentUser(req: Request, env: AppEnv, db: D1Database): Promise<User | null> {
  return (await resolveSession(req, env, db)).user;
}

const EXPIRED_MESSAGE: Record<Expiry, string> = {
  idle: "You were signed out because there was no activity for a while. Please request a new sign-in link.",
  lifetime: "Your session has ended. Please request a new sign-in link.",
  mfa_timeout: "The time to enter your authenticator code has passed. Please request a new sign-in link.",
};

function match(r: Route, method: string, parts: string[]): Record<string, string> | null {
  if (r.method !== method || r.parts.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = r.parts[i];
    if (p.startsWith(":")) { if (!/^[\w-]{1,64}$/.test(parts[i])) return null; params[p.slice(1)] = parts[i]; }
    else if (p !== parts[i]) return null;
  }
  return params;
}

// Returns null when no learning-platform route matches (the caller then answers 404).
export async function handleLms(req: Request, env: AppEnv, exec: ExecutionContext): Promise<Response | null> {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  let found: { r: Route; params: Record<string, string> } | null = null;
  let pathMatched = false;
  for (const r of routes) {
    const p = match(r, req.method, parts);
    if (p) { found = { r, params: p }; break; }
    if (match({ ...r, method: req.method as Method }, req.method, parts)) pathMatched = true;
  }
  if (!found) return pathMatched ? json({ ok: false, error: "method_not_allowed", message: "Method not allowed." }, 405) : null;
  if (!env.DB) throw new ApiError(503, "not_configured", "The learning platform is not set up yet.");
  if (req.method !== "GET" && !sameOrigin(req)) throw new ApiError(403, "forbidden", "Please use skillmountainacademy.com.");
  const db = env.DB;
  const ipHash = await ipPseudonym(env, clientIp(req));
  const auth = await resolveSession(req, env, db);
  const user = auth.user;
  if (found.r.roles !== "public") {
    if (!user) {
      if (auth.expired) throw new ApiError(401, "session_expired", EXPIRED_MESSAGE[auth.expired], { "set-cookie": clearCookie, "x-session-expired": auth.expired });
      throw new ApiError(401, "unauthenticated", "Please sign in.", auth.stale ? { "set-cookie": clearCookie } : undefined);
    }
    if (!found.r.roles.includes(user.role)) throw new ApiError(403, "forbidden", "You do not have access to this.");
    // Administrator two-step sign-in: a session that has not passed the authenticator code can do nothing else.
    if (auth.session?.mfa_pending && !MFA_PENDING_PATHS.test(url.pathname))
      throw new ApiError(403, "mfa_required", "Enter the code from your authenticator app to finish signing in.");
    // Two-step sign-in required: for every administrator when MFA_ENFORCE_ADMINS is on, and always for an administrator
    // whose factor was reset (users.mfa_required) until they enrol again.
    const mustEnrol = user.role === "admin" && !auth.session?.mfa_verified_at && !auth.session?.legacy && (env.MFA_ENFORCE_ADMINS === "true" || Number(user.mfa_required) === 1);
    if (mustEnrol && !MFA_SETUP_PATHS.test(url.pathname))
      throw new ApiError(403, "mfa_setup_required", "Set up two-step sign-in with an authenticator app to use administration.");
    // Administrator permission groups (default deny for scoped groups). The owner may do everything.
    const owner = isOwner(user, env);
    if (user.role === "admin" && !adminMay(user.admin_role, req.method, found.r.path, owner)) {
      // Refused administrator changes are recorded (the route, not the body), so attempts to reach powers a group lacks
      // (for example an unassigned administrator trying to assign groups) leave a trail. Refused reads are not logged.
      if (req.method !== "GET") await audit(db, { actor_id: user.id, action: "admin.access_refused", target_type: "route", target_id: found.params.id, detail: { method: req.method, route: found.r.path, area: areaFor(req.method, found.r.path), group: user.admin_role }, ip_hash: ipHash }).catch(() => undefined);
      throw new ApiError(403, "forbidden", "Your administrator role does not include this.");
    }
    // The owner console needs a session that passed the authenticator code (when two-step sign-in is configured).
    if (areaFor(req.method, found.r.path) === "owner" && !auth.session?.mfa_verified_at && !auth.session?.legacy && (await mfaKeyUsable(env.MFA_ENCRYPTION_KEY)))
      throw new ApiError(403, "owner_mfa_required", "Turn on two-step sign-in (Security) before using the owner console.");
    // An instructor awaiting verification may only complete their profile, see notices and sign out.
    if (user.role === "instructor" && !isApproved(user) && !ONBOARDING_PATHS.test(url.pathname))
      throw new ApiError(403, "awaiting_verification", "Your profile is awaiting verification. You can use the faculty workspace once the Academy approves it.");
  }
  let cached: unknown;
  const c = {
    req, env, exec, url, params: found.params, user: user as User, db, ipHash,
    session: auth.session, sessionHash: auth.hash, policy: auth.policy, routePath: found.r.path, isOwner: isOwner(user, env),
    body: async <T,>() => (cached ??= await readJson(req, 160_000)) as T, // fits a 60,000-character material text
    audit: (action: string, target_type?: string, target_id?: string, detail?: unknown) => audit(db, { actor_id: user?.id ?? null, action, target_type, target_id, detail, ip_hash: ipHash }),
  } as Ctx;
  try {
    return await found.r.handler(c);
  } catch (e) {
    if (!(e instanceof ApiError)) exec.waitUntil(logError(db, url.pathname, String((e as Error)?.stack ?? e)).catch(() => undefined));
    // A missing column or table means the database has not had its latest update: say so plainly.
    if (!(e instanceof ApiError) && /no such (column|table)|has no column named/i.test(String((e as Error)?.message ?? e)))
      throw new ApiError(503, "schema_outdated", "The database needs its latest update. Run npm run db:migrate, then try again.");
    throw e;
  }
}

// ---- small helpers for handlers ----
export const ok = (data: Record<string, unknown> = {}, status = 200, headers: HeadersInit = {}) => json({ ok: true, ...data }, status, headers);
export const notFound = (what = "That item") => new ApiError(404, "not_found", `${what} was not found.`);
export const forbidden = () => new ApiError(403, "forbidden", "You do not have access to this.");
export function page(url: URL, max = 100) {
  const limit = Math.min(max, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  return { limit, offset };
}
export const parseJsonCol = <T,>(v: string | null, fallback: T): T => { try { return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
