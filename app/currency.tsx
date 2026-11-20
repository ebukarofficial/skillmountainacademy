"use client";
// Visitor currency. The Worker detects the country (GET /api/geo, from Cloudflare's request.cf.country); the
// browser's time zone and language are the fallback. The header switcher overrides detection and is remembered.
// Prices are always set and charged in naira; other currencies are shown as approximate guidance at the cached rate.
import { useSyncExternalStore } from "react";
import { CURRENCIES, currencyForCountry, display, guessCountry, type Currency, type Rates } from "@/lib/pricing";

type State = { currency: Currency; rates: Rates | null; detected: Currency; ready: boolean };
const SERVER: State = { currency: "NGN", rates: null, detected: "NGN", ready: false };
let state: State = SERVER;
const subs = new Set<() => void>();
let started = false;
const emit = () => subs.forEach((f) => f());
const KEY = "sma-currency";

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
  try {
    const cached = sessionStorage.getItem("sma-geo");
    const j = cached ? JSON.parse(cached) : await fetch("/api/geo", { headers: { accept: "application/json" } }).then((r) => (r.ok ? r.json() : null));
    if (j?.ok) {
      try { if (!cached) sessionStorage.setItem("sma-geo", JSON.stringify(j)); } catch { /* storage may be blocked */ }
      detected = j.currency ?? currencyForCountry(j.country);
      rates = j.rates ?? null;
    } else throw new Error("no geo");
  } catch {
    detected = currencyForCountry(guessCountry(Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.language));
  }
  const wanted = readOverride() ?? detected;
  // Without exchange rates only naira can be shown.
  state = { currency: rates || wanted === "NGN" ? wanted : "NGN", rates, detected, ready: true };
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
        className={`h-11 cursor-pointer appearance-none rounded-full py-0 pl-4 pr-8 font-display text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand-orange ${dark ? "bg-white/15 text-white" : "bg-paper text-ink"}`}>
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
      <p data-charge-note>Paystack will charge <b>{display(naira, "NGN", null)}</b> in Nigerian naira (NGN).{approx ? <> That is {approx} at today&apos;s rate; your bank converts it at its own rate.</> : null}</p>
      <FxNote className="mt-1" />
    </div>
  );
}

// Payment step: choose which currency to see the amounts in. Starts on the visitor's detected currency.
export function PayCurrency() {
  const { currency } = useCurrency();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cream px-4 py-3" data-pay-currency>
      <span className="text-sm"><b className="font-display">Show amounts in</b><span className="block text-ink/70">{currency === "NGN" ? "Nigerian naira" : "A guide only. You pay in naira (₦)."}</span></span>
      <CurrencySwitcher />
    </div>
  );
}
