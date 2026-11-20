// Runs the real Worker (src/worker.ts) in Miniflare (the same runtime as Cloudflare) with a local D1 database and
// KV namespace. Every outbound request (Turnstile, Paystack, Resend, Google Sheet, FX) is answered by a mock and recorded.
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers.ts";

const builds = new Map<string, Promise<string>>();
// `patch` is extra code appended to lib/config.ts in the test bundle only, for example to give a programme a
// timed price or switch a flag on. The real config file is never changed.
function bundle(patch = ""): Promise<string> {
  mkdirSync(join(ROOT, ".wrangler", "test"), { recursive: true });
  const out = join(ROOT, ".wrangler", "test", `worker-${builds.size}.mjs`);
  if (builds.has(patch)) return builds.get(patch)!;
  const configPath = join(ROOT, "lib", "config.ts");
  const p = build({
    entryPoints: [join(ROOT, "src/worker.ts")], bundle: true, format: "esm", platform: "neutral", target: "es2022", outfile: out,
    plugins: [{ name: "patch-config", setup(b) { b.onLoad({ filter: /lib[\\/]config\.ts$/ }, (a) => (a.path === configPath ? { contents: readFileSync(configPath, "utf8") + "\n" + patch, loader: "ts" } : undefined)); } }],
    conditions: ["workerd", "worker", "browser"], logLevel: "silent",
    define: { "process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY": '""', "process.env.NEXT_PUBLIC_SHEET_URL": '""', "process.env.NEXT_PUBLIC_WHATSAPP": '""', "process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY": '""' },
  }).then(() => out);
  builds.set(patch, p);
  return p;
}

export type Call = { url: string; method: string; headers: Record<string, string>; body: string };
export type Mock = (req: Request, body: string) => Response | Promise<Response> | undefined;

export const SECRETS = {
  TURNSTILE_SECRET: "ts-secret", PAYSTACK_SECRET_KEY: "sk_test_secret", RESEND_API_KEY: "re_test", HOLD_SIGNING_KEY: "hold-key-0123456789",
  SHEET_WEBHOOK_URL: "https://script.google.com/macros/s/TEST/exec",
};
export const SITE = "https://skillmountainacademy.com";

// Default answers from the outside world. Tests can override per call with `mock`.
export function defaultMock(req: Request, body: string): Response {
  const u = new URL(req.url);
  if (u.host === "challenges.cloudflare.com") return Response.json({ success: new URLSearchParams(body).get("response") === "good-token" || body.includes("good-token") });
  if (u.host === "api.resend.com") return Response.json({ id: "email_1" });
  if (u.host === "script.google.com") return new Response("ok");
  if (u.host === "open.er-api.com") return Response.json({ result: "success", rates: { NGN: 1, USD: 0.00069, GBP: 0.00052, EUR: 0.0006 } });
  if (u.host === "api.paystack.co" && u.pathname === "/transaction/initialize") {
    const j = JSON.parse(body);
    return Response.json({ status: true, data: { authorization_url: `https://checkout.paystack.com/${j.reference}`, access_code: "AC_" + j.reference, reference: j.reference } });
  }
  return new Response("not mocked", { status: 599 });
}

export async function startWorker(opts: { env?: Record<string, string>; db?: boolean; kv?: boolean; mock?: Mock; patch?: string } = {}) {
  const scriptPath = await bundle(opts.patch);
  const calls: Call[] = [];
  // Miniflare 5 (bundled with Wrangler 4.156) takes the classic option shape through convertV4MiniflareOptions.
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath, compatibilityDate: "2026-10-01",
    d1Databases: opts.db === false ? undefined : { DB: "test-db-" + crypto.randomUUID() },
    kvNamespaces: opts.kv === false ? undefined : { KV: "test-kv-" + crypto.randomUUID() },
    bindings: { SITE_URL: SITE, ADMIN_EMAILS: "owner@example.com", AI_MODEL: "@cf/test/model", ADMIN_EMAIL: "admin@example.com", EMAIL_FROM: "SMA <admission@skillmountainacademy.com>", CLASS_BOOKING_URL: "", ...(opts.env ?? SECRETS) },
    serviceBindings: { ASSETS: () => new Response("static site") },
    outboundService: async (req: Request) => {
      const body = await req.text();
      calls.push({ url: req.url, method: req.method, headers: Object.fromEntries(req.headers), body });
      return (await opts.mock?.(req, body)) ?? defaultMock(req, body);
    },
  }));
  if (opts.db !== false) {
    const db = await mf.getD1Database("DB");
    for (const f of readdirSync(join(ROOT, "migrations")).filter((n) => n.endsWith(".sql")).sort()) {
      const sql = readFileSync(join(ROOT, "migrations", f), "utf8").replace(/^\s*--.*$/gm, "");
      const stmts = sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
      await db.batch(stmts.map((s) => db.prepare(s)));
    }
  }
  const fetchApi = (path: string, init: RequestInit & { cf?: Record<string, unknown> } = {}) => {
    const headers = new Headers(init.headers);
    if (init.method === "POST" && !headers.has("origin")) headers.set("origin", SITE);
    if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", "203.0.113.7");
    return mf.dispatchFetch(`${SITE}${path}`, { ...init, headers } as never);
  };
  const post = (path: string, data: unknown, headers: Record<string, string> = {}) =>
    fetchApi(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(data) });
  // Waits for background work (ctx.waitUntil) to make the expected outbound calls.
  const waitFor = async (pred: (c: Call[]) => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (pred(calls)) return true; await new Promise((r) => setTimeout(r, 25)); }
    return pred(calls);
  };
  const db = () => mf.getD1Database("DB");
  return { mf, calls, fetchApi, post, waitFor, db, dispose: () => mf.dispose() };
}

export function learner(over: Record<string, unknown> = {}) {
  return {
    firstName: "Ada", middleName: "", surname: "Obi", adult: "Yes", country: "Nigeria", city: "Abuja", english: "Good",
    phone: "+234 706 100 0472", email: "ada@example.com", education: "Tertiary", computerLiterate: "Yes", background: "No",
    why: "I like cloud", goals: "Become a cloud engineer", industry: "Tech", ...over,
  };
}

export function registration(over: Record<string, unknown> = {}) {
  return { programme: "cloud", plan: "full", method: "paystack", currency: "NGN", termsAccepted: true, termsVersion: "2026-10c", turnstileToken: "good-token", learner: learner(), ...over };
}
