// Compares two backup manifests (Stage 3A). Used to verify a restore into a SEPARATE REMOTE database, which these tools
// cannot read back directly: take a fresh read-only backup of the restored database and compare its manifest with the
// manifest of the backup that was imported. Manifests hold no data values, so this comparison can be shared.
//   npm run db:compare -- <original.manifest.json> <restored.manifest.json>               (phase A: must be IDENTICAL)
//   npm run db:compare -- <original.manifest.json> <after-reset.manifest.json> --post-reset (phase B: only expected changes)
// Identical means: same migration version, same schema (tables, indexes, triggers), and every table has the same row
// count and the same SHA-256 of its rows.
import { readFileSync } from "node:fs";
import { isMain } from "./args.mts";
import type { Manifest } from "./dump.mts";
import { compareSchema } from "./restore.mts";

export type Comparison = { identical: boolean; differences: string[] };

export function compareManifests(a: Manifest, b: Manifest, opts: { ignoreTables?: string[] } = {}): Comparison {
  const differences: string[] = [];
  const ignore = new Set(opts.ignoreTables ?? []);
  if (a.migration.latest !== b.migration.latest) differences.push(`migration: ${a.migration.latest ?? "none"} vs ${b.migration.latest ?? "none"}`);
  const d = compareSchema(b.schema, a.schema);
  for (const k of d.missing) differences.push(`schema: ${k} missing`);
  for (const k of d.extra) differences.push(`schema: ${k} extra`);
  for (const k of d.changed) differences.push(`schema: ${k} differs`);
  for (const name of new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])) {
    if (ignore.has(name)) continue;
    const x = a.tables[name], y = b.tables[name];
    if (!x || !y) { differences.push(`table ${name}: ${x ? "missing" : "extra"} in the restored database`); continue; }
    if (x.rows !== y.rows) differences.push(`table ${name}: ${x.rows} rows vs ${y.rows}`);
    else if (x.sha256 !== y.sha256) differences.push(`table ${name}: same row count, different content`);
  }
  return { identical: differences.length === 0, differences };
}

// Phase B of a restore (runbook section 6.2): after the post-restore security reset, the restored database must differ
// from the backup ONLY in the intended ways. Everything else must still be identical.
//   auth_sessions  any rows -> 0 rows
//   auth_tokens    same number of rows (unused links now marked used; content may differ)
//   audit_log      exactly one more row (the system.restore entry; existing entries untouched is shown by the database
//                  triggers and by checking the old rows separately, see the runbook)
export const RESET_TABLES = ["auth_sessions", "auth_tokens", "audit_log"];
export function verifyPostReset(original: Manifest, after: Manifest): { ok: boolean; expected: string[]; unexpected: string[] } {
  const expected: string[] = [], unexpected: string[] = [];
  const base = compareManifests(original, after, { ignoreTables: RESET_TABLES });
  unexpected.push(...base.differences);
  const t = (m: Manifest, n: string) => m.tables[n];
  const s0 = t(original, "auth_sessions"), s1 = t(after, "auth_sessions");
  if (!s1) unexpected.push("auth_sessions is missing");
  else if (s1.rows !== 0) unexpected.push(`auth_sessions still has ${s1.rows} rows (expected 0)`);
  else expected.push(`auth_sessions: ${s0?.rows ?? 0} -> 0 rows (sessions ended)`);
  const k0 = t(original, "auth_tokens"), k1 = t(after, "auth_tokens");
  if (!k0 || !k1 || k0.rows !== k1.rows) unexpected.push(`auth_tokens: ${k0?.rows ?? "?"} rows vs ${k1?.rows ?? "?"} (expected the same number)`);
  else expected.push(`auth_tokens: ${k1.rows} rows, unused links invalidated${k0.sha256 === k1.sha256 ? " (none were unused)" : ""}`);
  const a0 = t(original, "audit_log"), a1 = t(after, "audit_log");
  if (!a0 || !a1 || a1.rows !== a0.rows + 1) unexpected.push(`audit_log: ${a0?.rows ?? "?"} -> ${a1?.rows ?? "?"} rows (expected exactly one more: the system.restore entry)`);
  else expected.push(`audit_log: ${a0.rows} -> ${a1.rows} rows (restore recorded)`);
  return { ok: unexpected.length === 0, expected, unexpected };
}

if (isMain(import.meta.url)) {
  const [fa, fb] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
  if (!fa || !fb) { console.error("Usage: npm run db:compare -- <original.manifest.json> <restored.manifest.json> [--ignore auth_sessions,rate_limits]"); process.exit(2); }
  const i = process.argv.indexOf("--ignore");
  const ignoreTables = i > 0 ? (process.argv[i + 1] ?? "").split(",").filter(Boolean) : [];
  if (process.argv.includes("--post-reset")) {
    const p = verifyPostReset(JSON.parse(readFileSync(fa, "utf8")), JSON.parse(readFileSync(fb, "utf8")));
    for (const x of p.expected) console.log(`EXPECTED    ${x}`);
    for (const x of p.unexpected) console.log(`UNEXPECTED  ${x}`);
    console.log(p.ok ? "POST-RESET VERIFIED: only the intended security-reset differences." : `POST-RESET NOT VERIFIED (${p.unexpected.length} unexpected difference(s)).`);
    process.exit(p.ok ? 0 : 1);
  }
  const r = compareManifests(JSON.parse(readFileSync(fa, "utf8")), JSON.parse(readFileSync(fb, "utf8")), { ignoreTables });
  for (const x of r.differences) console.log(`DIFF  ${x}`);
  console.log(r.identical ? "IDENTICAL: the restored database holds exactly the backed-up schema and records." : `NOT IDENTICAL (${r.differences.length} difference(s)).`);
  process.exit(r.identical ? 0 : 1);
}
