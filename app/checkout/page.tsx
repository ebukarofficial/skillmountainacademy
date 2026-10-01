"use client";
import { Suspense, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { useSearchParams } from "next/navigation";
import logo from "@/assets/sma-logo.png";
import { CFG, GFORM, PROGRAMMES, type Programme } from "@/lib/config";
import { PHOTO, naira, postForm, postSheet } from "../components";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { PaystackPop: any } }

const newRef = () => "SMA-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

function Checkout() {
  const id = useSearchParams().get("p");
  const p = PROGRAMMES.find((x) => x.id === id && x.live);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState<{ ref: string; email: string } | null>(null);
  const [err, setErr] = useState("");

  async function pay(e: FormEvent<HTMLFormElement>, prog: Programme) {
    e.preventDefault();
    setErr("");
    if (!window.PaystackPop || !CFG.paystackKey) return setErr("Payment is not ready yet. Refresh the page and try again.");
    const f = new FormData(e.currentTarget);
    const d = { name: String(f.get("name")).trim(), email: String(f.get("email")).trim(), phone: String(f.get("phone")).trim() };
    const reference = newRef();
    setBusy(true);
    await postForm({ ...d, programme: prog.name, reference }); // registration goes to the Google Form
    window.PaystackPop.setup({
      key: CFG.paystackKey, email: d.email, amount: prog.fee! * 100, currency: "NGN", ref: reference,
      channels: ["card", "bank_transfer"],
      metadata: { programme: prog.name, name: d.name, phone: d.phone },
      // The server re-checks the payment with Paystack, then emails the confirmation and resources.
      callback: () => { postSheet({ action: "verify", reference }); setBusy(false); setPaid({ ref: reference, email: d.email }); },
      onClose: () => setBusy(false),
    }).openIframe();
  }

  const field = "mt-1 w-full rounded-2xl border border-ink/15 bg-white px-4 py-3.5 text-base outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/40";

  if (paid && p) {
    return (
      <div className="mx-auto max-w-xl rounded-[2rem] bg-paper p-8 text-center shadow-xl shadow-indigo/10">
        <span className="brand-bg mx-auto grid h-16 w-16 place-items-center rounded-full text-3xl text-white">✓</span>
        <h1 className="mt-5 font-display text-3xl font-extrabold brand-text">Payment received</h1>
        <p className="mt-3 text-ink/75">Thank you. We are confirming your payment for <b>{p.name}</b> with Paystack. A confirmation email is on its way to <b>{paid.email}</b>, together with your learning resources.</p>
        <p className="mt-4 rounded-2xl bg-cream px-4 py-3 text-sm">Payment reference: <b>{paid.ref}</b></p>
        <p className="mt-3 text-sm text-ink/60">Nothing in your inbox after a few minutes? Check your spam folder, then contact us with your reference.</p>
        <Link href="/" className="brand-bg mt-6 inline-block rounded-full px-8 py-3 font-display font-semibold text-white">Back to home</Link>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-3xl font-extrabold">Choose a programme to register for</h1>
        <div className="mt-6 grid gap-3">
          {PROGRAMMES.filter((x) => x.live).map((x) => (
            <Link key={x.id} href={`/checkout/?p=${x.id}`} className="flex items-center justify-between gap-4 rounded-2xl bg-paper px-5 py-4 transition hover:shadow-lg">
              <span className="font-display font-bold">{x.name}</span><span className="font-display font-extrabold">{naira(x.fee!)}</span>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1.1fr_.9fr]">
      <form onSubmit={(e) => pay(e, p)} className="space-y-4 rounded-[2rem] bg-paper p-6 shadow-xl shadow-indigo/10 sm:p-8">
        <h1 className="font-display text-3xl font-extrabold">Register and pay</h1>
        <p className="text-ink/70">Fill in your details, then pay securely with Paystack.</p>
        <label className="block font-medium">Full name<input name="name" required autoComplete="name" className={field} /></label>
        <label className="block font-medium">Email<input name="email" type="email" required autoComplete="email" className={field} /></label>
        <label className="block font-medium">Phone or WhatsApp<input name="phone" type="tel" required autoComplete="tel" className={field} /></label>
        {!GFORM.url && <p className="rounded-xl bg-brand-orange/20 px-4 py-2 text-sm">Setup note: the Google Form is not connected yet, so registrations will not be saved.</p>}
        {err && <p role="alert" className="font-medium text-brand-red">{err}</p>}
        <button disabled={busy} className="brand-bg w-full rounded-full py-4 font-display font-semibold text-white disabled:opacity-60">
          {busy ? "Opening payment…" : `Pay ${naira(p.fee!)} with Paystack`}
        </button>
        <p className="text-center text-sm text-ink/60">Pay by card or bank transfer. Your payment is handled by Paystack.</p>
      </form>

      <aside className="h-fit rounded-[2rem] bg-indigo p-6 text-white shadow-xl shadow-indigo/20 sm:p-8">
        <p className="text-sm font-medium text-white/60">Your order</p>
        <div className="mt-4 flex gap-4">
          <div className={`relative h-24 w-20 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br ${p.tone}`}>
            <Image src={PHOTO[p.id]} alt="" fill sizes="80px" className="object-cover object-top" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold">{p.name}</h2>
            <p className="text-white/70">{p.months ? `${p.months} months · ` : ""}one-on-one mentorship</p>
          </div>
        </div>
        <div className="mt-6 space-y-2 border-t border-white/15 pt-5">
          {p.was && <div className="flex justify-between text-white/70"><span>Original price</span><s>{naira(p.was)}</s></div>}
          {p.was && <div className="flex justify-between text-brand-orange"><span>You save</span><span>{naira(p.was - p.fee!)}</span></div>}
          <div className="flex items-end justify-between pt-2"><span className="text-white/80">Total</span><span className="font-display text-3xl font-extrabold">{naira(p.fee!)}</span></div>
        </div>
        <ul className="mt-6 space-y-2 text-sm text-white/75">
          <li>✓ Pay by card or bank transfer</li>
          <li>✓ Payment confirmation email right after you pay</li>
          <li>✓ Learning resources sent to your inbox</li>
        </ul>
        <Link href="/#programmes" className="mt-6 inline-block text-sm text-white/70 underline hover:text-white">Choose a different programme</Link>
      </aside>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <main className="min-h-screen overflow-x-clip pb-16">
      <Script src="https://js.paystack.co/v1/inline.js" strategy="lazyOnload" />
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Link href="/" aria-label="Skill Mountain Academy home"><Image src={logo} alt="Skill Mountain Academy" priority unoptimized className="h-10 w-auto sm:h-12" /></Link>
        <span className="rounded-full bg-paper px-4 py-1.5 text-sm font-medium">🔒 Secure checkout</span>
      </header>
      <div className="px-5 pt-4">
        <Suspense fallback={<p className="text-center text-ink/60">Loading checkout…</p>}><Checkout /></Suspense>
      </div>
    </main>
  );
}
