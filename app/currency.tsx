"use client";
// Visitor currency (Stage D). The COUNTRY decides it, never a separate choice: the country of residence the student
// selects, otherwise the country the Worker detects (GET /api/geo, from Cloudflare's request.cf.country, or the browser's
// time zone and language as a last resort). Amounts themselves always come from the server's quote (GET /api/quote),
// which applies the approved rules: NG -> local NGN tuition; US, Canada, the rest of Africa and everywhere else ->
// USD; UK -> GBP; eurozone -> EUR. Paystack charges in naira.
import { useEffect, useState, useSyncExternalStore } from "react";
import { approx, currencyForCountry, display, guessCountry, money, moneyMinor, type Currency, type Rates } from "@/lib/pricing";
import { countries, countryCode, countryName } from "@/lib/countries";

type State = { currency: Currency; rates: Rates | null; detected: Currency; country: string | null; ready: boolean };
const SERVER: State = { currency: "NGN", rates: null, detected: "NGN", country: null, ready: false };
let state: State = SERVER;
const subs = new Set<() => void>();
let started = false;
const emit = () => subs.forEach((f) => f());

const COUNTRY_KEY = "sma-country";
function readCountry(): string | null {
  try { const v = localStorage.getItem(COUNTRY_KEY); return v && /^[A-Z]{2}$/.test(v) ? v : null; } catch { return null; }
}
// Stage D: an older visit may have saved a separately chosen currency; it is no longer used.
try { if (typeof localStorage !== "undefined") localStorage.removeItem("sma-currency"); } catch { /* ignore */ }

async function start() {
  if (started) return;
  started = true;
  let detected: Currency = "NGN";
  let rates: Rates | null = null;
  let country: string | null = null;
  try {
    const cached = sessionStorage.getItem("sma-geo");
    const j = cached ? JSON.parse(cached) : await fetch("/api/geo", { headers: { accept: "application/json" } }).then((r) => (r.ok ? r.json() : null));
    if (j?.ok) {
      try { if (!cached) sessionStorage.setItem("sma-geo", JSON.stringify(j)); } catch { /* storage may be blocked */ }
      country = typeof j.country === "string" && /^[A-Z]{2}$/.test(j.country) ? j.country : null;
      detected = j.currency ?? currencyForCountry(country);
      rates = j.rates ?? null;
    } else throw new Error("no geo");
  } catch {
    country = guessCountry(Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.language);
    detected = currencyForCountry(country);
  }
  const chosen = readCountry();
  const wanted = chosen ? currencyForCountry(chosen) : detected;
  // Without exchange rates only naira can be shown as a guide.
  state = { currency: rates || wanted === "NGN" ? wanted : "NGN", rates, detected, country: chosen ?? country, ready: true };
  emit();
}

function subscribe(f: () => void) {
  subs.add(f);
  void start();
  return () => subs.delete(f);
}

export function useCurrency() {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}

// The student's country sets the display currency (NGN, USD, GBP or EUR; see currencyForCountry).
export function setCountry(code: string) {
  const c = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return;
  const cur = currencyForCountry(c);
  try { localStorage.setItem(COUNTRY_KEY, c); } catch { /* ignore */ }
  state = { ...state, country: c, currency: state.rates || cur === "NGN" ? cur : "NGN" };
  emit();
}

// Country picker. Used in the programme page's enrolment summary and in the application form, where its value
// (the country's name) is submitted with the application.
export function CountrySelect({ d, compact = false, dark = false }: { d?: Record<string, string>; compact?: boolean; dark?: boolean }) {
  const { country, ready } = useCurrency();
  const fromForm = (d?.countryCode && /^[A-Z]{2}$/.test(d.countryCode) ? d.countryCode : null) ?? countryCode(d?.country);
  const value = countryName(fromForm ?? country) ?? "";
  const [code, setCode] = useState<string | null>(null);
  const sent = code ?? fromForm ?? (value ? country : null);
  const cls = `mt-1 w-full rounded-md border px-4 py-3.5 text-base outline-none focus:ring-2 focus:ring-brand-orange/40 ${dark ? "border-white/25 bg-white/10 text-white" : "border-ink/15 bg-white focus:border-brand-orange"}`;
  return (
    <label className="block font-medium">
      <span className={compact ? "font-display text-xs font-semibold uppercase tracking-[0.18em] opacity-70" : ""}>Country of residence</span>
      {/* The ISO code goes to the server with the name; the server validates it and decides the tuition currency. */}
      <input type="hidden" name="countryCode" value={sent ?? ""} />
      <select key={ready ? "r" : "s"} name="country" required defaultValue={value} onChange={(e) => { const c = countryCode(e.target.value); if (c) { setCode(c); setCountry(c); } }} className={cls} autoComplete="country-name">
        <option value="" disabled>Select your country…</option>
        {/* Country names come from the browser's own region names, so the list is drawn only in the browser
            (the server's names can differ slightly, which would break hydration). */}
        {ready && countries().map((c) => <option key={c.code} value={c.name} className="text-ink">{c.name}</option>)}
      </select>
    </label>
  );
}

// Approximate amount in the student's currency (empty for naira or without rates).
export function Approx({ naira, className = "" }: { naira: number; className?: string }) {
  const { currency, rates } = useCurrency();
  if (currency === "NGN" || !rates) return null;
  return <span className={className} data-approx>{display(naira, currency, rates)}</span>;
}

// A naira amount. Prices on the site are always shown in naira; other currencies appear only at checkout
// (payment step and order summary), through ChargeNote and the checkout switcher.
export function Money({ naira }: { naira: number }) {
  return <>{display(naira, "NGN", null)}</>;
}

// Shown wherever converted prices appear: they are approximate, and the rate source needs a credit link.
export function FxNote({ className = "" }: { className?: string }) {
  const { currency, rates } = useCurrency();
  if (currency === "NGN" || !rates) return null;
  return (
    <p className={`text-xs ${className}`}>
      Prices in {currency} are approximate. You pay in naira (₦).{" "}
      {rates.source.includes("er-api") ? <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer" className="underline">Rates By Exchange Rate API</a> : <span>Rates: {rates.source}</span>}
    </p>
  );
}

// Checkout: exactly what is charged, and in which currency. Paystack charges in naira.
export function ChargeNote({ naira, className = "" }: { naira: number; className?: string }) {
  const { currency, rates } = useCurrency();
  const approx = currency !== "NGN" && rates ? display(naira, currency, rates) : null;
  return (
    <div className={className}>
      <p data-charge-note>Paystack will charge <b>{display(naira, "NGN", null)}</b> in naira (NGN).{approx ? <> That is {approx} at today&apos;s rate; your bank converts it at its own rate.</> : null}</p>
      <FxNote className="mt-1" />
    </div>
  );
}

// Payment step: which currency the guide amounts are shown in. Set by the country, never chosen separately.
export function PayCurrency() {
  const { currency, country } = useCurrency();
  const name = countryName(country);
  return (
    <div className="rounded-md bg-[#f8f8f9] px-4 py-3 text-sm" data-pay-currency>
      <b className="font-display">{currency === "NGN" ? "Amounts in naira (₦)" : `Amounts also shown in ${currency}`}</b>
      <span className="block text-ink/70">{currency === "NGN" ? (name && name !== "Nigeria" ? `Exchange rates are unavailable right now, so amounts are shown in naira.` : "Payment is in naira.") : `Based on your country${name ? ` (${name})` : ""}. A guide only: you pay in naira (₦).`}</span>
    </div>
  );
}

// The server's quote for a programme (GET /api/quote): the amount in the currency of the visitor's country of
// residence, and, separately, what Paystack actually charges (always naira). Conversion happens only on the server.
export type Quote = {
  ok: true; programme: string; country: string | null; currency: Currency; plan: "full" | "parts"; fullPaymentOnly: boolean;
  tier?: "local" | "international" | "international_legacy_ngn"; tuitionCurrency?: Currency;
  display: { total: number; parts: number[]; approximate: boolean; kind?: "local" | "international_tuition" | "international_benchmark_fallback" | "guide_from_naira" | "naira_only"; note?: string; totalMinor?: number; partsMinor?: number[] };
  charge: { currency: "NGN"; total: number; parts: number[]; provider: string; available?: boolean; reason?: string | null };
  rate: number; ratesUpdatedAt: string | null; source: string | null;
};
export function useQuote(slug: string, plan: "full" | "parts" = "full"): Quote | null | "unavailable" {
  const { country, ready } = useCurrency();
  const [q, setQ] = useState<Quote | null | "unavailable">(null);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    fetch(`/api/quote?programme=${encodeURIComponent(slug)}&plan=${plan}${country ? `&country=${country}` : ""}`, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live) setQ(j?.ok ? (j as Quote) : "unavailable"); })
      .catch(() => { if (live) setQ("unavailable"); });
    return () => { live = false; };
  }, [slug, plan, country, ready]);
  return q;
}

// The main figure: exact tuition from minor units; a guide conversion keeps the approximate sign (approx).
export const quoteFigure = (q: Quote, i?: number) => {
  const minor = i === undefined ? q.display.totalMinor : q.display.partsMinor?.[i];
  const whole = i === undefined ? q.display.total : q.display.parts[i];
  if (q.display.approximate) return approx(whole, q.currency);
  return minor !== undefined ? moneyMinor(minor, q.currency) : money(whole, q.currency);
};
const updated = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");

// The programme investment: the visitor's own currency is the main figure. For currencies other than naira, a short
// line explains that it is a guide at a dated exchange rate and that the exact naira charge is shown before payment.
export function QuotePrice({ slug, fallbackNaira, size = "lg" }: { slug: string; fallbackNaira: number; size?: "md" | "lg" }) {
  const q = useQuote(slug);
  const big = `font-display font-extrabold tabular-nums ${size === "lg" ? "text-3xl" : "text-2xl"}`;
  if (q === null) return <span className={`${big} text-ink/25`} aria-busy="true">…</span>;
  if (q === "unavailable") return <span className={big}>{money(fallbackNaira, "NGN")}</span>;
  return (
    <div data-quote={q.currency} data-quote-kind={q.display.kind ?? ""}>
      <span className={big}>{quoteFigure(q)}</span>
      {q.display.kind === "international_tuition" || q.display.kind === "international_benchmark_fallback" ? (
        <p className="mt-1 text-xs leading-relaxed text-ink/65">{q.display.note} {q.charge.available === false ? "Online payment of international tuition is not available yet; Admissions will confirm how to pay." : ""}</p>
      ) : q.currency !== "NGN" ? (
        <p className="mt-1 text-xs leading-relaxed text-ink/65">
          Guide amount in {q.currency}, converted from the naira tuition at the exchange rate of {updated(q.ratesUpdatedAt)}. This programme&apos;s tuition is charged in naira by {q.charge.provider}; the exact amount charged is shown before you pay.
        </p>
      ) : null}
    </div>
  );
}
