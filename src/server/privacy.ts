// IP pseudonymisation (Stage 2, reviewed in Stage 2B). Client IP addresses are never stored; records and rate limits keep
// an HMAC-SHA256 of the address under a secret key, so the value cannot be reversed by hashing every IPv4 address.
//
// Key, in order of preference:
//   1. IP_HASH_SALT: a Wrangler secret used for nothing else (recommended for production);
//   2. a random 32-byte key generated ONCE and stored in D1 (app_settings 'sec:ip-hash-key'). D1 has a single primary, and
//      the key is written with INSERT ... ON CONFLICT DO NOTHING and then read back, so every isolate converges on the
//      same key (Stage 2B: replaces the KV store, which is eventually consistent and could briefly hand isolates
//      different keys);
//   3. only if neither is available: a random key held in this isolate's memory. Hashes then differ between isolates,
//      which weakens rate limits and audit correlation, so it is logged as an error and shown in Admin > Security.
//      With IP_HASH_STRICT="true" this case is refused instead (fail-safe production configuration).
// There is NO constant fallback. The key never leaves the Worker and is never logged or returned by any API.
import type { AppEnv } from "./env";
import { ApiError } from "./http";

export type KeySource = "secret" | "d1" | "ephemeral";
const D1_KEY = "sec:ip-hash-key";
let cached: { source: KeySource; raw: string; key: CryptoKey } | null = null;
let ephemeral: string | null = null;
let warned = false;

export class IpKeyUnavailable extends ApiError {
  constructor(reason: string) { super(503, "not_configured", "The service is not fully configured yet. Please try again later."); this.reason = reason; }
  readonly reason: string;
}

const randomB64 = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

async function fromD1(db: D1Database): Promise<string | null> {
  try {
    await db.prepare("INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, 'system') ON CONFLICT(key) DO NOTHING")
      .bind(D1_KEY, JSON.stringify(randomB64()), new Date().toISOString()).run();
    const r = await db.prepare("SELECT value FROM app_settings WHERE key = ?1").bind(D1_KEY).first<{ value: string }>();
    return r ? (JSON.parse(r.value) as string) : null;
  } catch {
    return null; // app_settings missing (before migration 0007): fall through
  }
}

async function material(env: AppEnv): Promise<{ source: KeySource; raw: string }> {
  if (env.IP_HASH_SALT && env.IP_HASH_SALT.length >= 16) return { source: "secret", raw: env.IP_HASH_SALT };
  if (env.IP_HASH_STRICT === "true") throw new IpKeyUnavailable("IP_HASH_SALT is required (IP_HASH_STRICT is on)");
  if (env.DB) { const v = await fromD1(env.DB); if (v) return { source: "d1", raw: v }; }
  if (!warned) { warned = true; console.error("privacy: no IP_HASH_SALT and no D1 key store; using a temporary per-isolate key (rate limits weakened)"); }
  ephemeral ??= randomB64();
  return { source: "ephemeral", raw: ephemeral };
}

async function key(env: AppEnv) {
  // The secret is cheap to check every time; a D1 key is read once per isolate and then cached.
  if (cached && (cached.source !== "secret" || cached.raw === env.IP_HASH_SALT) && !(cached.source !== "secret" && env.IP_HASH_SALT && env.IP_HASH_SALT.length >= 16)) return cached;
  const m = await material(env);
  cached = { ...m, key: await crypto.subtle.importKey("raw", new TextEncoder().encode(m.raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) };
  return cached;
}

export async function ipPseudonym(env: AppEnv, ip: string): Promise<string> {
  const k = await key(env);
  const sig = await crypto.subtle.sign("HMAC", k.key, new TextEncoder().encode(`ip|${ip}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Which key source is in use (for Admin > Security and /api/status; never the key itself).
export async function ipKeySource(env: AppEnv): Promise<KeySource | "missing"> {
  try { return (await key(env)).source; } catch { return "missing"; }
}

// Tests only: forget the cached key, as a new isolate would.
export const __newIsolate = () => { cached = null; ephemeral = null; warned = false; };
