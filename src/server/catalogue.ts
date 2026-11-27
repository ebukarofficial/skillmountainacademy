// The programme catalogue as the Worker sees it (Expansion Stage B).
//
// * publishedCatalogue(): what the public may see. Published programmes only; drafts, paused and retired programmes are
//   never included (retired ones contribute their NAME only, so old records still read correctly). When the database is
//   missing or older than migration 0011 (production is at 0009/0010 until the owner migrates), it falls back to the
//   bundled seed list in lib/config.ts, exactly as the website worked before, and says so (source: "fallback").
// * resolveProgramme(): the programme a registration or a quote is priced from. The DB's published row wins; the bundled
//   list is used only when the catalogue tables are not there. A draft can never be registered for.
// * Rules for drafts and publication (validation, reserved slugs). Prices never come from the browser.
import { PROGRAMMES, findProgramme, LEGACY_SLUGS, safeTone, type Programme } from "../../lib/config.ts";
import type { CatalogueSnapshot, SnapshotProgramme, SnapshotSchool } from "../../lib/catalogue-types.ts";
import { ApiError } from "./http";
import { publicSchools, publishedRows, retiredRows, type DraftRow, type LiveRow } from "./lms/data/catalogue";

type DB = D1Database;
const TTL_MS = 60_000;
let memo: { at: number; value: Catalogue } | null = null;
export const invalidateCatalogue = () => { memo = null; };

export type Catalogue = Omit<CatalogueSnapshot, "source"> & { source: "database" | "fallback" };

const parseList = (j: string | null | undefined): string[] => {
  try { const v = JSON.parse(j ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 40) : []; } catch { return []; }
};
const naira = (kobo: number | null | undefined) => (kobo == null ? null : Math.round(kobo / 100));

export function toSnapshotProgramme(r: LiveRow & { school_tab?: string | null; school_tone?: string | null }): SnapshotProgramme {
  return {
    slug: r.slug, name: r.name, tag: r.tag ?? r.school_tab ?? "Programmes", tone: safeTone(r.tone ?? r.school_tone), blurb: r.blurb ?? "",
    price: naira(r.price_kobo)!, was: naira(r.was_kobo), trainingMonths: r.training_months, internshipMonths: r.internship_months, level: r.level,
    audience: r.audience, track: r.track === "cloud" ? "cloud" : null, timedPrice: naira(r.timed_price_kobo), groupPrice: naira(r.group_price_kobo),
    fullPaymentOnly: Number(r.full_payment_only) === 1, learn: parseList(r.learn_json), school: r.school_slug, priceUsdCents: r.price_usd_cents,
    description: r.description, curriculumOutline: parseList(r.curriculum_json), finalProject: r.final_project,
  };
}

const seedSnapshot = (): SnapshotProgramme[] => PROGRAMMES.map((p) => ({
  slug: p.slug, name: p.name, tag: p.tag, tone: p.tone, blurb: p.blurb, price: p.price, was: p.was ?? null, trainingMonths: p.trainingMonths,
  internshipMonths: p.internshipMonths, level: p.level, audience: p.audience ?? null, track: p.track ?? null, timedPrice: p.timedPrice, groupPrice: p.groupPrice,
  fullPaymentOnly: !!p.fullPaymentOnly, learn: p.learn, school: p.school ?? null, priceUsdCents: null, description: null, curriculumOutline: [], finalProject: null,
}));

export async function publishedCatalogue(db: DB | undefined, now = Date.now()): Promise<Catalogue> {
  if (memo && now - memo.at < TTL_MS) return memo.value;
  let value: Catalogue;
  try {
    if (!db) throw new Error("no database");
    const [rows, schools, retired] = await Promise.all([publishedRows(db), publicSchools(db), retiredRows(db)]);
    value = {
      source: "database", generatedAt: new Date(now).toISOString(), programmes: rows.map(toSnapshotProgramme),
      schools: schools.map((s): SnapshotSchool => ({ slug: s.slug, code: s.code, name: s.name, tab: s.tab_label, tone: safeTone(s.tone) })), retired,
    };
  } catch {
    value = { source: "fallback", generatedAt: new Date(now).toISOString(), programmes: seedSnapshot(), schools: [], retired: [] };
  }
  memo = { at: now, value };
  return value;
}

// A published programme as a lib/config.ts Programme, so existing pricing code (priceNaira, planParts, dueDays) is reused.
export async function resolveProgramme(db: DB | undefined, slug: string | null | undefined): Promise<Programme | undefined> {
  if (!slug) return undefined;
  const s = LEGACY_SLUGS[slug] ?? slug;
  const cat = await publishedCatalogue(db);
  if (cat.source === "fallback") return findProgramme(s);
  const p = cat.programmes.find((x) => x.slug === s);
  if (!p) return undefined;
  const bundled = findProgramme(s);
  return {
    slug: p.slug, name: p.name, tag: p.tag, blurb: p.blurb, price: p.price, ...(p.was ? { was: p.was } : {}), trainingMonths: p.trainingMonths,
    internshipMonths: p.internshipMonths, level: p.level, ...(p.audience ? { audience: p.audience } : {}), ...(p.track ? { track: p.track } : {}),
    timedPrice: p.timedPrice, fastTrack: false, curriculum: bundled?.curriculum ?? `/curricula/${p.slug}.pdf`, groupPrice: p.groupPrice,
    ...(p.fullPaymentOnly ? { fullPaymentOnly: true } : {}), tone: p.tone, learn: p.learn, ...(p.school ? { school: p.school } : {}),
  };
}

// ---------- drafts and publication rules ----------
export const SLUG_RE = /^[a-z][a-z0-9-]{1,40}[a-z0-9]$/;
// Slugs that must never name a different programme: removed programmes, legacy links and the retained cloud-devops.
export const RESERVED_SLUGS = ["data", "data-analytics", "ielts", "cyber", "web", "cloud-devops", "new", "admin", "catalogue"];

// Everything a draft needs before it can be published. local NGN tuition is never derived from the dollar price: a
// programme without one cannot be published.
export function publishProblems(d: Pick<DraftRow, "name" | "school_slug" | "training_months" | "internship_months" | "price_usd_cents" | "price_kobo" | "blurb" | "level" | "learn_json">): string[] {
  const p: string[] = [];
  if (!d.name?.trim()) p.push("title");
  if (!d.school_slug) p.push("school");
  if (!(Number.isInteger(d.training_months) && d.training_months >= 1)) p.push("training months");
  if (!(Number.isInteger(d.internship_months) && d.internship_months >= 0)) p.push("internship months");
  if (!(Number.isInteger(d.price_usd_cents) && d.price_usd_cents! > 0)) p.push("international tuition (USD)");
  if (!(Number.isInteger(d.price_kobo) && d.price_kobo! > 0)) p.push("local tuition (NGN)");
  if (!d.blurb?.trim()) p.push("short description");
  if (!d.level?.trim()) p.push("level");
  if (parseList(d.learn_json).length < 3) p.push("at least 3 learning outcomes");
  return p;
}

// ---------- lifecycle (Stage C) ----------
// A programme's catalogue lifecycle, which ALWAYS takes precedence over its admissions setting:
//   published -> admissions decide (open / scheduled / closed / full)
//   paused | retired | draft -> no new registrations or new students, whatever admissions say
// null means the catalogue tables are not there (database older than 0011): the bundled list decides, as before.
export type Lifecycle = "published" | "paused" | "retired" | "draft" | "unknown";
export async function lifecycleOf(db: DB | undefined, slug: string | null | undefined): Promise<Lifecycle | null> {
  if (!db || !slug) return null;
  const s = LEGACY_SLUGS[slug] ?? slug;
  try {
    const live = await db.prepare("SELECT status FROM programmes WHERE slug = ?1").bind(s).first<{ status: string | null }>();
    if (live) return (live.status ?? "published") as Lifecycle;
    const draft = await db.prepare("SELECT 1 AS x FROM programme_drafts WHERE slug = ?1").bind(s).first();
    return draft ? "draft" : "unknown";
  } catch { return null; }
}
export async function lifecycles(db: DB | undefined): Promise<Map<string, Lifecycle> | null> {
  if (!db) return null;
  try {
    const [live, drafts] = await Promise.all([
      db.prepare("SELECT slug, status FROM programmes").all<{ slug: string; status: string | null }>(),
      db.prepare("SELECT slug FROM programme_drafts").all<{ slug: string }>(),
    ]);
    const m = new Map<string, Lifecycle>(drafts.results.map((d) => [d.slug, "draft"]));
    for (const r of live.results) m.set(r.slug, (r.status ?? "published") as Lifecycle);
    return m;
  } catch { return null; }
}
export const LIFECYCLE_MESSAGE: Record<Exclude<Lifecycle, "published">, string> = {
  paused: "This programme is paused, so it is not taking new registrations at the moment. Students already enrolled keep full access.",
  retired: "This programme has been retired and no longer takes registrations. Students already enrolled keep full access to their records.",
  draft: "This programme is not open yet.",
  unknown: "Please choose a programme.",
};
// Throws when the lifecycle forbids new registrations or new students.
export async function assertLifecycleAllowsNew(db: DB | undefined, slug: string) {
  const l = await lifecycleOf(db, slug);
  if (l === null || l === "published") return;
  throw new ApiError(l === "unknown" ? 400 : 409, l === "unknown" ? "invalid" : "programme_unavailable", LIFECYCLE_MESSAGE[l]);
}
