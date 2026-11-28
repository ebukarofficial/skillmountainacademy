// Country-based tuition: storage and request helpers (Stage D). The rules themselves are in pricing-rules.ts.
import { COUNTRY_CODES } from "../../lib/countries.ts";
import { ROUNDING } from "../../lib/pricing.ts";
import { getSetting, putSetting } from "./lms/data/engagement";
import { nowIso } from "./http";
import { DEFAULT_FX, type FxPolicy } from "./pricing-rules";
export * from "./pricing-rules";

const FX_KEY = "fx_policy";
export async function getFxPolicy(db: D1Database | undefined): Promise<FxPolicy> {
  if (!db) return DEFAULT_FX;
  const v = await getSetting<Partial<FxPolicy>>(db, FX_KEY).catch(() => null);
  const p = { ...DEFAULT_FX, ...(v ?? {}) };
  const complete = p.status === "approved" && p.sources.length > 0 && Number.isInteger(p.maxAgeHours) && !!p.rounding && (ROUNDING as readonly string[]).includes(p.rounding);
  return complete ? p : { ...p, status: "not_approved" };
}
export const saveFxPolicy = (db: D1Database, p: FxPolicy, by: string) => putSetting(db, FX_KEY, { ...p, updatedAt: nowIso(), updatedBy: by }, by, nowIso());


// The form sends the ISO code; older pages send only the country's English name. Matched with the same names the
// browser list uses (Intl.DisplayNames), exact and case-insensitive; anything else is no residence country.
export function countryCodeServer(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return COUNTRY_CODES.find((c) => dn.of(c)?.toLowerCase() === n) ?? null;
  } catch { return null; }
}

export async function recordPricingSnapshot(db: D1Database | undefined, orderId: string, s: { residence: string | null; network: string | null; tier: string; tuitionCurrency: string; tuitionMinor: number | null; snapshot: string }) {
  if (!db) return false;
  return db.prepare(`UPDATE orders SET residence_country = ?2, ip_country = ?3, pricing_tier = ?4, tuition_currency = ?5, tuition_minor = ?6, charge_currency = 'NGN', pricing_snapshot = ?7
    WHERE id = ?1 AND pricing_snapshot IS NULL`).bind(orderId, s.residence, s.network, s.tier, s.tuitionCurrency, s.tuitionMinor, s.snapshot).run().then(() => true, () => false);
}
