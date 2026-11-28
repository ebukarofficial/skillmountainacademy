// Pricing configuration (Expansion Stage D).
//   GET /api/app/admin/pricing/diagnostics   finance: the exchange-rate policy, the cached rates (source, time, age), whether
//                                            pound / euro tuition can be shown, and which published programmes have an
//                                            international price. Internal only; there are no credentials to expose.
//   PUT /api/app/owner/fx-policy             owner, with the authenticator code: the approved exchange-rate policy for
//                                            pound and euro tuition (source, maximum age, rounding). Audited.
import { ok, requireStrongAuth, route } from "../api";
import { Checker } from "../../validate";
import { ROUNDING, crossConvertMinor, type Rounding } from "../../../../lib/pricing.ts";
import { FX_SOURCES, fxUsable, getFxPolicy, saveFxPolicy, type FxPolicy } from "../../pricing";
import { publishedCatalogue } from "../../catalogue";
import { readRates } from "../../routes/geo";

route("GET", "/api/app/admin/pricing/diagnostics", ["admin"], async (c) => {
  const [policy, rates, cat] = await Promise.all([getFxPolicy(c.db), readRates(c.env), publishedCatalogue(c.db)]);
  const check = fxUsable(policy, rates);
  // Stage D.1 detection: orders without a pricing record created after the first order that has one. Always 0 when the
  // atomic write works; anything else needs investigation (for example an older Worker running against this database).
  const integrity = await c.db.prepare(`SELECT (SELECT COUNT(*) FROM orders WHERE pricing_snapshot IS NULL AND created_at >= (SELECT MIN(created_at) FROM orders WHERE pricing_snapshot IS NOT NULL)) AS without_snapshot, (SELECT COUNT(*) FROM orders WHERE pricing_snapshot IS NOT NULL) AS with_snapshot, (SELECT COUNT(*) FROM orders o WHERE o.method = 'paystack' AND o.pricing_snapshot IS NOT NULL AND o.status = 'pending' AND NOT EXISTS (SELECT 1 FROM payment_attempts a WHERE a.order_id = o.id AND a.state = 'initialized')) AS paystack_not_started, (SELECT COUNT(*) FROM payment_attempts WHERE state = 'uncertain') AS attempts_uncertain`)
    .first<{ without_snapshot: number; with_snapshot: number; paystack_not_started: number; attempts_uncertain: number }>().catch(() => null);
  return ok({
    integrity,
    policy, check, knownSources: FX_SOURCES, refresh: "every day at 05:00 and 17:00 UTC (src/server/cron.ts)",
    rates: rates ? { source: rates.source, fetchedAt: rates.fetchedAt, base: rates.base, perNgn: rates.rates,
      crossFromUsd: { GBP: rates.rates.GBP / rates.rates.USD, EUR: rates.rates.EUR / rates.rates.USD } } : null,
    programmes: cat.programmes.map((p) => ({ slug: p.slug, name: p.name, localNaira: p.price, internationalUsdCents: p.priceUsdCents,
      gbpMinor: check.usable && rates && p.priceUsdCents ? crossConvertMinor(p.priceUsdCents, "GBP", rates, policy.rounding as Rounding) : null,
      eurMinor: check.usable && rates && p.priceUsdCents ? crossConvertMinor(p.priceUsdCents, "EUR", rates, policy.rounding as Rounding) : null })),
    charging: { provider: "Paystack", currency: "NGN", note: "Paystack charges in naira. International tuition cannot be paid online until the owner approves a charging policy." },
  });
});

route("PUT", "/api/app/owner/fx-policy", ["admin"], async (c) => {
  await requireStrongAuth(c, "owner.fx_policy");
  const b = await c.body();
  const ch = new Checker();
  const status = ch.oneOf(b.status, ["not_approved", "approved"] as const, "a policy status");
  const sources = Array.isArray(b.sources) ? b.sources.map(String) : [];
  if (sources.some((s) => !(FX_SOURCES as readonly string[]).includes(s))) ch.errors.push("Sources must be from the existing rates feed.");
  const maxAgeHours = b.maxAgeHours === null || b.maxAgeHours === undefined || b.maxAgeHours === "" ? null : ch.int(b.maxAgeHours, 1, 720, "Maximum rate age (hours)");
  const rounding = b.rounding === null || b.rounding === undefined || b.rounding === "" ? null : ch.oneOf(b.rounding, ROUNDING, "a rounding policy");
  if (status === "approved" && (!sources.length || maxAgeHours === null || !rounding)) ch.errors.push("An approved policy needs at least one source, a maximum age and a rounding rule.");
  ch.done();
  const before = await getFxPolicy(c.db);
  const next: FxPolicy = { status, sources, maxAgeHours, rounding, updatedAt: null, updatedBy: null };
  await saveFxPolicy(c.db, next, c.user.id);
  await c.audit("owner.fx_policy", "settings", "fx_policy", { from: before, to: next });
  return ok({ policy: await getFxPolicy(c.db) });
});
