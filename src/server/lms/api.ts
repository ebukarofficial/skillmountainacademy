// The learning platform's request framework: routes with :params, role checks on the SERVER for every
// /api/app/* call, same-origin checks on every change, JSON helpers and the audit trail.
import type { AppEnv } from "../env";
import { ApiError, clientIp, getCookie, json, nowIso, readJson, sameOrigin, sha256 } from "../http";
import { audit, canSignIn, logError, sessionUser, touchSession, type Role, type User } from "./data/users";

export type Ctx = {
  req: Request; env: AppEnv; exec: ExecutionContext; url: URL; params: Record<string, string>;
  user: User; db: D1Database; ipHash: string; body: <T = Record<string, unknown>>() => Promise<T>;
  audit: (action: string, target_type?: string, target_id?: string, detail?: unknown) => Promise<unknown>;
};
type PublicCtx = Omit<Ctx, "user" | "audit"> & { user: User | null };
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type Route = { method: Method; parts: string[]; roles: Role[] | "public"; handler: (c: Ctx) => Promise<Response> };

const routes: Route[] = [];
export const ALL: Role[] = ["student", "instructor", "admin"];
export function route(method: Method, path: string, roles: Role[] | "public", handler: (c: Ctx) => Promise<Response>) {
  routes.push({ method, parts: path.split("/").filter(Boolean), roles, handler });
}
export const publicRoute = (method: Method, path: string, handler: (c: PublicCtx) => Promise<Response>) => route(method, path, "public", handler as (c: Ctx) => Promise<Response>);

export const SESSION_COOKIE = "sma_session";
export const SESSION_DAYS = 30;

export async function currentUser(req: Request, db: D1Database): Promise<User | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token || token.length > 200) return null;
  const hash = await sha256(`s|${token}`);
  const now = nowIso();
  const u = await sessionUser(db, hash, now);
  if (!u || !canSignIn(u)) return null;
  // Sliding expiry, written at most once a day per session to save database writes.
  if (Date.now() - Date.parse(u.s_last_seen_at) > 86400_000) await touchSession(db, hash, now, new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString());
  const { s_expires_at: _e, s_last_seen_at: _l, ...user } = u;
  void _e; void _l;
  return user as User;
}

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
  const ipHash = await sha256(`${clientIp(req)}|${env.HOLD_SIGNING_KEY || "sma"}`);
  const user = await currentUser(req, db);
  if (found.r.roles !== "public") {
    if (!user) throw new ApiError(401, "unauthenticated", "Please sign in.");
    if (!found.r.roles.includes(user.role)) throw new ApiError(403, "forbidden", "You do not have access to this.");
  }
  let cached: unknown;
  const c = {
    req, env, exec, url, params: found.params, user: user as User, db, ipHash,
    body: async <T,>() => (cached ??= await readJson(req, 160_000)) as T, // fits a 60,000-character material text
    audit: (action: string, target_type?: string, target_id?: string, detail?: unknown) => audit(db, { actor_id: user?.id ?? null, action, target_type, target_id, detail, ip_hash: ipHash }),
  } as Ctx;
  try {
    return await found.r.handler(c);
  } catch (e) {
    if (!(e instanceof ApiError)) exec.waitUntil(logError(db, url.pathname, String((e as Error)?.stack ?? e)).catch(() => undefined));
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
