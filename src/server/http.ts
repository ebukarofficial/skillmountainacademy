// Small HTTP helpers shared by every route.
export class ApiError extends Error {
  status: number;
  code: string;
  headers?: HeadersInit;
  constructor(status: number, code: string, message: string, headers?: HeadersInit) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const BASE_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

export function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  const h = new Headers(BASE_HEADERS);
  new Headers(extra).forEach((v, k) => (k === "set-cookie" ? h.append(k, v) : h.set(k, v)));
  return new Response(JSON.stringify(data), { status, headers: h });
}

export const fail = (e: ApiError) => json({ ok: false, error: e.code, message: e.message }, e.status, e.headers ?? {});

export const notConfigured = (what: string) =>
  new ApiError(503, "not_configured", `${what} is not set up yet. Please contact us on WhatsApp or email admission@skillmountainacademy.com and we will register you.`);

// Reads a JSON body of at most `max` bytes.
export async function readJson<T = Record<string, unknown>>(req: Request, max = 20_000): Promise<T> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > max) throw new ApiError(413, "too_large", "That request is too large.");
  const text = await req.text();
  if (text.length > max) throw new ApiError(413, "too_large", "That request is too large.");
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as T;
  } catch {
    throw new ApiError(400, "bad_json", "The request could not be read.");
  }
}

// Blocks form posts from other websites (CSRF). Browsers always send Origin on POST.
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}

export const clientIp = (req: Request) => req.headers.get("cf-connecting-ip") || "0.0.0.0";

export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const nowIso = () => new Date().toISOString();

export function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

// Uppercase letters and digits, from the crypto random source.
export function randomCode(len: number): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => abc[b % abc.length]).join("");
}
