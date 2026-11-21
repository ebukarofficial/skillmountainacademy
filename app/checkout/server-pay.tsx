"use client";
// Checkout payment step when the backend is set up (database, Turnstile and, for card payments, Paystack).
// The Worker computes every amount; what this page shows is the same maths from lib/pricing.ts, for display only.
import Link from "next/link";
import { useEffect, useState } from "react";
import { BANK, CFG, FLAGS, type Programme } from "@/lib/config";
import { approx, convertParts, dueDays, lagosDate, money, planParts, type Plan } from "@/lib/pricing";
import { TERMS_VERSION } from "@/lib/terms";
import { BankDetails } from "../components";
import { useCurrency, useQuote, FxNote, PayCurrency } from "../currency";
import { useHold } from "../hold";
import { Turnstile } from "../turnstile";

export type Backend = { mode: "checking" | "server" | "legacy"; payments: boolean };

// Asks the Worker what is set up. Anything missing (or no Worker at all) keeps the original checkout.
export function useBackend(): Backend {
  const [b, setB] = useState<Backend>({ mode: "checking", payments: false });
  useEffect(() => {
    let off = false;
    fetch("/api/status", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (off) return;
        const ready = j?.ready ?? {};
        const server = !!ready.database && !!ready.turnstile && !!CFG.turnstileSiteKey;
        setB({ mode: server ? "server" : "legacy", payments: server && !!ready.payments });
      })
      .catch(() => { if (!off) setB({ mode: "legacy", payments: false }); });
    return () => { off = true; };
  }, []);
  return b;
}

type Result = { reference: string; method: "paystack" | "bank"; totalNaira: number; payNowNaira: number; parts: { seq: number; naira: number; due: string }[]; authorizationUrl: string | null };

const dateText = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function ServerPayment({ p, d, payments, onBack, onDone }: {
  p: Programme; d: Record<string, string>; payments: boolean; onBack: () => void; onDone: (r: Result) => void;
}) {
  const { currency, rates } = useCurrency();
  const { active } = useHold(p);
  const [plan, setPlan] = useState<Plan>("full");
  const [method, setMethod] = useState<"paystack" | "bank">(payments ? "paystack" : "bank");
  const [group, setGroup] = useState(false);
  const [members, setMembers] = useState([{ name: "", email: "" }]);
  const [token, setToken] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const groupOn = FLAGS.GROUP_ENABLED && p.groupPrice != null;
  const total = group && groupOn ? p.groupPrice! : active && p.timedPrice != null ? p.timedPrice : p.price;
  const parts = planParts(total, plan);
  const shown = convertParts(parts, currency, rates);
  const days = dueDays(p);
  const today = new Date();
  // Converted parts come from convertParts, so they add up exactly to the converted total shown below them.
  // The server's quote is the source of display amounts for the standard price (no group class, no timed offer).
  const quote = useQuote(p.slug, plan);
  const q = quote && quote !== "unavailable" && !(group && groupOn) && !(active && p.timedPrice != null) && quote.charge.total === total ? quote : null;
  const amount = (i: number) => (q ? (q.display.approximate ? approx(q.display.parts[i], q.currency) : money(q.display.parts[i], q.currency))
    : shown && currency !== "NGN" ? approx(shown[i], currency) : money(parts[i], "NGN"));
  const totalShown = q ? (q.display.approximate ? approx(q.display.total, q.currency) : money(q.display.total, q.currency)) : shown && currency !== "NGN" ? approx(shown.reduce((a, b) => a + b, 0), currency) : money(total, "NGN");
  const foreign = q ? q.currency !== "NGN" : !!shown && currency !== "NGN";

  async function submit() {
    setErr("");
    if (!agreed) return setErr("Please read and accept the Terms and Conditions to continue.");
    if (!token) return setErr("Please complete the security check.");
    setBusy(true);
    try {
      const r = await fetch("/api/register", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          programme: p.slug, plan, method, currency, turnstileToken: token, termsAccepted: true, termsVersion: TERMS_VERSION, website: d.website ?? "",
          members: group && groupOn ? members : [],
          learner: d,
        }),
      });
      const j = await r.json().catch(() => ({ message: "Something went wrong. Please try again." }));
      if (!r.ok || !j.ok) { setErr(j.message || "Something went wrong. Please try again."); setBusy(false); return; }
      if (j.method === "paystack" && j.authorizationUrl) { window.location.assign(j.authorizationUrl); return; }
      onDone(j as Result);
    } catch {
      setErr("We could not reach our server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-extrabold">Review and pay</h1>
      <PayCurrency />
      <div className="rounded-md bg-[#f8f8f9] p-4 text-sm">
        <p><b>{[d.firstName, d.middleName, d.surname].filter(Boolean).join(" ")}</b> · {d.email} · {d.phone}</p>
        <button type="button" onClick={onBack} className="mt-1 font-semibold text-brand-red underline">Edit my details</button>
      </div>

      {groupOn && (
        <fieldset className="rounded-md bg-[#f8f8f9] p-4" data-group-option>
          <legend className="sr-only">Group class</legend>
          <label className="flex items-start gap-3"><input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} className="mt-1 h-5 w-5 accent-indigo" />
            <span><b className="font-display">Learn with 1 or 2 friends</b><span className="block text-sm text-ink/70">You share one live class and one price. Each learner has their own record, grades and attendance.</span></span></label>
          {group && (
            <div className="mt-3 space-y-3">
              {members.map((m, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-2">
                  <input aria-label={`Friend ${i + 1} name`} placeholder={`Friend ${i + 1} name`} value={m.name} maxLength={120} onChange={(e) => setMembers(members.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} className="rounded-md border border-ink/15 bg-white px-4 py-3" />
                  <input aria-label={`Friend ${i + 1} email`} placeholder={`Friend ${i + 1} email`} type="email" value={m.email} maxLength={120} onChange={(e) => setMembers(members.map((x, k) => (k === i ? { ...x, email: e.target.value } : x)))} className="rounded-md border border-ink/15 bg-white px-4 py-3" />
                </div>
              ))}
              <div className="flex gap-3 text-sm">
                {members.length < 2 && <button type="button" onClick={() => setMembers([...members, { name: "", email: "" }])} className="font-semibold text-brand-red underline">Add another friend</button>}
                {members.length > 1 && <button type="button" onClick={() => setMembers(members.slice(0, 1))} className="font-semibold underline">Remove</button>}
              </div>
            </div>
          )}
        </fieldset>
      )}

      <fieldset>
        <legend className="font-display font-bold">How would you like to pay?</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {([["full", "Pay in full", `${amount(0)} today`], ["parts", "Pay in 3 parts", "50% today, then 30% and 20%"]] as const).filter(([v]) => v === "full" || !p.fullPaymentOnly).map(([v, t, s]) => (
            <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-md border-2 px-4 py-3 transition ${plan === v ? "border-indigo bg-white" : "border-transparent bg-[#f8f8f9]"}`}>
              <input type="radio" name="plan" checked={plan === v} onChange={() => setPlan(v)} className="mt-1 h-5 w-5 accent-indigo" />
              <span><span className="block font-display font-bold">{t}</span><span className="text-sm text-ink/70">{s}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      {plan === "parts" && (
        <div className="rounded-md bg-[#f8f8f9] p-4 text-sm" data-instalments>
          <table className="w-full">
            <tbody>
              {parts.map((_, i) => (
                <tr key={i} className="border-b border-ink/10 last:border-0">
                  <td className="py-1.5 pr-3 font-semibold">Part {i + 1} ({[50, 30, 20][i]}%)</td>
                  <td className="py-1.5 pr-3">{amount(i)}</td>
                  <td className="py-1.5 text-right text-ink/70">{i === 0 ? "Today" : dateText(lagosDate(today, days[i]))}</td>
                </tr>
              ))}
              <tr><td className="pt-2 font-bold">Total</td><td className="pt-2 font-bold">{totalShown}</td><td /></tr>
            </tbody>
          </table>
          <p className="mt-3">We email a secure Paystack link for parts 2 and 3 on their due dates, with a reminder 3 days before.</p>
          <p className="mt-1 font-semibold">Live-session access is paused if a payment is more than 2 weeks late.</p>
        </div>
      )}

      <fieldset>
        <legend className="font-display font-bold">Payment method</legend>
        <div className="mt-2 grid gap-3">
          {([["paystack", "Pay online with Paystack", payments ? "Card, bank transfer or USSD. Confirmed automatically." : "Online payment is being set up. Please use bank transfer for now."], ["bank", "Bank transfer", `Pay to our ${BANK.bank} account, then send us your teller.`]] as const).map(([v, t, s]) => (
            <label key={v} className={`flex items-start gap-3 rounded-md border-2 px-4 py-3 transition ${v === "paystack" && !payments ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${method === v ? "border-indigo bg-white" : "border-transparent bg-[#f8f8f9]"}`}>
              <input type="radio" name="method" disabled={v === "paystack" && !payments} checked={method === v} onChange={() => setMethod(v)} className="mt-1 h-5 w-5 accent-indigo" />
              <span><span className="block font-display font-bold">{t}</span><span className="text-sm text-ink/70">{s}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="rounded-md bg-indigo px-4 py-3 text-sm text-white" data-charge>
        {foreign
          ? <>Amount charged now{plan === "parts" ? " (part 1 of 3)" : ""}: <b>{money(parts[0], "NGN")}</b> in naira (NGN), about {q ? money(q.display.parts[0], q.currency) : amount(0)}. {method === "paystack" ? "Paystack charges in naira" : "Bank transfers are made in naira"}; your bank converts it at its own rate.</>
          : <>You pay <b>{money(parts[0], "NGN")}</b> now{plan === "parts" ? " (part 1 of 3)" : ""}. {method === "paystack" ? "Paystack charges in naira (NGN)." : "Transfer the amount in naira (NGN)."}</>}
        <FxNote className="mt-1 text-white/70" />
      </div>

      <label className="flex items-start gap-3 rounded-md bg-[#f8f8f9] px-4 py-3 text-sm">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-brand-red" />
        <span>I have read and understood the <Link href="/terms/" target="_blank" className="font-semibold text-brand-red underline">Terms and Conditions</Link>, <Link href="/refunds/" target="_blank" className="font-semibold text-brand-red underline">Refund Policy</Link> and <Link href="/privacy/" target="_blank" className="font-semibold text-brand-red underline">Privacy Policy</Link>. I confirm the details are correct and I agree to SMA using them to process this registration. If the learner is under 18, I am their parent or guardian and I give this consent for them.</span>
      </label>
      <Turnstile action="register" onToken={setToken} />
      {err && <p role="alert" className="font-medium text-brand-red">{err}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onBack} className="rounded-full border-2 border-indigo px-6 py-4 font-display font-semibold text-indigo">Back</button>
        <button type="button" disabled={busy || !agreed} onClick={submit} className="bg-indigo flex-1 rounded-full py-4 font-display font-semibold text-white disabled:opacity-60">
          {busy ? "Please wait…" : method === "bank" ? "Submit application" : `Pay ${money(parts[0], "NGN")} with Paystack`}
        </button>
      </div>
      {!agreed && <p className="text-center text-sm text-ink/70">Tick the box above to continue.</p>}
    </div>
  );
}

// After a bank-transfer registration: the server's amounts and the bank details.
export function BankDone({ r, p, name }: { r: Result; p: Programme; name: string }) {
  const msg = `Hello Skill Mountain Academy, I have paid ${money(r.payNowNaira, "NGN")} for ${p.name}. Name: ${name}. Reference: ${r.reference}. I am sending my teller.`;
  return (
    <>
      <h1 className="mt-5 text-center font-display text-3xl font-extrabold brand-text">Application received</h1>
      <p className="mt-3 text-center text-ink/75">Your place for <b>{p.name}</b> is reserved once we confirm your payment. Please pay <b>{money(r.payNowNaira, "NGN")}</b>{r.parts.length > 1 ? " (part 1 of 3)" : ""} to the account below and send us your teller.</p>
      <div className="mt-5"><BankDetails /></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <a href={`https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" className="bg-indigo rounded-full py-3 text-center font-display font-semibold text-white">Send teller on WhatsApp</a>
        <a href={`mailto:admission@skillmountainacademy.com?subject=${encodeURIComponent(`Teller: ${r.reference}`)}&body=${encodeURIComponent(msg)}`} className="rounded-full border-2 border-indigo py-3 text-center font-display font-semibold text-indigo">Send teller by email</a>
      </div>
    </>
  );
}

// Back from Paystack (?ref=...): waits for the payment to be confirmed by the webhook (or by asking Paystack).
export function Confirming({ reference, trx, p }: { reference: string; trx: string; p: Programme }) {
  const [state, setState] = useState<"wait" | "paid" | "part" | "slow" | "error">("wait");
  useEffect(() => {
    let n = 0;
    let t: ReturnType<typeof setTimeout>;
    const poll = async () => {
      n++;
      try {
        const r = await fetch(`/api/order?ref=${encodeURIComponent(reference)}&trxref=${encodeURIComponent(trx)}`);
        const j = await r.json();
        if (!r.ok) { setState("error"); return; }
        if (j.status === "paid") return setState("paid");
        if (j.status === "part_paid") return setState("part");
      } catch { /* try again */ }
      if (n >= 10) return setState("slow");
      t = setTimeout(poll, 3000);
    };
    poll();
    return () => clearTimeout(t);
  }, [reference, trx]);
  return (
    <div className="mx-auto max-w-xl rounded-lg bg-white p-6 text-center shadow-xl shadow-indigo/10 sm:p-8" role="status" aria-live="polite">
      {state === "wait" && <><h1 className="font-display text-2xl font-extrabold">Confirming your payment…</h1><p className="mt-3 text-ink/75">This usually takes a few seconds. Please keep this page open.</p></>}
      {(state === "paid" || state === "part") && <>
        <span className="bg-indigo mx-auto grid h-16 w-16 place-items-center rounded-full text-3xl text-white">✓</span>
        <h1 className="mt-5 font-display text-3xl font-extrabold brand-text">Payment received</h1>
        <p className="mt-3 text-ink/75">Thank you. Your place for <b>{p.name}</b> is secured. Your welcome email with your curriculum and next steps is on its way.{state === "part" ? " We will email a payment link for your next part on its due date." : ""}</p>
      </>}
      {state === "slow" && <><h1 className="font-display text-2xl font-extrabold">We are still confirming your payment</h1><p className="mt-3 text-ink/75">Paystack can take a few minutes. You will get an email as soon as it is confirmed. If money left your account and you hear nothing within an hour, contact us with your reference.</p></>}
      {state === "error" && <><h1 className="font-display text-2xl font-extrabold">We could not find that payment</h1><p className="mt-3 text-ink/75">If you paid, please contact us with your reference and we will check it for you.</p></>}
      <p className="mt-5 rounded-md bg-[#f8f8f9] px-4 py-3 text-sm">Your reference: <b>{reference}</b></p>
      <div className="mt-5"><Link href="/" className="bg-indigo inline-block rounded-full px-8 py-3 font-display font-semibold text-white">Back to home</Link></div>
    </div>
  );
}
