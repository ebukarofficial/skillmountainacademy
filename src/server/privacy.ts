// IP pseudonymisation (Stage 2, audit finding F5). Client IP addresses are never stored; records and rate limits keep an
// HMAC-SHA256 of the address under a secret key, so the value cannot be reversed by hashing every IPv4 address.
//
// Key, in order of preference:
//   1. IP_HASH_SALT (a Wrangler secret used for nothing else);
//   2. a random 32-byte key generated once and kept in KV (`sec:ip-hash-key`), so hashes stay stable across isolates;
//   3. a random key held in this isolate's memory only (hashes then differ between isolates; rate limits get weaker but
//      nothing becomes predictable).
// There is NO constant fallback. The key never leaves the Worker and is never logged.
import type { AppEnv } from "./env";

const KV_KEY = "sec:ip-hash-key";
let cached: { id: string; key: CryptoKey } | null = null;
let ephemeral: string | null = null;

const randomB64 = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

async function keyMaterial(env: AppEnv): Promise<{ id: string; raw: string; source: "secret" | "kv" | "ephemeral" }> {
  if (env.IP_HASH_SALT && env.IP_HASH_SALT.length >= 16) return { id: "secret", raw: env.IP_HASH_SALT, source: "secret" };
  if (env.KV) {
    try {
      let v = await env.KV.get(KV_KEY);
      if (!v) { v = randomB64(); await env.KV.put(KV_KEY, v); }
      return { id: "kv", raw: v, source: "kv" };
    } catch { /* fall through to the in-memory key */ }
  }
  ephemeral ??= randomB64();
  return { id: "ephemeral", raw: ephemeral, source: "ephemeral" };
}

export async function ipPseudonym(env: AppEnv, ip: string): Promise<string> {
  const m = await keyMaterial(env);
  if (!cached || cached.id !== `${m.id}:${m.raw.length}:${m.raw.slice(0, 4)}`) {
    cached = { id: `${m.id}:${m.raw.length}:${m.raw.slice(0, 4)}`, key: await crypto.subtle.importKey("raw", new TextEncoder().encode(m.raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) };
  }
  const sig = await crypto.subtle.sign("HMAC", cached.key, new TextEncoder().encode(`ip|${ip}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Which key source is in use (for the admin platform status; never the key itself).
export const ipKeySource = async (env: AppEnv) => (await keyMaterial(env)).source;
