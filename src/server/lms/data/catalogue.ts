// Programme catalogue (Expansion Stage B, migration 0011). SQL only; rules live in src/server/catalogue.ts and the
// routes in routes/catalogue.ts.
//
//   schools            the six schools
//   programmes         the LIVE catalogue: status published | paused | retired. Only published rows are public.
//   programme_drafts   unpublished edits and new programmes (one per slug). Never public. Publishing copies a draft
//                      into programmes (owner, or a Super Administrator the owner has delegated) and removes the draft.
// Money is integer minor units: price_kobo (local tuition, NGN kobo), price_usd_cents (international tuition).
import { all, batch, one, run, stmt, type DB } from "./base";

export type SchoolRow = { slug: string; code: string; name: string; tab_label: string; tone: string; position: number };
export type LiveRow = {
  slug: string; name: string; price_kobo: number; was_kobo: number | null; timed_price_kobo: number | null; group_price_kobo: number | null;
  training_months: number; internship_months: number; level: string; updated_at: string;
  school_slug: string | null; tag: string | null; tone: string | null; blurb: string | null; description: string | null; learn_json: string; curriculum_json: string;
  final_project: string | null; audience: string | null; track: string | null; full_payment_only: number; price_usd_cents: number | null;
  status: "published" | "paused" | "retired"; published_at: string | null; position: number; created_at: string | null; updated_by: string | null;
  retired_at: string | null; retired_by: string | null; retired_reason: string | null;
};
export type DraftRow = {
  slug: string; name: string; school_slug: string; blurb: string | null; description: string | null; learn_json: string; curriculum_json: string;
  final_project: string | null; training_months: number; internship_months: number; price_usd_cents: number | null; price_kobo: number | null;
  level: string | null; audience: string | null; full_payment_only: number; position: number; source: string | null;
  created_at: string; updated_at: string; updated_by: string | null;
};
export type DraftFields = Omit<DraftRow, "slug" | "created_at" | "updated_at" | "updated_by" | "source">;

export const listSchools = (db: DB) => all<SchoolRow>(db, "SELECT slug, code, name, tab_label, tone, position FROM schools ORDER BY position, slug");
export const getSchool = (db: DB, slug: string) => one<SchoolRow>(db, "SELECT slug, code, name, tab_label, tone, position FROM schools WHERE slug = ?1", slug);
export const listLive = (db: DB) => all<LiveRow>(db, "SELECT * FROM programmes ORDER BY position, slug");
export const getLive = (db: DB, slug: string) => one<LiveRow>(db, "SELECT * FROM programmes WHERE slug = ?1", slug);
export const listDrafts = (db: DB) => all<DraftRow>(db, "SELECT * FROM programme_drafts ORDER BY position, slug");
export const getDraft = (db: DB, slug: string) => one<DraftRow>(db, "SELECT * FROM programme_drafts WHERE slug = ?1", slug);

// Public: published rows only. Raw D1 (no "learning platform" guard) so the caller can fall back on an older schema.
export const publishedRows = (db: DB) => db.prepare(
  `SELECT p.*, s.tab_label AS school_tab, s.tone AS school_tone FROM programmes p LEFT JOIN schools s ON s.slug = p.school_slug WHERE p.status = 'published' AND p.price_kobo > 0 ORDER BY p.position, p.slug`).all<LiveRow & { school_tab: string | null; school_tone: string | null }>().then((r) => r.results);
export const retiredRows = (db: DB) => db.prepare("SELECT slug, name FROM programmes WHERE status = 'retired' ORDER BY slug").all<{ slug: string; name: string }>().then((r) => r.results);
export const publicSchools = (db: DB) => db.prepare("SELECT slug, code, name, tab_label, tone, position FROM schools ORDER BY position, slug").all<SchoolRow>().then((r) => r.results);

const DRAFT_COLS = ["name", "school_slug", "blurb", "description", "learn_json", "curriculum_json", "final_project", "training_months", "internship_months",
  "price_usd_cents", "price_kobo", "level", "audience", "full_payment_only", "position"] as const;

export async function insertDraft(db: DB, slug: string, f: DraftFields, by: string, at: string, source: string | null) {
  return run(db, `INSERT INTO programme_drafts (slug, ${DRAFT_COLS.join(", ")}, source, created_at, updated_at, updated_by) VALUES (?1, ${DRAFT_COLS.map((_, i) => `?${i + 2}`).join(", ")}, ?${DRAFT_COLS.length + 2}, ?${DRAFT_COLS.length + 3}, ?${DRAFT_COLS.length + 3}, ?${DRAFT_COLS.length + 4})
    ON CONFLICT(slug) DO NOTHING`, slug, ...DRAFT_COLS.map((c) => f[c]), source, at, by);
}
export async function updateDraft(db: DB, slug: string, f: DraftFields, by: string, at: string) {
  return run(db, `UPDATE programme_drafts SET ${DRAFT_COLS.map((c, i) => `${c} = ?${i + 2}`).join(", ")}, updated_at = ?${DRAFT_COLS.length + 2}, updated_by = ?${DRAFT_COLS.length + 3} WHERE slug = ?1`,
    slug, ...DRAFT_COLS.map((c) => f[c]), at, by);
}

// Publishing a draft: one atomic batch writes the live row (insert or update) and removes the draft. A price change
// clears the old crossed-out price; timed and group prices are kept as they were.
export async function applyDraft(db: DB, d: DraftRow, tag: string, tone: string, by: string, at: string, priceChanged: boolean) {
  await batch(db, [
    stmt(db, `INSERT INTO programmes (slug, name, price_kobo, training_months, internship_months, level, updated_at, school_slug, tag, tone, blurb, description, learn_json, curriculum_json, final_project, audience, full_payment_only, price_usd_cents, status, published_at, position, created_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, 'published', ?7, ?19, ?7, ?20) ON CONFLICT(slug) DO UPDATE SET name = excluded.name, price_kobo = excluded.price_kobo, training_months = excluded.training_months, internship_months = excluded.internship_months, level = excluded.level, updated_at = excluded.updated_at, school_slug = excluded.school_slug, tag = excluded.tag, tone = excluded.tone, blurb = excluded.blurb, description = excluded.description, learn_json = excluded.learn_json, curriculum_json = excluded.curriculum_json, final_project = excluded.final_project, audience = excluded.audience, full_payment_only = excluded.full_payment_only, price_usd_cents = excluded.price_usd_cents, status = 'published', published_at = excluded.published_at, position = excluded.position, updated_by = excluded.updated_by, was_kobo = CASE WHEN ?21 = 1 THEN NULL ELSE programmes.was_kobo END, retired_at = NULL, retired_by = NULL, retired_reason = NULL`,
      d.slug, d.name, d.price_kobo, d.training_months, d.internship_months, d.level, at, d.school_slug, tag, tone, d.blurb, d.description, d.learn_json,
      d.curriculum_json, d.final_project, d.audience, d.full_payment_only, d.price_usd_cents, d.position, by, priceChanged ? 1 : 0),
    stmt(db, "DELETE FROM programme_drafts WHERE slug = ?1", d.slug),
  ]);
}

export const setLiveStatus = (db: DB, slug: string, from: string[], to: "published" | "paused", by: string, at: string) =>
  run(db, `UPDATE programmes SET status = ?2, updated_at = ?3, updated_by = ?4 WHERE slug = ?1 AND status IN (${from.map((_, i) => `?${i + 5}`).join(", ")})`, slug, to, at, by, ...from);
export const retireLive = (db: DB, slug: string, reason: string, by: string, at: string) =>
  run(db, "UPDATE programmes SET status = 'retired', retired_at = ?2, retired_by = ?3, retired_reason = ?4, updated_at = ?2, updated_by = ?3 WHERE slug = ?1 AND status <> 'retired'", slug, at, by, reason);

export async function reorder(db: DB, slugs: string[], by: string, at: string) {
  const stmts = slugs.flatMap((slug, i) => [
    stmt(db, "UPDATE programmes SET position = ?2, updated_at = ?3, updated_by = ?4 WHERE slug = ?1 AND position <> ?2", slug, i + 1, at, by),
    stmt(db, "UPDATE programme_drafts SET position = ?2, updated_at = ?3, updated_by = ?4 WHERE slug = ?1 AND position <> ?2", slug, i + 1, at, by),
  ]);
  if (stmts.length) await batch(db, stmts);
}

export const enrolmentCount = async (db: DB, slug: string) => (await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM enrolments WHERE programme_slug = ?1", slug))?.n ?? 0;
export const userNames = async (db: DB, ids: string[]) => {
  if (!ids.length) return new Map<string, string>();
  const rows = await all<{ id: string; full_name: string }>(db, `SELECT id, full_name FROM users WHERE id IN (${ids.map((_, i) => `?${i + 1}`).join(", ")})`, ...ids);
  return new Map(rows.map((r) => [r.id, r.full_name]));
};

// Duration snapshot for a new enrolment (0011). Best effort: on a database without the columns it does nothing, and
// the enrolment falls back to the programme's current durations, exactly as before.
export const snapshotEnrolmentDurations = (db: DB, enrolmentId: string, training: number, internship: number) =>
  db.prepare("UPDATE enrolments SET training_months = ?2, internship_months = ?3 WHERE id = ?1 AND training_months IS NULL").bind(enrolmentId, training, internship).run().then(() => true, () => false);

// Stage C: a programme's lifecycle and admissions history, from the existing audit log (no second history store).
export const programmeHistory = (db: DB, slug: string) => all<{ at: string; action: string; detail: string | null; actor_name: string | null }>(db,
  `SELECT a.at, a.action, a.detail, u.full_name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.target_id = ?1 AND (a.action LIKE 'catalogue.%' OR a.action LIKE 'admissions.%') ORDER BY a.at DESC LIMIT 200`, slug);
export const activeEnrolmentCounts = (db: DB) => all<{ programme_slug: string; active: number; paused: number; finished: number }>(db,
  `SELECT programme_slug, SUM(status = 'active') AS active, SUM(status = 'paused') AS paused, SUM(status IN ('completed', 'withdrawn')) AS finished FROM enrolments GROUP BY programme_slug`);
