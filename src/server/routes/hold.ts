// Timed price hold. Dormant: it only does anything for a programme whose timedPrice is set in lib/config.ts.
// GET /api/hold?p=<slug> starts a 48-minute hold the first time a visitor opens that programme, issues a signed
// HttpOnly cookie, and records the hold in D1 so it survives refreshes and revisits. A visitor cannot start it
// again for 7 days (checked against D1 by visitor cookie AND network address, so clearing cookies does not help).
import { findProgramme, type Programme } from "../../../lib/config.ts";
import type { AppEnv } from "../env";
import { ApiError, clientIp, getCookie, json, sha256 } from "../http";
import { Repo, type HoldRow } from "../repo";

export const HOLD_MINUTES = 48;
export const COOLDOWN_DAYS = 7;
const VID = "sma_vid";
const holdCookie = (slug: string) => `sma_hold_${slug.replace(/[^a-z0-9-]/g, "")}`;

const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data))));
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export async function sign(key: string, value: string) { return `${value}.${await hmac(key, value)}`; }
export async function unsign(key: string, token: string | null): Promise<string | null> {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const value = token.slice(0, i);
  return safeEqual(token.slice(i + 1), await hmac(key, value)) ? value : null;
}

const cookie = (name: string, value: string, maxAge: number) => `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

// The hold this request carries, if it is valid and has not expired. Used by checkout to price the order.
export async function activeHoldFor(req: Request, env: AppEnv, repo: Repo, p: Programme): Promise<HoldRow | null> {
  if (p.timedPrice == null || !env.HOLD_SIGNING_KEY) return null;
  const id = await unsign(env.HOLD_SIGNING_KEY, getCookie(req, holdCookie(p.slug)));
  if (!id) return null;
  const h = await repo.getHoldById(id);
  if (!h || h.programme_slug !== p.slug) return null;
  return Date.parse(h.expires_at) > Date.now() ? h : null;
}

export async function handleHold(req: Request, env: AppEnv): Promise<Response> {
  const p = findProgramme(new URL(req.url).searchParams.get("p"));
  if (!p) throw new ApiError(404, "not_found", "Unknown programme.");
  const regular = p.price;
  // No timed offer for this programme: nothing to do, no database access.
  if (p.timedPrice == null) return json({ ok: true, offer: false, active: false, price: regular });
  if (!env.HOLD_SIGNING_KEY || !env.DB) return json({ ok: true, offer: false, active: false, price: regular, reason: "not_configured" });

  const repo = new Repo(env.DB);
  const key = env.HOLD_SIGNING_KEY;
  const headers = new Headers();
  let vid = await unsign(key, getCookie(req, VID));
  if (!vid) {
    vid = crypto.randomUUID();
    headers.append("set-cookie", cookie(VID, await sign(key, vid), 60 * 60 * 24 * 400));
  }
  const visitorHash = await sha256(`v|${vid}`);
  const ipHash = await sha256(`${clientIp(req)}|${key}`);
  const now = Date.now();
  const respond = (h: HoldRow | null, ended: boolean) => {
    const active = !!h && Date.parse(h.expires_at) > now;
    return json({
      ok: true, offer: true, active, ended: ended && !active, price: active ? p.timedPrice : regular, regularPrice: regular,
      timedPrice: p.timedPrice, endsAt: active ? h!.expires_at : null, serverNow: new Date(now).toISOString(),
    }, 200, headers);
  };

  let h = await repo.getHold(visitorHash, p.slug);
  if (h && Date.parse(h.cooldown_until) > now) {
    if (Date.parse(h.expires_at) > now) headers.append("set-cookie", cookie(holdCookie(p.slug), await sign(key, h.id), Math.ceil((Date.parse(h.expires_at) - now) / 1000)));
    return respond(h, true);
  }
  // Same network address had this offer recently (for example after clearing cookies): do not restart it.
  const byIp = await repo.latestHoldForIp(ipHash, p.slug);
  if (byIp && Date.parse(byIp.cooldown_until) > now) {
    const active = Date.parse(byIp.expires_at) > now;
    if (active) headers.append("set-cookie", cookie(holdCookie(p.slug), await sign(key, byIp.id), Math.ceil((Date.parse(byIp.expires_at) - now) / 1000)));
    return respond(byIp, true);
  }

  const start = new Date(now);
  const fresh: HoldRow = {
    id: crypto.randomUUID(), visitor_hash: visitorHash, ip_hash: ipHash, programme_slug: p.slug, started_at: start.toISOString(),
    expires_at: new Date(now + HOLD_MINUTES * 60_000).toISOString(), cooldown_until: new Date(now + COOLDOWN_DAYS * 86400_000).toISOString(),
  };
  await repo.upsertHold(fresh);
  h = await repo.getHold(visitorHash, p.slug); // re-read: a parallel request may have won
  if (h) headers.append("set-cookie", cookie(holdCookie(p.slug), await sign(key, h.id), HOLD_MINUTES * 60));
  return respond(h, false);
}
