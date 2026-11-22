// Content Security Policy generated from the REAL static build (Stage 2, audit finding F2). Runs after `next build`
// (npm "postbuild") and appends one rule per HTML page to out/_headers.
//
// How it works: Next.js writes a few inline <script> blocks into every page (at most 3 today). Each executable inline
// script is hashed (SHA-256) and only those exact scripts are allowed on that page: no 'unsafe-inline' and no
// 'unsafe-eval' for scripts. External scripts are limited to this site, Cloudflare Turnstile and, on the two payment
// pages only, Paystack's inline checkout script.
//
// Mode (env CSP_MODE at build time):
//   "report"  (default) -> Content-Security-Policy-Report-Only, violations sent to /api/csp-report. Use for the first
//                          production deployment to catch anything Cloudflare injects at the zone level.
//   "enforce"           -> Content-Security-Policy (blocks). Switch after a clean report period.
// The existing enforced baseline in public/_headers (frame-ancestors, base-uri, object-src, form-action) is kept in both
// modes; two policies are both applied by browsers, so the baseline is never weakened.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "out";
const MODE = (process.argv.find((a) => a.startsWith("--mode="))?.slice(7) ?? process.env.CSP_MODE ?? "report") === "enforce" ? "enforce" : "report";
const HEADER = MODE === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

const TURNSTILE = "https://challenges.cloudflare.com";
// Paystack's legacy inline checkout (only used when NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY is set) needs these on payment pages.
const PAYSTACK = { script: "https://js.paystack.co", frame: "https://checkout.paystack.com", connect: "https://api.paystack.co" };
// The legacy Google Form / Apps Script fallback of the checkout (only when the server backend is unavailable).
const LEGACY_FORMS = ["https://docs.google.com", "https://script.google.com", "https://script.googleusercontent.com"];
const PAYMENT_PAGE = (route: string) => route === "/checkout/" || route.startsWith("/programmes/");

export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    if (/\bsrc\s*=/.test(attrs)) continue;
    const type = attrs.match(/\btype\s*=\s*"([^"]*)"/i)?.[1]?.toLowerCase();
    // Data blocks (JSON-LD) are not executed, so they need no hash.
    if (type && !["text/javascript", "module", "application/javascript"].includes(type)) continue;
    out.push(`'sha256-${createHash("sha256").update(m[2], "utf8").digest("base64")}'`);
  }
  return [...new Set(out)];
}

export function policyFor(route: string, hashes: string[]): string {
  const pay = PAYMENT_PAGE(route);
  const d: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", ...hashes, TURNSTILE, ...(pay ? [PAYSTACK.script] : [])]],
    // React writes style="" attributes (101 in the current build); style attributes cannot run code.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:"]],
    ["font-src", ["'self'", "data:"]],
    ["media-src", ["'self'"]],
    ["connect-src", ["'self'", ...(route === "/checkout/" ? [PAYSTACK.connect, ...LEGACY_FORMS] : [])]],
    ["frame-src", [TURNSTILE, ...(pay ? [PAYSTACK.frame] : [])]],
    ["worker-src", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ["form-action", ["'self'"]],
    ["upgrade-insecure-requests", []],
    ["report-uri", ["/api/csp-report"]],
  ];
  return d.map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k)).join("; ");
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? htmlFiles(p) : n.endsWith(".html") ? [p] : [];
  });
}

// out/about/index.html -> /about/ ; out/index.html -> / ; out/404.html -> skipped (served for unknown paths).
export function routeOf(file: string, out = OUT): string | null {
  const rel = relative(out, file).split(sep).join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"index.html".length)}`;
  return null;
}

export function buildRules(out = OUT): { route: string; policy: string; hashes: number }[] {
  return htmlFiles(out).flatMap((f) => {
    const route = routeOf(f, out);
    if (!route) return [];
    const hashes = inlineScriptHashes(readFileSync(f, "utf8"));
    return [{ route, policy: policyFor(route, hashes), hashes: hashes.length }];
  }).sort((a, b) => a.route.localeCompare(b.route));
}

if (process.argv[1]?.endsWith("csp.mts")) {
  const rules = buildRules();
  const file = join(OUT, "_headers");
  const base = readFileSync(file, "utf8").split("\n# ---- Content Security Policy (generated")[0].trimEnd();
  const block = [`\n\n# ---- Content Security Policy (generated by scripts/csp.mts, mode: ${MODE}). Do not edit by hand. ----`,
    ...rules.map((r) => `${r.route}\n  ${HEADER}: ${r.policy}`)].join("\n");
  writeFileSync(file, `${base}${block}\n`);
  const longest = Math.max(...rules.map((r) => r.policy.length));
  if (rules.length > 90) throw new Error(`Too many header rules for Cloudflare (${rules.length})`);
  if (longest > 1900) throw new Error(`A policy is too long for one header line (${longest})`);
  console.log(`CSP (${MODE}): ${rules.length} pages, up to ${Math.max(...rules.map((r) => r.hashes))} inline scripts each, longest policy ${longest} characters.`);
}
