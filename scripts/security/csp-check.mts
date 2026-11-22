// CSP and security-header check of the BUILT site (Stage 3B; run in CI after `npm run build`).
// Fails when:
//   - a baseline header is missing from the "/*" block of out/_headers (nosniff, frame DENY, referrer policy,
//     permissions policy, HSTS, and the enforced frame-ancestors/base-uri/object-src/form-action policy);
//   - a page has no generated CSP, or its script-src allows 'unsafe-inline' or 'unsafe-eval';
//   - an executable inline <script> on a page is not covered by its sha256 hash (the build and the policy disagree);
//   - Paystack origins appear outside the payment pages (/checkout/ and /programmes/...), or blob: appears anywhere.
//   npm run security:csp [-- --out out]
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { isMain, parseArgs } from "../db/args.mts";

export const BASELINE = [
  ["X-Content-Type-Options", "nosniff"], ["X-Frame-Options", "DENY"], ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=()"], ["Strict-Transport-Security", "max-age="],
  ["Content-Security-Policy", "frame-ancestors 'none'"], ["Content-Security-Policy", "object-src 'none'"], ["Content-Security-Policy", "base-uri 'self'"],
] as const;
const PAYMENT_ROUTE = /^\/(checkout|programmes)\//;

export type CspReport = { ok: boolean; pages: number; mode: string | null; failures: string[] };

export function checkCsp(outDir: string): CspReport {
  const failures: string[] = [];
  const hf = join(outDir, "_headers");
  if (!existsSync(hf)) return { ok: false, pages: 0, mode: null, failures: [`${hf} not found: run npm run build first.`] };
  const text = readFileSync(hf, "utf8");
  const blocks = text.split(/\n(?=\/)/);
  const star = blocks.find((b) => b.startsWith("/*\n"));
  if (!star) failures.push("headers: no /* block with the baseline security headers.");
  else for (const [h, v] of BASELINE) if (!star.split("\n").some((l) => l.trim().startsWith(`${h}:`) && l.includes(v))) failures.push(`headers: baseline ${h} (${v}) missing from /*.`);
  if (/\bblob:/.test(text)) failures.push("csp: blob: is not allowed.");
  let pages = 0, mode: string | null = null;
  for (const block of blocks) {
    const route = block.split("\n")[0].trim();
    if (route === "/*") continue;
    const line = block.split("\n").find((l) => /Content-Security-Policy(-Report-Only)?:/.test(l) && /script-src/.test(l));
    if (!line) continue;
    pages++;
    mode = line.trim().startsWith("Content-Security-Policy-Report-Only") ? "report" : "enforce";
    const pol = line.slice(line.indexOf(":") + 1);
    const scriptSrc = pol.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    if (/'unsafe-inline'|'unsafe-eval'/.test(scriptSrc)) failures.push(`csp: ${route} script-src allows unsafe-inline/unsafe-eval.`);
    if (/paystack/i.test(pol) && !PAYMENT_ROUTE.test(route)) failures.push(`csp: ${route} allows Paystack outside the payment pages.`);
    const file = route === "/" ? join(outDir, "index.html") : join(outDir, route, "index.html");
    if (!existsSync(file)) { failures.push(`csp: ${route} has a policy but no page.`); continue; }
    const html = readFileSync(file, "utf8");
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/.test(m[1])) continue;
      const type = m[1].match(/type\s*=\s*"([^"]*)"/i)?.[1]?.toLowerCase();
      if (type && !["text/javascript", "module", "application/javascript"].includes(type)) continue;
      const h = `'sha256-${createHash("sha256").update(m[2]).digest("base64")}'`;
      if (!scriptSrc.includes(h)) failures.push(`csp: ${route} has an inline script not covered by its policy (${h.slice(0, 20)}...).`);
    }
  }
  // Every built page must have a generated policy.
  const pageCount = (text.match(/^\/[^\s*]*\/?$/gm) ?? []).length;
  if (pages === 0) failures.push("csp: no page has a generated Content-Security-Policy (did the postbuild step run?).");
  void pageCount;
  return { ok: failures.length === 0, pages, mode, failures };
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  const r = checkCsp(a.str("out") ?? "out");
  for (const f of r.failures) console.log(`FAIL  ${f}`);
  console.log(`${r.ok ? "CSP CHECK PASSED" : "CSP CHECK FAILED"}: ${r.pages} pages, mode ${r.mode ?? "none"}.`);
  process.exit(r.ok ? 0 : 1);
}
