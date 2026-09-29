"use client";
import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import Script from "next/script";
import logo from "@/assets/sma-logo.png";
import logoWhite from "@/assets/sma-logo-white.png";
import posterGraphics from "@/assets/poster-graphics.webp";
import { CFG, PROGRAMMES, type Programme } from "@/lib/config";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { PaystackPop: any } }

const naira = (n: number) => "₦" + n.toLocaleString("en-NG");
const NAV = [["#programmes", "Programmes"], ["#why", "Why one-on-one"], ["#how", "How it works"], ["#faq", "FAQ"]];

function Chevrons({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 120" fill="none" stroke="currentColor" strokeWidth="1.2" className={className} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={i} d={`M${10 + i * 14} 116 L100 ${10 + i * 14} L${190 - i * 14} 116`} />
      ))}
    </svg>
  );
}

export default function Home() {
  const [menu, setMenu] = useState(false);
  const [cat, setCat] = useState("All");
  const [pick, setPick] = useState<Programme | null>(null);
  const cats = ["All", ...Array.from(new Set(PROGRAMMES.map((p) => p.tag)))];
  const list = PROGRAMMES.filter((p) => cat === "All" || p.tag === cat);
  const live = PROGRAMMES.filter((p) => p.live);

  return (
    <main className="overflow-x-clip">
      <Script src="https://js.paystack.co/v1/inline.js" strategy="lazyOnload" />

      {/* Header */}
      <header className="sticky top-0 z-30 bg-cream/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3" aria-label="Main">
          <a href="#top" aria-label="Skill Mountain Academy home">
            <Image src={logo} alt="Skill Mountain Academy" priority unoptimized className="h-9 w-auto sm:h-11" />
          </a>
          <div className="hidden items-center gap-8 font-medium lg:flex">
            {NAV.map(([h, t]) => <a key={h} href={h} className="transition hover:text-brand-red">{t}</a>)}
          </div>
          <a href="#programmes" className="hidden rounded-full bg-indigo px-6 py-2.5 font-display text-sm font-semibold text-cream transition hover:bg-navy lg:block">
            Register now
          </a>
          <button aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}
            className="grid h-11 w-11 place-items-center rounded-full bg-paper text-lg lg:hidden">{menu ? "✕" : "☰"}</button>
        </nav>
        {menu && (
          <div className="pop mx-5 mb-3 flex flex-col gap-1 rounded-3xl bg-paper p-3 lg:hidden" onClick={() => setMenu(false)}>
            {NAV.map(([h, t]) => <a key={h} href={h} className="rounded-2xl px-4 py-3.5 font-medium hover:bg-cream">{t}</a>)}
            <a href="#programmes" className="brand-bg mt-1 rounded-2xl px-4 py-3.5 text-center font-display font-semibold text-white">Register now</a>
          </div>
        )}
      </header>

      {/* Hero */}
      <section id="top" className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-8 lg:grid-cols-[1.05fr_.95fr] lg:pt-14">
        <div>
          <h1 className="font-display text-[2.6rem] font-extrabold leading-[1.05] sm:text-6xl xl:text-7xl">
            <span className="brand-text">Learn a skill</span><br />with a mentor<br />just for you.
          </h1>
          <p className="mt-6 max-w-lg text-xl text-ink/70">
            Skill Mountain Academy teaches you one-on-one for six months. Pick your programme, register and start climbing.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#programmes" className="brand-bg rounded-full px-8 py-4 font-display font-semibold text-white shadow-lg shadow-brand-red/20 transition hover:-translate-y-0.5">
              See programmes
            </a>
            <a href="#how" className="rounded-full bg-paper px-8 py-4 font-display font-semibold transition hover:bg-white">How it works</a>
          </div>
          <dl className="mt-10 flex gap-8">
            {live.map((p) => (
              <div key={p.id}>
                <dt className="text-sm text-ink/60">{p.name}</dt>
                <dd className="font-display text-xl font-bold">{naira(p.fee!)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative mx-auto w-full max-w-md">
          <Chevrons className="absolute -right-10 -top-10 h-56 w-72 text-brand-orange/60" />
          <div className="float relative overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-indigo/20">
            <Image src={posterGraphics} alt="Full Stack Graphic Design certificate programme" priority className="h-auto w-full" />
          </div>
          <div className="absolute -bottom-5 -left-3 rounded-2xl bg-indigo px-5 py-3 text-white shadow-xl sm:-left-8">
            <p className="text-sm text-white/70">Duration</p>
            <p className="font-display font-bold">6 months, 1-on-1</p>
          </div>
        </div>
      </section>

      {/* Ticker */}
      <div className="overflow-hidden bg-indigo py-4 font-display text-lg font-semibold text-white" aria-hidden="true">
        <div className="marquee flex w-max gap-10 whitespace-nowrap">
          {[0, 1, 2].map((k) => PROGRAMMES.map((p) => <span key={k + p.id} className="text-brand-orange">{p.name}<span className="ml-10 text-white/40">◆</span></span>))}
        </div>
      </div>

      {/* Programmes */}
      <section id="programmes" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:py-20">
        <h2 className="font-display text-3xl font-extrabold sm:text-5xl"><span className="brand-text">Choose your programme</span></h2>
        <p className="mt-3 max-w-xl text-ink/70">Register for an open programme below. More skills are on the way.</p>
        <div className="mt-6 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Categories">
          {cats.map((c) => (
            <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)}
              className={`shrink-0 rounded-full px-5 py-2.5 font-medium transition ${cat === c ? "bg-indigo text-white" : "bg-paper hover:bg-white"}`}>{c}</button>
          ))}
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => (
            <article key={p.id} className="flex flex-col rounded-[1.75rem] bg-paper p-4 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo/10">
              <div className={`relative h-40 overflow-hidden rounded-2xl ${p.live ? `bg-gradient-to-br ${p.tone}` : "bg-ink/10"}`}>
                <Chevrons className={`absolute -right-6 top-2 h-40 w-56 ${p.live ? "text-white/40" : "text-ink/15"}`} />
                <span className={`absolute bottom-3 left-4 rounded-full px-3 py-1 text-sm font-medium ${p.live ? "bg-white/85" : "bg-white/60 text-ink/60"}`}>{p.tag}</span>
              </div>
              <div className="flex flex-1 flex-col px-2 pb-2 pt-5">
                <h3 className="font-display text-xl font-bold">{p.name}</h3>
                <p className="mt-2 flex-1 text-ink/70">{p.blurb}</p>
                {p.live ? (
                  <>
                    <p className="mt-5 font-display text-2xl font-extrabold">{naira(p.fee!)}</p>
                    <p className="text-sm text-ink/60">{p.months} months, one-on-one</p>
                    <button onClick={() => setPick(p)} className="brand-bg mt-4 rounded-full py-3.5 font-display font-semibold text-white transition hover:brightness-110">
                      Register for {p.name}
                    </button>
                  </>
                ) : (
                  <p className="mt-5 rounded-full bg-cream py-3.5 text-center font-display font-semibold text-ink/50">Coming soon</p>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Why one-on-one */}
      <section id="why" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-16 sm:pb-20">
        <h2 className="font-display text-3xl font-extrabold sm:text-5xl"><span className="brand-text">Why one-on-one</span></h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            ["Your pace", "Lessons move as fast as you do, so nothing gets skipped and nothing drags."],
            ["A mentor for you", "Your questions get direct answers from the person teaching you."],
            ["Learn by doing", "You practise on real tasks, not just slides and videos."],
          ].map(([t, d], i) => (
            <div key={t} className={`rounded-[1.75rem] p-7 ${["bg-brand-orange/25", "bg-indigo text-white", "bg-paper"][i]}`}>
              <h3 className="font-display text-xl font-bold">{t}</h3>
              <p className={`mt-2 ${i === 1 ? "text-white/75" : "text-ink/70"}`}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="relative scroll-mt-20 overflow-hidden bg-indigo py-16 text-white sm:py-20">
        <Chevrons className="pointer-events-none absolute -right-16 top-0 h-80 w-[28rem] text-white/10" />
        <div className="relative mx-auto max-w-6xl px-5">
          <h2 className="font-display text-3xl font-extrabold sm:text-5xl">How it works</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {["Pick a programme", "Fill in the registration form", "Pay with Paystack by card or transfer", "Get your learning resources by email"].map((t, i) => (
              <li key={t} className="rounded-[1.75rem] bg-white/10 p-6 backdrop-blur">
                <span className="brand-bg grid h-10 w-10 place-items-center rounded-full font-display font-bold">{i + 1}</span>
                <p className="mt-4 text-lg font-medium">{t}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-5 py-16 sm:py-20">
        <h2 className="font-display text-3xl font-extrabold sm:text-5xl"><span className="brand-text">Questions</span></h2>
        <div className="mt-8 space-y-3">
          {[
            ["How do I pay?", "After you register, Paystack opens. You can pay by card or bank transfer."],
            ["What happens after I pay?", "Once Paystack confirms your payment, we email your learning resources to the address you registered with."],
            ["Can I register for the other skills?", "Not yet. They show Coming soon and will open for registration when they are ready."],
            ["I did not get my email. What now?", "Check your spam folder first, then contact us with your payment reference."],
          ].map(([q, a]) => (
            <details key={q} className="group rounded-2xl bg-paper px-5 py-4 open:shadow-md">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display font-semibold">
                {q}<span className="text-brand-red transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-ink/70">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer id="contact" className="bg-indigo text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
          <Image src={logoWhite} alt="Skill Mountain Academy" unoptimized className="-my-10 h-auto w-56" />
          <div className="text-white/75">
            {CFG.whatsapp && (
              <a href={`https://wa.me/${CFG.whatsapp}`} className="font-display font-semibold text-brand-orange hover:underline">Chat with us on WhatsApp</a>
            )}
            <p className="text-sm">© {new Date().getFullYear()} Skill Mountain Academy. Abuja, Nigeria.</p>
          </div>
        </div>
      </footer>

      {pick && <Register p={pick} onClose={() => setPick(null)} />}
    </main>
  );
}

function Register({ p, onClose }: { p: Programme; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [onClose]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    if (!window.PaystackPop || !CFG.paystackKey) return setErr("Payment is not ready yet. Refresh the page and try again.");
    const f = new FormData(e.currentTarget);
    const d = { name: String(f.get("name")).trim(), email: String(f.get("email")).trim(), phone: String(f.get("phone")).trim() };
    const ref = "SMA-" + Date.now();
    setBusy(true);
    try { // Saved as PENDING; the payment webhook flips the row to PAID.
      if (CFG.sheetUrl) await fetch(CFG.sheetUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ ...d, programme: p.name, fee: p.fee, reference: ref }) });
    } catch { /* registration still continues to payment */ }
    window.PaystackPop.setup({
      key: CFG.paystackKey, email: d.email, amount: p.fee! * 100, currency: "NGN", ref,
      channels: ["card", "bank_transfer"],
      metadata: { programme: p.id, name: d.name, phone: d.phone },
      callback: () => { setBusy(false); setDone(true); },
      onClose: () => setBusy(false),
    }).openIframe();
  }

  const field = "mt-1 w-full rounded-2xl border border-ink/15 bg-white px-4 py-3.5 text-base outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/40";
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-ink/60 sm:place-items-center sm:p-5" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Register for ${p.name}`} onClick={(e) => e.stopPropagation()}
        className="pop max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[2rem] bg-paper p-6 sm:rounded-[2rem]">
        {done ? (
          <div className="py-6 text-center">
            <p className="font-display text-2xl font-extrabold"><span className="brand-text">Payment received</span></p>
            <p className="mt-3 text-ink/70">We are confirming it now. Your learning resources will arrive by email shortly. Check spam if you don&apos;t see it.</p>
            <button onClick={onClose} className="brand-bg mt-6 rounded-full px-8 py-3 font-display font-semibold text-white">Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl font-extrabold">{p.name}</h2>
                <p className="text-ink/70">{naira(p.fee!)} · {p.months} months · one-on-one</p>
              </div>
              <button type="button" aria-label="Close" onClick={onClose} className="h-10 w-10 shrink-0 rounded-full bg-cream">✕</button>
            </div>
            <label className="block font-medium">Full name<input name="name" required autoComplete="name" className={field} /></label>
            <label className="block font-medium">Email<input name="email" type="email" required autoComplete="email" className={field} /></label>
            <label className="block font-medium">Phone or WhatsApp<input name="phone" type="tel" required autoComplete="tel" className={field} /></label>
            {err && <p role="alert" className="font-medium text-brand-red">{err}</p>}
            <button disabled={busy} className="brand-bg w-full rounded-full py-4 font-display font-semibold text-white disabled:opacity-60">
              {busy ? "Opening payment…" : `Pay ${naira(p.fee!)} with Paystack`}
            </button>
            <p className="text-center text-sm text-ink/60">Pay by card or bank transfer.</p>
          </form>
        )}
      </div>
    </div>
  );
}
