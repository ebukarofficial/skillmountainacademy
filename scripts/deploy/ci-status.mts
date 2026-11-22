// Confirms that the release commit passed every required CI check (Stage 3B). Reads the JSON of
// `gh api repos/<owner>/<repo>/commits/<sha>/check-runs` and requires, for each required check name, that the latest run
// for that exact commit completed with conclusion "success".
//   node scripts/deploy/ci-status.mts <check-runs.json> <sha>
import { readFileSync } from "node:fs";
import { isMain } from "../db/args.mts";

export const REQUIRED_CHECKS = ["CI static checks", "CI tests", "CI build and security headers"];
type Run = { name: string; head_sha: string; app?: { slug?: string } | null; status: string; conclusion: string | null; completed_at?: string | null; started_at?: string | null };

export function ciPassed(data: { check_runs?: Run[] }, sha: string, required = REQUIRED_CHECKS): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  // Only GitHub Actions check runs count: another app with checks permission cannot satisfy a required name (Stage 3B.1).
  const runs = (data.check_runs ?? []).filter((r) => r.head_sha === sha && r.app?.slug === "github-actions");
  for (const name of required) {
    const latest = runs.filter((r) => r.name === name).sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")))[0];
    if (!latest) failures.push(`${name}: no run for ${sha.slice(0, 12)}.`);
    else if (latest.status !== "completed" || latest.conclusion !== "success") failures.push(`${name}: ${latest.status}/${latest.conclusion ?? "none"}.`);
  }
  return { ok: failures.length === 0, failures };
}

if (isMain(import.meta.url)) {
  const [file, sha] = process.argv.slice(2);
  const r = ciPassed(JSON.parse(readFileSync(file, "utf8")), sha);
  for (const f of r.failures) console.log(`REFUSED  CI ${f}`);
  console.log(r.ok ? `CI PASSED for ${sha}.` : "CI has not passed for this commit: deployment refused.");
  process.exit(r.ok ? 0 : 1);
}
