// Build-time export of the PUBLISHED programme catalogue (Expansion Stage B). Runs before every build (prebuild).
//
// Fetches GET <site>/api/catalogue, validates every field strictly, and writes lib/catalogue.published.ts. The website
// then renders exactly the published catalogue held in the database. It NEVER fails the build: if the address cannot be
// reached, answers with the bundled fallback (a database older than migration 0011), or sends anything that does not
// validate, the file is left untouched and the website uses the seed list in lib/config.ts (today's nine programmes).
//
//   SMA_CATALOGUE_EXPORT=off     skip the export (keeps the current file)
//   SMA_CATALOGUE_URL=https://…  read from another deployment (for example staging); must be https
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ALLOWED_TONES, SITE_URL } from "../lib/config.ts";
import type { CatalogueSnapshot, SnapshotProgramme, SnapshotSchool } from "../lib/catalogue-types.ts";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const OUT = join(ROOT, "lib", "catalogue.published.ts");
const SLUG = /^[a-z][a-z0-9-]{1,40}[a-z0-9]$/;

class Invalid extends Error {}
const str = (v: unknown, max: number, field: string, nullable = false): string | null => {
  if (v === null && nullable) return null;
  if (typeof v !== "string" || v.length > max) throw new Invalid(field);
  return v;
};
const int = (v: unknown, min: number, max: number, field: string, nullable = false): number | null => {
  if (v === null && nullable) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new Invalid(field);
  return v;
};
const strs = (v: unknown, maxItems: number, maxLen: number, field: string): string[] => {
  if (!Array.isArray(v) || v.length > maxItems) throw new Invalid(field);
  return v.map((x, i) => str(x, maxLen, `${field}[${i}]`)!);
};
const slug = (v: unknown, field: string) => { const s = str(v, 42, field)!; if (!SLUG.test(s)) throw new Invalid(field); return s; };

export function validateSnapshot(j: unknown): CatalogueSnapshot {
  const o = j as Record<string, unknown>;
  if (!o || o.ok !== true || o.source !== "database" || !Array.isArray(o.programmes) || !o.programmes.length || o.programmes.length > 60) throw new Invalid("envelope");
  const seen = new Set<string>();
  const programmes = (o.programmes as Record<string, unknown>[]).map((p, i): SnapshotProgramme => {
    const s = slug(p.slug, `programmes[${i}].slug`);
    if (seen.has(s)) throw new Invalid(`duplicate ${s}`);
    seen.add(s);
    const tone = str(p.tone, 120, `${s}.tone`)!;
    if (typeof p.fullPaymentOnly !== "boolean") throw new Invalid(`${s}.fullPaymentOnly`);
    if (p.track !== null && p.track !== "cloud") throw new Invalid(`${s}.track`);
    return {
      slug: s, name: str(p.name, 120, `${s}.name`)!, tag: str(p.tag, 40, `${s}.tag`)!, tone: ALLOWED_TONES.includes(tone) ? tone : ALLOWED_TONES[0],
      blurb: str(p.blurb, 300, `${s}.blurb`)!, price: int(p.price, 1, 100_000_000, `${s}.price`)!, was: int(p.was, 1, 100_000_000, `${s}.was`, true),
      trainingMonths: int(p.trainingMonths, 1, 24, `${s}.trainingMonths`)!, internshipMonths: int(p.internshipMonths, 0, 12, `${s}.internshipMonths`)!,
      level: str(p.level, 80, `${s}.level`)!, audience: str(p.audience, 300, `${s}.audience`, true), track: p.track as "cloud" | null,
      timedPrice: int(p.timedPrice, 1, 100_000_000, `${s}.timedPrice`, true), groupPrice: int(p.groupPrice, 1, 100_000_000, `${s}.groupPrice`, true),
      fullPaymentOnly: p.fullPaymentOnly, learn: strs(p.learn, 20, 200, `${s}.learn`), school: p.school === null ? null : slug(p.school, `${s}.school`),
      priceUsdCents: int(p.priceUsdCents, 1, 10_000_000, `${s}.priceUsdCents`, true), description: str(p.description, 4000, `${s}.description`, true),
      curriculumOutline: strs(p.curriculumOutline, 40, 200, `${s}.curriculumOutline`), finalProject: str(p.finalProject, 1000, `${s}.finalProject`, true),
    };
  });
  if (!Array.isArray(o.schools) || o.schools.length > 20 || !Array.isArray(o.retired) || o.retired.length > 200) throw new Invalid("schools/retired");
  const schools = (o.schools as Record<string, unknown>[]).map((x, i): SnapshotSchool => {
    const tone = str(x.tone, 120, `schools[${i}].tone`)!;
    return { slug: slug(x.slug, `schools[${i}].slug`), code: str(x.code, 4, `schools[${i}].code`)!, name: str(x.name, 120, `schools[${i}].name`)!,
      tab: str(x.tab, 40, `schools[${i}].tab`)!, tone: ALLOWED_TONES.includes(tone) ? tone : ALLOWED_TONES[0] };
  });
  const retired = (o.retired as Record<string, unknown>[]).map((x, i) => ({ slug: slug(x.slug, `retired[${i}].slug`), name: str(x.name, 120, `retired[${i}].name`)! }));
  return { source: "database", generatedAt: str(o.generatedAt, 40, "generatedAt")!, programmes, schools, retired };
}

export const render = (snap: CatalogueSnapshot | null) => `// GENERATED at build time by scripts/catalogue-export.mts from the live database catalogue (published programmes
// only). When the export cannot reach the database, or what it receives does not validate, this file is left as
// null and the website uses the seed list in lib/config.ts. Do not edit by hand.
import type { CatalogueSnapshot } from "./catalogue-types.ts";

export const PUBLISHED_SNAPSHOT: CatalogueSnapshot | null = ${snap ? JSON.stringify(snap, null, 2) : "null"};
`;

async function main() {
  if (process.env.SMA_CATALOGUE_EXPORT === "off") return console.log("catalogue export: skipped (SMA_CATALOGUE_EXPORT=off); using lib/catalogue.published.ts as it is.");
  const base = process.env.SMA_CATALOGUE_URL || SITE_URL;
  if (!/^https:\/\/[a-z0-9.-]+(\/|$)/i.test(base)) return console.warn("catalogue export: SMA_CATALOGUE_URL must be an https address; using the current file.");
  const url = `${base.replace(/\/+$/, "")}/api/catalogue`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
    if (!r.ok) return console.warn(`catalogue export: ${url} answered ${r.status}; using the current file (seed fallback).`);
    const j = await r.json() as { source?: string };
    if (j.source !== "database") return console.warn(`catalogue export: ${url} has no database catalogue yet (source: ${j.source ?? "none"}); using the current file (seed fallback).`);
    const snap = validateSnapshot(j);
    writeFileSync(OUT, render(snap));
    console.log(`catalogue export: ${snap.programmes.length} published programmes from ${url}.`);
  } catch (e) {
    console.warn(`catalogue export: ${e instanceof Invalid ? `invalid field ${e.message}` : (e as Error).message}; using the current file (seed fallback).`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
