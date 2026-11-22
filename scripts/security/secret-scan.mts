// Repository secret scan (Stage 3B; run in CI and locally). Scans every tracked text file (git ls-files when the folder is
// a git checkout, otherwise every file outside build and dependency folders) for credential patterns, and refuses
// committed secret files (.env, .dev.vars, backups, private keys). Prints only file and line, never the matched value.
//   npm run security:secrets
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isMain } from "../db/args.mts";

export const PATTERNS: [string, RegExp][] = [
  ["Paystack secret key", /\bsk_(live|test)_[A-Za-z0-9]{10,}/],
  ["Paystack live public key in source", /\bpk_live_[A-Za-z0-9]{10,}/],
  ["Resend API key", /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/],
  ["Cloudflare API token (assignment)", /(CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9_-]{30,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["Slack token", /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ["generic secret assignment", /\b(MFA_ENCRYPTION_KEY|IP_HASH_SALT|OWNER_RECOVERY_TOKEN|HOLD_SIGNING_KEY|TURNSTILE_SECRET|RESEND_API_KEY|PAYSTACK_SECRET_KEY)\s*=\s*["']?(?!replace|xxx|your|<|\$|changeme|example)[A-Za-z0-9+/=_-]{16,}/],
];
// Lines that are known, documented placeholders (never real values).
// Also Cloudflare's published Turnstile TEST keys (1x000...AA), which are public by design.
const PLACEHOLDER = /x{8,}|replace-with|your-|example|placeholder|<[^>]+>|\b[12]x0{16,}AA\b/i;
const FORBIDDEN_FILES = [/^\.env(\..+)?$/, /^\.dev\.vars$/, /(^|\/)backups\//, /\.sql\.enc$/, /\.pem$/, /(^|\/)wrangler\.local\.jsonc$/];
const ALLOWED_FILES = [/^\.env\.example$/, /^\.dev\.vars\.example$/, /^db\/keys\/owner-backup-public\.pem$/];
const SKIP_DIRS = new Set(["node_modules", ".next", "out", ".wrangler", ".git", "dist", "coverage"]);
const BINARY = /\.(png|jpe?g|webp|gif|ico|mp4|woff2?|ttf|zip|pdf)$/i;

export type Finding = { file: string; line: number; kind: string };

function listFiles(root: string): string[] {
  if (existsSync(join(root, ".git"))) {
    try { return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean); } catch { /* fall through */ }
  }
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (SKIP_DIRS.has(n)) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p); else out.push(relative(root, p));
    }
  };
  walk(root);
  return out;
}

export function scan(root: string, files = listFiles(root)): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    const rel = f.split("\\").join("/");
    if (FORBIDDEN_FILES.some((re) => re.test(rel)) && !ALLOWED_FILES.some((re) => re.test(rel))) { findings.push({ file: rel, line: 0, kind: "secret-bearing file must not be in the repository" }); continue; }
    if (BINARY.test(rel)) continue;
    let text: string;
    try { text = readFileSync(join(root, rel), "utf8"); } catch { continue; }
    if (text.includes("\0")) continue;
    text.split("\n").forEach((line, i) => {
      for (const [kind, re] of PATTERNS) {
        const m = line.match(re);
        if (m && !PLACEHOLDER.test(m[0])) findings.push({ file: rel, line: i + 1, kind });
      }
    });
  }
  return findings;
}

if (isMain(import.meta.url)) {
  const f = scan(process.cwd());
  for (const x of f) console.log(`FOUND  ${x.file}${x.line ? `:${x.line}` : ""}  ${x.kind}`);
  console.log(f.length ? `SECRET SCAN FAILED: ${f.length} finding(s).` : "SECRET SCAN PASSED.");
  process.exit(f.length ? 1 : 0);
}
