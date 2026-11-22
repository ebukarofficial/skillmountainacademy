// TOTP (RFC 6238: HMAC-SHA1, 6 digits, 30-second steps) and secret protection for administrator two-step sign-in.
// Pure Web Crypto API: no dependencies, works the same in the Worker and in tests.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
export const DIGITS = 6;
export const WINDOW = 1; // accept the previous and next step too (clock drift of up to 30 seconds)

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export const newTotpSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20))); // 160 bits

export async function totpAt(secretB32: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", base32Decode(secretB32), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8);
  let n = step;
  for (let i = 7; i >= 0; i--) { msg[i] = n & 255; n = Math.floor(n / 256); }
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const stepOf = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

// Returns the matching step, or null. A step at or before lastStep is refused, so a code cannot be replayed.
export async function verifyTotp(secretB32: string, code: string, nowMs: number, lastStep: number | null): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepOf(nowMs);
  let hit: number | null = null;
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const s = now + d;
    // Compare every candidate (no early exit) so timing does not reveal which step matched.
    if ((await totpAt(secretB32, s)) === code && (lastStep === null || s > lastStep)) hit = s;
  }
  return hit;
}

export const otpauthUrl = (secretB32: string, account: string, issuer = "Skill Mountain Academy") =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

// ---- secret encryption at rest (AES-256-GCM with MFA_ENCRYPTION_KEY) ----
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(keyB64: string | undefined): Promise<CryptoKey | null> {
  if (!keyB64) return null;
  let raw: Uint8Array;
  try { raw = unb64(keyB64.trim()); } catch { return null; }
  if (raw.length !== 32) return null;
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export const mfaKeyUsable = async (keyB64: string | undefined) => (await aesKey(keyB64)) !== null;

export async function encryptSecret(keyB64: string | undefined, plain: string): Promise<string> {
  const key = await aesKey(keyB64);
  if (!key) throw new Error("MFA_ENCRYPTION_KEY missing or not 32 bytes");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}
export async function decryptSecret(keyB64: string | undefined, enc: string): Promise<string> {
  const key = await aesKey(keyB64);
  if (!key) throw new Error("MFA_ENCRYPTION_KEY missing or not 32 bytes");
  const [v, iv, ct] = enc.split(":");
  if (v !== "v1" || !iv || !ct) throw new Error("unknown secret format");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct)));
}

// ---- recovery codes: 10 codes of 12 base32 characters (60 bits each), shown once, stored as hashes ----
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(crypto.getRandomValues(new Uint8Array(8))).slice(0, 12);
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  });
}
export const normaliseRecovery = (s: string) => s.toUpperCase().replace(/[^A-Z2-7]/g, "");
export async function hashRecovery(code: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`rc|${normaliseRecovery(code)}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
