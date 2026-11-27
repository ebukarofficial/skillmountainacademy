// Programme catalogue administration (Expansion Stage B).
//
//   GET   /api/app/admin/catalogue                              catalogue read: schools, every programme (live + draft), flags
//   POST  /api/app/admin/catalogue/programmes {slug, ...}       catalogue write: new draft programme (never public)
//   PATCH /api/app/admin/catalogue/programmes/:slug {...}       catalogue write: edit the draft (created from the live row if
//                                                               none). Live programmes are never edited in place.
//   PUT   /api/app/admin/catalogue/order {slugs}                catalogue write: display order (drafts and live)
//   POST  /api/app/admin/catalogue/programmes/:slug/publish     publish the draft (or resume a paused programme)
//   POST  /api/app/admin/catalogue/programmes/:slug/pause       unpublish: hidden from the website, registration closed
//   POST  /api/app/admin/catalogue/programmes/:slug/retire {reason}  retire: kept for records and old links, never public
//   PUT   /api/app/owner/catalogue-policy {superMayPublish}     owner: delegate publishing to Super Administrators
//
// Publishing, pausing and retiring change what the public sees and what is charged, so they need the OWNER, or a Super
// Administrator when the owner has delegated it, and a session that passed the authenticator code. Every change is in
// the audit log, prices with their previous and new values. Prices are integer minor units validated here; nothing is
// derived from the dollar price and no amount from the browser is ever used for a charge.
import { ApiError, nowIso } from "../../http";
import { ok, requireStrongAuth, route, type Ctx } from "../api";
import { Checker } from "../../validate";
import { isSuper } from "../permissions";
import { getSetting, putSetting } from "../data/engagement";
import { programmeAdmissions } from "../admissions";
import { activeEnrolmentCounts, programmeHistory, applyDraft, enrolmentCount, getDraft, getLive, getSchool, insertDraft, listDrafts, listLive, listSchools, reorder, retireLive, setLiveStatus, updateDraft,
  userNames, type DraftFields, type DraftRow, type LiveRow } from "../data/catalogue";
import { invalidateCatalogue, publishProblems, RESERVED_SLUGS, SLUG_RE } from "../../catalogue";
import { readRates } from "../../routes/geo";
import { internationalAmount } from "../../../../lib/pricing.ts";
import { safeTone } from "../../../../lib/config.ts";

const POLICY_KEY = "catalogue_policy";
type Policy = { superMayPublish: boolean };
const getPolicy = async (c: Ctx): Promise<Policy> => ({ superMayPublish: !!(await getSetting<Policy>(c.db, POLICY_KEY).catch(() => null))?.superMayPublish });
const mayPublish = (c: Ctx, p: Policy) => c.isOwner || (isSuper(c.user) && p.superMayPublish);

async function requirePublisher(c: Ctx, action: string, slug: string) {
  if (!mayPublish(c, await getPolicy(c))) {
    await c.audit("catalogue.refused", "programme", slug, { action });
    throw new ApiError(403, "owner_required", "Only the owner, or a Super Administrator the owner has authorised, can change what is published.");
  }
  await requireStrongAuth(c, `catalogue.${action}`, slug);
}

const list = (j: string | null) => { try { const v = JSON.parse(j ?? "[]"); return Array.isArray(v) ? (v as string[]) : []; } catch { return []; } };

function draftFromLive(l: LiveRow): DraftFields {
  return {
    name: l.name, school_slug: l.school_slug ?? "", blurb: l.blurb, description: l.description, learn_json: l.learn_json, curriculum_json: l.curriculum_json,
    final_project: l.final_project, training_months: l.training_months, internship_months: l.internship_months, price_usd_cents: l.price_usd_cents, price_kobo: l.price_kobo,
    level: l.level, audience: l.audience, full_payment_only: Number(l.full_payment_only), position: l.position,
  };
}

// Server-side validation of an edit. Only fields present in the body change.
async function readFields(c: Ctx, b: Record<string, unknown>, base: DraftFields): Promise<DraftFields> {
  const ch = new Checker();
  const f: DraftFields = { ...base };
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  const strList = (v: unknown, label: string, maxItems: number, maxLen: number) => {
    if (!Array.isArray(v)) { ch.errors.push(`${label} must be a list.`); return "[]"; }
    const items = v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
    if (items.length > maxItems) ch.errors.push(`${label}: at most ${maxItems} items.`);
    if (items.some((x) => x.length > maxLen)) ch.errors.push(`${label}: each item at most ${maxLen} characters.`);
    return JSON.stringify(items.slice(0, maxItems));
  };
  const money = (v: unknown, label: string, max: number) => {
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 100 || n > max) { ch.errors.push(`${label} must be a whole number of minor units between 100 and ${max}.`); return null; }
    return n;
  };
  if (has("name")) f.name = ch.req(b.name, "Title", 120);
  if (has("schoolSlug")) f.school_slug = ch.req(b.schoolSlug, "School", 60);
  if (has("blurb")) f.blurb = ch.opt(b.blurb, 300);
  if (has("description")) f.description = ch.opt(b.description, 4000);
  if (has("learn")) f.learn_json = strList(b.learn, "Learning outcomes", 20, 200);
  if (has("curriculum")) f.curriculum_json = strList(b.curriculum, "Curriculum", 40, 200);
  if (has("finalProject")) f.final_project = ch.opt(b.finalProject, 1000);
  if (has("trainingMonths")) f.training_months = ch.int(b.trainingMonths, 1, 24, "Training months");
  if (has("internshipMonths")) f.internship_months = ch.int(b.internshipMonths, 0, 12, "Internship months");
  if (has("priceUsdCents")) f.price_usd_cents = money(b.priceUsdCents, "International tuition (US cents)", 10_000_000);
  if (has("priceNgnKobo")) f.price_kobo = money(b.priceNgnKobo, "Local NGN tuition (kobo)", 10_000_000_000);
  if (has("level")) f.level = ch.opt(b.level, 80);
  if (has("audience")) f.audience = ch.opt(b.audience, 300);
  if (has("fullPaymentOnly")) { if (typeof b.fullPaymentOnly !== "boolean") ch.errors.push("fullPaymentOnly must be true or false."); else f.full_payment_only = b.fullPaymentOnly ? 1 : 0; }
  if (has("position")) f.position = ch.int(b.position, 0, 999, "Position");
  // Never accepted: currency, country, or any "price" in naira/dollars as a display amount.
  ch.done();
  if (!f.school_slug || !(await getSchool(c.db, f.school_slug))) throw new ApiError(400, "invalid", "Please choose one of the six schools.");
  return f;
}

const fieldsOut = (d: DraftFields | null) => d && ({
  name: d.name, schoolSlug: d.school_slug || null, blurb: d.blurb, description: d.description, learn: list(d.learn_json), curriculum: list(d.curriculum_json),
  finalProject: d.final_project, trainingMonths: d.training_months, internshipMonths: d.internship_months, priceUsdCents: d.price_usd_cents, priceNgnKobo: d.price_kobo,
  level: d.level, audience: d.audience, fullPaymentOnly: Number(d.full_payment_only) === 1, position: d.position,
});

// Field-level differences for the audit log.
function diff(a: DraftFields | null, b: DraftFields): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(b) as (keyof DraftFields)[]) {
    const from = a ? a[k] ?? null : null, to = b[k] ?? null;
    if (from !== to) out[k] = { from, to };
  }
  return out;
}
async function auditPrices(c: Ctx, slug: string, stage: "draft" | "published", before: { price_kobo: number | null; price_usd_cents: number | null } | null, after: { price_kobo: number | null; price_usd_cents: number | null }) {
  if ((before?.price_kobo ?? null) !== (after.price_kobo ?? null))
    await c.audit("catalogue.price_change", "programme", slug, { stage, price: "ngn_local", unit: "kobo", previous: before?.price_kobo ?? null, next: after.price_kobo ?? null });
  if ((before?.price_usd_cents ?? null) !== (after.price_usd_cents ?? null))
    await c.audit("catalogue.price_change", "programme", slug, { stage, price: "usd_international", unit: "cents", previous: before?.price_usd_cents ?? null, next: after.price_usd_cents ?? null });
}

route("GET", "/api/app/admin/catalogue", ["admin"], async (c) => {
  const [schools, live, drafts, policy, rates, adm, enrolled] = await Promise.all([listSchools(c.db), listLive(c.db), listDrafts(c.db), getPolicy(c), readRates(c.env),
    programmeAdmissions(c.db).then((r) => r.list).catch(() => []), activeEnrolmentCounts(c.db)]);
  const names = await userNames(c.db, [...new Set([...live.map((l) => l.updated_by), ...drafts.map((d) => d.updated_by)].filter((x): x is string => !!x))]);
  const byLive = new Map(live.map((l) => [l.slug, l])), byDraft = new Map(drafts.map((d) => [d.slug, d]));
  const slugs = [...new Set([...live.map((l) => l.slug), ...drafts.map((d) => d.slug)])];
  const programmes = slugs.map((slug) => {
    const l = byLive.get(slug) ?? null, d = byDraft.get(slug) ?? null;
    const current: DraftFields = d ?? draftFromLive(l!);
    const usd = current.price_usd_cents;
    return {
      slug, status: l?.status ?? "draft", hasDraft: !!d, live: l ? { ...fieldsOut(draftFromLive(l)), wasKobo: l.was_kobo, publishedAt: l.published_at, retiredAt: l.retired_at, retiredReason: l.retired_reason } : null,
      draft: fieldsOut(d), name: current.name, schoolSlug: current.school_slug || null, position: current.position,
      problems: d ? publishProblems(d) : [], missingNgn: !current.price_kobo, missingUsd: !current.price_usd_cents,
      international: { USD: internationalAmount(usd, "USD", rates), GBP: internationalAmount(usd, "GBP", rates), EUR: internationalAmount(usd, "EUR", rates) },
      updatedAt: (d ?? l)!.updated_at, updatedBy: (d ?? l)?.updated_by ? names.get((d ?? l)!.updated_by!) ?? "Unknown" : null,
      // Stage C: admissions (separate from the lifecycle) and current enrolment / capacity. A programme that is not
      // published shows its admissions setting but is closed to new students whatever that setting is.
      admissions: (() => { const a = adm.find((x) => x.slug === slug); return a ? { mode: a.setting.mode, state: a.status.state, opensAt: a.status.opensAt ?? null,
        enforceCapacity: !!a.setting.enforce_capacity, full: a.capacity.full, capacity: a.capacity } : null; })(),
      enrolment: (() => { const e = enrolled.find((x) => x.programme_slug === slug); return { active: Number(e?.active ?? 0), paused: Number(e?.paused ?? 0), finished: Number(e?.finished ?? 0) }; })(),
    };
  }).sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug));
  return ok({
    schools: schools.map((s) => ({ slug: s.slug, code: s.code, name: s.name, tab: s.tab_label, tone: safeTone(s.tone), position: s.position })),
    programmes, policy, canPublish: mayPublish(c, policy), isOwner: c.isOwner,
    counts: { total: programmes.length, published: programmes.filter((p) => p.status === "published").length, drafts: programmes.filter((p) => p.hasDraft).length,
      newDrafts: programmes.filter((p) => p.status === "draft").length, changesToLive: programmes.filter((p) => p.hasDraft && p.status !== "draft").length,
      missingNgn: programmes.filter((p) => p.missingNgn && p.status !== "retired").length },
  });
});

route("POST", "/api/app/admin/catalogue/programmes", ["admin"], async (c) => {
  const b = await c.body<Record<string, unknown>>();
  const slug = String(b.slug ?? "").trim().toLowerCase();
  if (!SLUG_RE.test(slug)) throw new ApiError(400, "invalid", "The web address must be 3 to 42 lowercase letters, numbers or hyphens.");
  if (RESERVED_SLUGS.includes(slug)) throw new ApiError(409, "reserved", "That web address belonged to an earlier programme and cannot be reused. Choose another.");
  if ((await getLive(c.db, slug)) || (await getDraft(c.db, slug))) throw new ApiError(409, "exists", "A programme with that web address already exists.");
  const base: DraftFields = { name: "", school_slug: "", blurb: null, description: null, learn_json: "[]", curriculum_json: "[]", final_project: null,
    training_months: 1, internship_months: 0, price_usd_cents: null, price_kobo: null, level: null, audience: null, full_payment_only: 0, position: 999 };
  const f = await readFields(c, { ...b, name: b.name ?? "" }, base);
  const at = nowIso();
  if (!(await insertDraft(c.db, slug, f, c.user.id, at, "admin"))) throw new ApiError(409, "exists", "A programme with that web address already exists.");
  await c.audit("catalogue.create", "programme", slug, { fields: fieldsOut(f) });
  await auditPrices(c, slug, "draft", null, f);
  return ok({ slug, status: "draft", problems: publishProblems(f) }, 201);
});

route("PATCH", "/api/app/admin/catalogue/programmes/:slug", ["admin"], async (c) => {
  const slug = c.params.slug;
  const [d, l] = await Promise.all([getDraft(c.db, slug), getLive(c.db, slug)]);
  if (!d && !l) throw new ApiError(404, "not_found", "That programme was not found.");
  if (!d && l!.status === "retired") throw new ApiError(409, "retired", "A retired programme cannot be edited.");
  const before: DraftFields = d ?? draftFromLive(l!);
  const f = await readFields(c, await c.body<Record<string, unknown>>(), before);
  const at = nowIso();
  if (d) await updateDraft(c.db, slug, f, c.user.id, at);
  else await insertDraft(c.db, slug, f, c.user.id, at, "edit-of-live");
  const changes = diff(before, f);
  await c.audit("catalogue.edit", "programme", slug, { draft: true, changes });
  if (changes.school_slug) await c.audit("catalogue.school_change", "programme", slug, { stage: "draft", previous: changes.school_slug.from, next: changes.school_slug.to });
  await auditPrices(c, slug, "draft", before, f);
  return ok({ slug, problems: publishProblems(f) });
});

route("PUT", "/api/app/admin/catalogue/order", ["admin"], async (c) => {
  const b = await c.body<{ slugs?: unknown }>();
  if (!Array.isArray(b.slugs) || b.slugs.length > 200 || !b.slugs.every((s) => typeof s === "string" && SLUG_RE.test(s))) throw new ApiError(400, "invalid", "slugs must be a list of programme addresses.");
  const slugs = [...new Set(b.slugs as string[])];
  await reorder(c.db, slugs, c.user.id, nowIso());
  invalidateCatalogue();
  await c.audit("catalogue.reorder", "catalogue", "order", { slugs });
  return ok({ slugs });
});

route("POST", "/api/app/admin/catalogue/programmes/:slug/publish", ["admin"], async (c) => {
  const slug = c.params.slug;
  await requirePublisher(c, "publish", slug);
  const [d, l] = await Promise.all([getDraft(c.db, slug), getLive(c.db, slug)]);
  const at = nowIso();
  if (!d) {
    // Resume a paused programme exactly as it was published.
    if (l?.status !== "paused") throw new ApiError(409, "nothing_to_publish", l ? "There are no unpublished changes for this programme." : "That programme was not found.");
    // It was public before with these values; it still needs its local NGN tuition (never derived from dollars).
    if (!(Number.isInteger(l.price_kobo) && l.price_kobo > 0)) throw new ApiError(409, "incomplete", "This programme cannot be published yet. Missing: local tuition (NGN).");
    await setLiveStatus(c.db, slug, ["paused"], "published", c.user.id, at);
    invalidateCatalogue();
    await c.audit("catalogue.publish", "programme", slug, { resumed: true, from: "paused", to: "published" });
    return ok({ slug, status: "published" });
  }
  const problems = publishProblems(d);
  if (problems.length) throw new ApiError(409, "incomplete", `This programme cannot be published yet. Missing: ${problems.join(", ")}.`);
  const school = await getSchool(c.db, d.school_slug);
  if (!school) throw new ApiError(409, "incomplete", "This programme's school no longer exists.");
  // Existing enrolments keep the durations recorded when they started (enrolments.training_months, migration 0011).
  const durationChanged = !!l && (l.training_months !== d.training_months || l.internship_months !== d.internship_months);
  const enrolled = durationChanged ? await enrolmentCount(c.db, slug) : 0;
  const priceChanged = !!l && l.price_kobo !== d.price_kobo;
  // A reused programme keeps its card colours; a new one takes its school's.
  const tone = safeTone(l?.tone ?? school.tone);
  await applyDraft(c.db, d as DraftRow, school.tab_label, tone, c.user.id, at, priceChanged);
  invalidateCatalogue();
  const before = l ? fieldsOut(draftFromLive(l)) : null;
  await c.audit("catalogue.publish", "programme", slug, { first: !l, previousStatus: l?.status ?? "draft", before, after: fieldsOut(d), durationChanged, existingEnrolmentsKeepDurations: enrolled });
  if (l && (l.school_slug ?? null) !== d.school_slug) await c.audit("catalogue.school_change", "programme", slug, { stage: "published", previous: l.school_slug, next: d.school_slug });
  await auditPrices(c, slug, "published", l ? { price_kobo: l.price_kobo, price_usd_cents: l.price_usd_cents } : null, d);
  return ok({ slug, status: "published", note: "The website shows this after the next build and deployment; registration and prices use it immediately." });
});

route("POST", "/api/app/admin/catalogue/programmes/:slug/pause", ["admin"], async (c) => {
  const slug = c.params.slug;
  await requirePublisher(c, "pause", slug);
  if (!(await setLiveStatus(c.db, slug, ["published"], "paused", c.user.id, nowIso()))) throw new ApiError(409, "not_published", "Only a published programme can be paused.");
  invalidateCatalogue();
  await c.audit("catalogue.unpublish", "programme", slug, { from: "published", to: "paused" });
  return ok({ slug, status: "paused" });
});

route("POST", "/api/app/admin/catalogue/programmes/:slug/retire", ["admin"], async (c) => {
  const slug = c.params.slug;
  await requirePublisher(c, "retire", slug);
  const ch = new Checker();
  const reason = ch.req((await c.body<{ reason?: unknown }>()).reason, "Reason", 500);
  ch.done();
  const l = await getLive(c.db, slug);
  if (!l) throw new ApiError(409, "not_published", "Only a programme that has been published can be retired. An unpublished draft simply stays unpublished.");
  if (!(await retireLive(c.db, slug, reason, c.user.id, nowIso()))) throw new ApiError(409, "retired", "This programme is already retired.");
  invalidateCatalogue();
  await c.audit("catalogue.retire", "programme", slug, { previousStatus: l.status, reason });
  return ok({ slug, status: "retired" });
});

route("PUT", "/api/app/owner/catalogue-policy", ["admin"], async (c) => {
  const b = await c.body<{ superMayPublish?: unknown }>();
  if (typeof b.superMayPublish !== "boolean") throw new ApiError(400, "invalid", "superMayPublish must be true or false.");
  const before = await getPolicy(c);
  await putSetting(c.db, POLICY_KEY, { superMayPublish: b.superMayPublish }, c.user.id, nowIso());
  await c.audit("owner.catalogue_policy", "settings", POLICY_KEY, { from: before, to: { superMayPublish: b.superMayPublish } });
  return ok({ policy: { superMayPublish: b.superMayPublish } });
});

// Stage C: resume a paused programme exactly as it was published (without applying any pending draft). Same publisher
// rule as publish, pause and retire: the owner, or a delegated Super Administrator, with the authenticator code.
route("POST", "/api/app/admin/catalogue/programmes/:slug/resume", ["admin"], async (c) => {
  const slug = c.params.slug;
  await requirePublisher(c, "resume", slug);
  const l = await getLive(c.db, slug);
  if (l?.status !== "paused") throw new ApiError(409, "not_paused", l ? `This programme is ${l.status}; only a paused programme can be resumed.` : "That programme was not found.");
  if (!(Number.isInteger(l.price_kobo) && l.price_kobo > 0)) throw new ApiError(409, "incomplete", "This programme cannot be resumed. Missing: local tuition (NGN).");
  await setLiveStatus(c.db, slug, ["paused"], "published", c.user.id, nowIso());
  invalidateCatalogue();
  await c.audit("catalogue.resume", "programme", slug, { from: "paused", to: "published" });
  return ok({ slug, status: "published" });
});

// Stage C: the lifecycle and admissions history of one programme (audit log).
route("GET", "/api/app/admin/catalogue/programmes/:slug/history", ["admin"], async (c) => {
  const rows = await programmeHistory(c.db, c.params.slug);
  return ok({ history: rows.map((r) => ({ at: r.at, action: r.action, by: r.actor_name, detail: (() => { try { return JSON.parse(r.detail ?? "null"); } catch { return null; } })() })) });
});
