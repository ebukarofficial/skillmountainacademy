"use client";
import { Suspense, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { useSearchParams } from "next/navigation";
import logo from "@/assets/sma-logo.png";
import { CFG, PROGRAMMES } from "@/lib/config";
import { naira, pctOff, postForm, postSheet } from "../components";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { PaystackPop: any } }

const newRef = () => "SMA-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

function Checkout() {
  const id = useSearchParams().get("p");
  const p = PROGRAMMES.find((x) => x.id === id && x.live);
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState("");
  const [err, setErr] = useState("");

  if (!p) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="font-display text-3xl font-extrabold">Choose a programme</h1>
        <p className="mt-3 text-ink/70">We could not find that programme. Pick one from the list.</p>
        <Link href="/#programmes" className="brand-bg mt-6 inline-block rounded-full px-8 py-3 font-display font-semibold text-white">See programmes</Link>
      </div>
    );
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    if (!p) return;
    if (!window.PaystackPop || !CFG.paystackKey) return setErr("Payment is not ready yet. Refresh the page and try again.");
    const f = new FormData(e.currentTarget);
    const d = { name: String(f.get("name")).trim(), email: String(f.get("email")).trim(), phone: String(f.get("phone")).trim() };
    const reference = newRef();
    setBusy(true);
    await postForm({ ...d, programme: p.name, amount: p.fee!, reference }); // registration lands in your Google Sheet
    window.PaystackPop.setup({
      key: CFG.paystackKey, email: d.email, amount: p.fee! * 100, currency: "NGN", ref: reference,
      channels: ["card", "bank_transfer"],
      metadata: { programme: p.name, name: d.name, phone: d.phone },
      // The server re-checks the payment with Paystack, then sends the confirmation email.
      callback: () => { postSheet({ action: "verify", reference }); setBusy(false); setRef(reference); },
      onClose: () => setBusy(false),
    }).openIframe();
  }

  const off = pctOff(p);
  const field = "mt-1 w-full rounded-2xl border border-ink/15 bg-white px-4 py-3.5 text-base outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/40";

  if (ref) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <p className="brand-bg mx-auto grid h-16 w-16 place-items-center rounded-full text-3xl text-white">✓</p>
        <h1 className="brand-text mt-5 font-display text-3xl font-extrabold">Payment received</h1>
        <p className="mt-3 text-ink/70">We are confirming it with Paystack. A payment confirmation email with your learning resources will reach you shortly. Check your spam folder if you don&apos;t see it.</p>
        <p className="mt-5 rounded-2xl bg-paper px-4 py-3 text-sm">Programme: <b>{p.name}</b><br />Reference: <b>{ref}</b></p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-indigo px-8 py-3 font-display font-semibold text-cream">Back to home</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-5 py-10 md:grid-cols-[1fr_1.1fr] md:py-16">
      <aside className="h-fit rounded-[1.75rem] bg-indigo p-7 text-white">
        <p className="text-sm text-white/70">Your order</p>
        <h1 className="mt-1 font-display text-2xl font-extrabold">{p.name}</h1>
        <p className="mt-1 text-white/75">{p.months ? `${p.months} months · ` : ""}one-on-one with a mentor</p>
        <ul className="mt-5 list-disc space-y-1 pl-5 text-sm text-white/80">{p.learn.slice(0, 4).map((l) => <li key={l}>{l}</li>)}</ul>
        <dl className="mt-6 space-y-2 border-t border-white/20 pt-5">
          {off > 0 && <div className="flex justify-between text-white/70"><dt>Original price</dt><dd><s>{naira(p.was!)}</s></dd></div>}
          {off > 0 && <div className="flex justify-between text-brand-orange"><dt>Discount ({off}%)</dt><dd>-{naira(p.was! - p.fee!)}</dd></div>}
          <div className="flex justify-between font-display text-xl font-extrabold"><dt>Total</dt><dd>{naira(p.fee!)}</dd></div>
        </dl>
      </aside>

      <form onSubmit={submit} className="space-y-4 rounded-[1.75rem] bg-paper p-7">
        <h2 className="font-display text-2xl font-extrabold">Your details</h2>
        <label className="block font-medium">Full name<input name="name" required autoComplete="name" className={field} /></label>
        <label className="block font-medium">Email<input name="email" type="email" required autoComplete="email" className={field} /></label>
        <label className="block font-medium">Phone or WhatsApp<input name="phone" type="tel" required autoComplete="tel" className={field} /></label>
        <p className="rounded-2xl bg-cream px-4 py-3 text-sm text-ink/70">Your payment confirmation and learning resources will be sent to this email.</p>
        {err && <p role="alert" className="font-medium text-brand-red">{err}</p>}
        <button disabled={busy} className="brand-bg w-full rounded-full py-4 font-display font-semibold text-white disabled:opacity-60">
          {busy ? "Opening payment…" : `Pay ${naira(p.fee!)} with Paystack`}
        </button>
        <p className="text-center text-sm text-ink/60">Secure payment by card or bank transfer.</p>
      </form>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <main className="min-h-screen">
      <Script src="https://js.paystack.co/v1/inline.js" strategy="afterInteractive" />
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
        <Link href="/" aria-label="Skill Mountain Academy home"><Image src={logo} alt="Skill Mountain Academy" priority unoptimized className="h-9 w-auto sm:h-11" /></Link>
        <Link href="/#programmes" className="rounded-full bg-paper px-5 py-2 text-sm font-medium transition hover:bg-white">← All programmes</Link>
      </header>
      <Suspense fallback={<p className="px-5 py-20 text-center text-ink/60">Loading checkout…</p>}><Checkout /></Suspense>
    </main>
  );
}
