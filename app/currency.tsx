"use client";
// Visitor currency. The country decides it: first the country the Worker detects (GET /api/geo, from Cloudflare's
// request.cf.country, or the browser's time zone and language as a fallback), then the country the student selects
// at enrolment. Students are never asked to pick a currency. Prices are always set and charged in naira; other
// currencies are shown as approximate guidance at the cached rate.
import { useEffect, useState, useSyncExternalStore } from "react";
import { approx, CURRENCIES, currencyForCountry, display, guessCountry, money, type Currency, type Rates } from "@/lib/pricing";
import { countries, countryCode, countryName } from "@/lib/countries";

type State = { currency: Currency; rates: Rates | null; detected: Currency; country: string | null; ready: boolean };
const SERVER: State = { currency: "NGN", rates: null, detected: "NGN", country: null, ready: false };
let state: State = SERVER;
const subs = new Set<() => void>();
let started = false;
const emit = () => subs.forEach((f) => f());
const KEY = "sma-currency";

const COUNTRY_KEY = "sma-country";
function readCountry(): string | null {
  try { const v = localStorage.getItem(COUNTRY_KEY); return v && /^[A-Z]{2}$/.test(v) ? v : null; } catch { return null; }
}

function readOverride(): Currency | null {
  try {
    const v = localStorage.getItem(KEY);
    return (CURRENCIES as readonly string[]).includes(v ?? "") ? (v as Currency) : null;
  } catch { return null; }
}

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
  const wanted = readOverride() ?? detected;
  const chosen = readCountry();
  // Without exchange rates only naira can be shown.
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

export function setCurrency(c: Currency) {
  try { localStorage.setItem(KEY, c); } catch { /* ignore */ }
  state = { ...state, currency: state.rates || c === "NGN" ? c : "NGN" };
  emit();
}

// The student's country sets the display currency (NGN, USD, GBP or EUR; see currencyForCountry).
export function setCountry(code: string) {
  const c = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return;
  const cur = currencyForCountry(c);
  try { localStorage.setItem(COUNTRY_KEY, c); localStorage.setItem(KEY, cur); } catch { /* ignore */ }
  state = { ...state, country: c, currency: state.rates || cur === "NGN" ? cur : "NGN" };
  emit();
}

// Country picker. Used in the programme page's enrolment summary and in the application form, where its value
// (the country's name) is submitted with the application.
export function CountrySelect({ d, compact = false, dark = false }: { d?: Record<string, string>; compact?: boolean; dark?: boolean }) {
  const { country, ready } = useCurrency();
  const fromForm = countryCode(d?.country);
  const value = countryName(fromForm ?? country) ?? "";
  const cls = `mt-1 w-full rounded-md border px-4 py-3.5 text-base outline-none focus:ring-2 focus:ring-brand-orange/40 ${dark ? "border-white/25 bg-white/10 text-white" : "border-ink/15 bg-white focus:border-brand-orange"}`;
  return (
    <label className="block font-medium">
      <span className={compact ? "font-display text-xs font-semibold uppercase tracking-[0.18em] opacity-70" : ""}>Country of residence</span>
      <select key={ready ? "r" : "s"} name="country" required defaultValue={value} onChange={(e) => { const c = countryCode(e.target.value); if (c) setCountry(c); }} className={cls} autoComplete="country-name">
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

export function CurrencySwitcher({ dark = false }: { dark?: boolean }) {
  const { currency, rates } = useCurrency();
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Show prices in</span>
      <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}
        className={`h-11 cursor-pointer appearance-none rounded-full py-0 pl-4 pr-8 font-display text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand-orange ${dark ? "bg-white/15 text-white" : "bg-white text-ink"}`}>
        {CURRENCIES.map((c) => <option key={c} value={c} disabled={c !== "NGN" && !rates} className="text-ink">{c === "NGN" ? "₦ NGN" : c === "USD" ? "$ USD" : c === "GBP" ? "£ GBP" : "€ EUR"}</option>)}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-3 text-xs">▾</span>
    </label>
  );
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
  display: { total: number; parts: number[]; approximate: boolean };
  charge: { currency: "NGN"; total: number; parts: number[]; provider: string };
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

const updated = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");

// The programme investment: the visitor's own currency is the main figure. For currencies other than naira, a short
// line explains that it is a guide at a dated exchange rate and that the exact naira charge is shown before payment.
export function QuotePrice({ slug, fallbackNaira, size = "lg" }: { slug: string; fallbackNaira: number; size?: "md" | "lg" }) {
  const q = useQuote(slug);
  const big = `font-display font-extrabold tabular-nums ${size === "lg" ? "text-3xl" : "text-2xl"}`;
  if (q === null) return <span className={`${big} text-ink/25`} aria-busy="true">…</span>;
  if (q === "unavailable") return <span className={big}>{money(fallbackNaira, "NGN")}</span>;
  return (
    <div data-quote={q.currency}>
      <span className={big}>{q.display.approximate ? approx(q.display.total, q.currency) : money(q.display.total, q.currency)}</span>
      {q.currency !== "NGN" && (
        <p className="mt-1 text-xs leading-relaxed text-ink/65">
          Guide amount in {q.currency} at the exchange rate of {updated(q.ratesUpdatedAt)}. Payment is processed in naira by {q.charge.provider}; the exact amount charged is shown before you pay.
        </p>
      )}
    </div>
  );
}
