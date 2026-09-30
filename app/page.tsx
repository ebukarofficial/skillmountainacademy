"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image, { type StaticImageData } from "next/image";
import Script from "next/script";
import logo from "@/assets/sma-logo.png";
import logoWhite from "@/assets/sma-logo-white.png";
import pGraphics from "@/assets/photos/photo-graphics.webp";
import pDevops from "@/assets/photos/photo-devops.webp";
import pUiux from "@/assets/photos/photo-uiux.webp";
import pWeb from "@/assets/photos/photo-web.webp";
import pCert from "@/assets/photos/photo-certificate.webp";
import pMega from "@/assets/photos/photo-megaphone.webp";
import banner from "@/assets/photos/banner-students.webp";
import { AUDIENCE, CFG, PROGRAMMES, type Programme } from "@/lib/config";
import { Chevrons, Intro, Register, Reveal, naira, postSheet } from "./components";

const PHOTO: Record<string, StaticImageData> = { graphics: pGraphics, devops: pDevops, uiux: pUiux, web: pWeb };
const NAV = [["#programmes", "Programmes"], ["#why", "Why SMA"], ["#who", "Who it's for"], ["#how", "How it works"], ["#faq", "FAQ"]];

type Slide = { id: string; name: string; tone: string; photo: StaticImageData; note: string; prog?: Programme };
const SLIDES: Slide[] = [
  ...PROGRAMMES.map((p) => ({ id: p.id, name: p.name, tone: p.tone, photo: PHOTO[p.id], prog: p,
    note: p.live ? `${naira(p.fee!)} · ${p.months} months` : "Coming soon" })),
  { id: "cert", name: "SMA Certificate", tone: "from-indigo via-navy to-brand-red", photo: pCert, note: "Finish your programme, earn your certificate" },
];

export default function Home() {
  const [menu, setMenu] = useState(false);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Programme | null>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [joined, setJoined] = useState(false);
  const closeReg = useCallback(() => setPick(null), []);
  const touch = useRef(0);
  const rail = useRef<HTMLDivElement>(null);

  const cats = ["All", ...Array.from(new Set(PROGRAMMES.map((p) => p.tag)))];
  const term = q.trim().toLowerCase();
  const list = PROGRAMMES.filter((p) => (cat === "All" || p.tag === cat) && (!term || `${p.name} ${p.tag} ${p.blurb}`.toLowerCase().includes(term)));

  useEffect(() => { // hero auto-advance
    if (paused) return;
    const t = setInterval(() => setActive((a) => (a + 1) % SLIDES.length), 5500);
    return () => clearInterval(t);
  }, [paused]);

  useEffect(() => { // scroll progress bar
    const on = () => { const h = document.documentElement; setProgress(h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)); };
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const go = (e: FormEvent) => { e.preventDefault(); document.getElementById("programmes")?.scrollIntoView({ behavior: "smooth" }); };
  const join = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email")).trim();
    await postSheet({ action: "subscribe", email });
    setJoined(true);
  };
  const slide = (d: number) => setActive((a) => (a + d + SLIDES.length) % SLIDES.length);

  return (
    <main className="overflow-x-clip">
      <Intro />
      <Script src="https://js.paystack.co/v1/inline.js" strategy="lazyOnload" />
      <div className="fixed left-0 top-0 z-50 h-1 brand-bg" style={{ width: `${progress * 100}%` }} aria-hidden="true" />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-cream/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3" aria-label="Main">
          <a href="#top" aria-label="Skill Mountain Academy home">
            <Image src={logo} alt="Skill Mountain Academy" priority unoptimized className="h-9 w-auto sm:h-11" />
          </a>
          <div className="hidden items-center gap-7 font-medium lg:flex">
            {NAV.map(([h, t]) => <a key={h} href={h} className="transition hover:text-brand-red">{t}</a>)}
          </div>
          <a href="#programmes" className="hidden rounded-full bg-indigo px-6 py-2.5 font-display text-sm font-semibold text-cream transition hover:bg-navy lg:block">Register now</a>
          <button aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)} className="grid h-11 w-11 place-items-center rounded-full bg-paper text-lg lg:hidden">{menu ? "✕" : "☰"}</button>
        </nav>
        {menu && (
          <div className="pop mx-5 mb-3 flex flex-col gap-1 rounded-3xl bg-paper p-3 lg:hidden" onClick={() => setMenu(false)}>
            {NAV.map(([h, t]) => <a key={h} href={h} className="rounded-2xl px-4 py-3.5 font-medium hover:bg-cream">{t}</a>)}
            <a href="#programmes" className="brand-bg mt-1 rounded-2xl px-4 py-3.5 text-center font-display font-semibold text-white">Register now</a>
          </div>
        )}
      </header>

      {/* Hero: headline + search + sliding cards */}
      <section id="top" className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pb-10 pt-6 lg:grid-cols-[.85fr_1.15fr] lg:pt-12">
        <div className="pointer-events-none absolute -left-20 bottom-0 hidden h-40 w-40 donut float lg:block" aria-hidden="true" />
        <div className="pointer-events-none absolute left-[40%] top-4 hidden h-14 w-14 orb float [animation-delay:1.5s] lg:block" aria-hidden="true" />
        <Reveal className="relative">
          <p className="mb-4 w-fit rounded-full bg-paper px-4 py-1.5 text-sm font-medium">One-on-one skill training</p>
          <h1 className="font-display text-[3rem] font-extrabold leading-[1.02] sm:text-6xl xl:text-7xl">
            <span className="brand-text">Made</span><br /><span className="brand-text">for more.</span>
          </h1>
          <p className="mt-5 max-w-md text-xl text-ink/70">Skill Mountain Academy is changing the face of skill education. You learn one-on-one, with a mentor, for six months.</p>
          <form onSubmit={go} className="mt-7 flex max-w-md overflow-hidden rounded-2xl bg-white shadow-lg shadow-indigo/10">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find your programme" aria-label="Find your programme" list="progs"
              className="min-w-0 flex-1 bg-transparent px-5 py-4 outline-none" />
            <datalist id="progs">{PROGRAMMES.map((p) => <option key={p.id} value={p.name} />)}</datalist>
            <button className="brand-bg px-7 font-display font-semibold text-white transition hover:brightness-110">Go</button>
          </form>
        </Reveal>

        <Reveal delay={150}>
          <div className="flex h-[26rem] gap-3 sm:h-[30rem] lg:h-[33rem]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
            onTouchStart={(e) => { touch.current = e.touches[0].clientX; setPaused(true); }}
            onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 40) slide(dx < 0 ? 1 : -1); setPaused(false); }}>
            {SLIDES.map((s, i) => {
              const on = i === active;
              return (
                <div key={s.id} onClick={() => setActive(i)} onMouseEnter={() => setActive(i)} role="button" tabIndex={0} aria-label={s.name}
                  onKeyDown={(e) => e.key === "Enter" && setActive(i)}
                  className={`relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br ${s.tone} transition-all duration-700 ease-out ${on ? "flex-[6]" : "hidden flex-[1] cursor-pointer md:block"}`}>
                  <Image src={s.photo} alt="" fill sizes="(max-width: 768px) 90vw, 40vw" className="object-cover object-top" />
                  <div className={`absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent transition-opacity duration-500 ${on ? "opacity-100" : "opacity-40"}`} />
                  {on ? (
                    <div className="pop absolute inset-x-0 bottom-0 p-5 text-white sm:p-6">
                      <span className="rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-ink">{s.prog ? (s.prog.live ? "Open for registration" : "Coming soon") : "SMA"}</span>
                      <h2 className="mt-3 font-display text-2xl font-extrabold sm:text-3xl">{s.name}</h2>
                      <p className="text-white/85">{s.note}</p>
                      {s.prog?.live && (
                        <button onClick={(e) => { e.stopPropagation(); setPick(s.prog!); }} className="mt-4 rounded-full bg-white px-6 py-3 font-display font-semibold text-ink transition hover:bg-cream">Register</button>
                      )}
                    </div>
                  ) : (
                    <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-indigo px-2 py-4 font-display text-sm font-semibold text-white [writing-mode:vertical-rl] [rotate:180deg]">{s.name}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-center gap-2 md:hidden" aria-hidden="true">
            {SLIDES.map((s, i) => <span key={s.id} className={`h-2 rounded-full transition-all ${i === active ? "w-6 bg-brand-red" : "w-2 bg-ink/20"}`} />)}
          </div>
        </Reveal>
      </section>

      {/* Tagline + categories + programmes */}
      <section id="programmes" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-14 sm:py-20">
        <Reveal className="text-center">
          <h2 className="font-display text-3xl font-extrabold sm:text-5xl">One mentor. One student<span className="text-brand-orange">.</span></h2>
          <p className="mx-auto mt-3 max-w-xl text-ink/70">Choose a programme and register. More skills are coming.</p>
          <div className="mt-6 flex justify-center gap-2 overflow-x-auto pb-2 no-scrollbar" role="tablist" aria-label="Categories">
            {cats.map((c) => (
              <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)}
                className={`shrink-0 border-b-2 px-4 py-2 font-medium transition ${cat === c ? "border-brand-red text-ink" : "border-transparent text-ink/60 hover:text-ink"}`}>{c}</button>
            ))}
          </div>
        </Reveal>
        {list.length === 0 && <p className="mt-10 text-center text-ink/60">No match yet. That skill may be coming soon.</p>}
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {list.map((p, i) => (
            <Reveal key={p.id} delay={i * 80} className="h-full">
              <article className="flex h-full flex-col rounded-[1.75rem] bg-paper p-3 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo/10">
                <div className={`relative h-48 overflow-hidden rounded-[1.25rem] bg-gradient-to-br ${p.tone} ${p.live ? "" : "opacity-70 saturate-50"}`}>
                  <Image src={PHOTO[p.id]} alt="" fill sizes="(max-width: 640px) 90vw, 25vw" className="object-cover object-top" />
                </div>
                <div className="flex flex-1 flex-col px-2 pb-2 pt-4">
                  <h3 className="font-display text-xl font-bold">{p.name}</h3>
                  <p className="mt-1 text-sm text-ink/60">{p.live ? `${p.months} months · one-on-one` : "Coming soon"}</p>
                  <p className="mt-2 flex-1 text-ink/75">{p.blurb}</p>
                  {p.live ? (
                    <>
                      <details className="group mt-3 rounded-2xl bg-cream px-4 py-3">
                        <summary className="flex cursor-pointer list-none items-center justify-between font-display text-sm font-semibold">What you&apos;ll learn<span className="text-brand-red transition group-open:rotate-45">+</span></summary>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/75">{p.learn.map((l) => <li key={l}>{l}</li>)}</ul>
                      </details>
                      <p className="mt-4 font-display text-2xl font-extrabold">{naira(p.fee!)}</p>
                      <button onClick={() => setPick(p)} className="brand-bg mt-3 rounded-full py-3.5 font-display font-semibold text-white transition hover:brightness-110">Register</button>
                    </>
                  ) : (
                    <p className="mt-4 rounded-full bg-cream py-3.5 text-center font-display font-semibold text-ink/50">Coming soon</p>
                  )}
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Why SMA */}
      <section id="why" className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-10 px-5 pb-16 sm:pb-24 lg:grid-cols-2">
        <Reveal>
          <h2 className="font-display text-3xl font-extrabold sm:text-5xl"><span className="brand-text">Get the skills you need to climb higher.</span></h2>
          <p className="mt-4 max-w-md text-ink/70">Skill Mountain Academy is for people who are made for more. One-on-one training means your mentor&apos;s full attention is on you.</p>
          <ul className="mt-8 space-y-6">
            {[["One mentor, just for you", "Ask anything and get direct answers from the person teaching you."],
              ["Your pace", "Lessons move as fast as you do, so nothing is skipped and nothing drags."],
              ["Learn by doing", "You practise on real projects, not only slides and videos."]].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="brand-bg grid h-10 w-10 shrink-0 place-items-center rounded-full font-display font-bold text-white">{i + 1}</span>
                <div><p className="font-display font-bold">{t}</p><p className="text-ink/70">{d}</p></div>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={150} className="relative">
          <div className="overflow-hidden rounded-[2rem] shadow-2xl shadow-indigo/20">
            <Image src={banner} alt="Students outside the Skill Mountain Academy sign" className="h-auto w-full" />
          </div>
          <div className="float absolute -bottom-5 -left-2 rounded-2xl bg-indigo px-5 py-3 text-white shadow-xl sm:-left-6">
            <p className="text-sm text-white/70">Duration</p><p className="font-display font-bold">6 months, 1-on-1</p>
          </div>
        </Reveal>
      </section>

      {/* Who it's for: carousel */}
      <section id="who" className="scroll-mt-20 pb-16 sm:pb-24">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal className="flex items-end justify-between gap-4">
            <h2 className="font-display text-3xl font-extrabold sm:text-5xl">Who it&apos;s for<span className="text-brand-orange">.</span></h2>
            <div className="flex gap-2">
              {[-1, 1].map((d) => (
                <button key={d} aria-label={d < 0 ? "Previous" : "Next"} onClick={() => rail.current?.scrollBy({ left: d * 320, behavior: "smooth" })}
                  className="grid h-11 w-11 place-items-center rounded-full bg-paper transition hover:bg-white">{d < 0 ? "←" : "→"}</button>
              ))}
            </div>
          </Reveal>
        </div>
        <div ref={rail} className="no-scrollbar mx-auto mt-8 flex max-w-6xl snap-x gap-4 overflow-x-auto px-5">
          {AUDIENCE.map(([t, d], i) => (
            <div key={t} className={`min-w-[17rem] snap-start rounded-[1.75rem] p-6 transition hover:-translate-y-1 ${["bg-paper", "bg-brand-orange/25", "bg-indigo text-white", "bg-paper", "bg-brand-red/15"][i]}`}>
              <span className="brand-text font-display text-4xl font-extrabold">0{i + 1}</span>
              <h3 className="mt-6 font-display text-xl font-bold">{t}</h3>
              <p className={`mt-2 ${i === 2 ? "text-white/75" : "text-ink/70"}`}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="relative scroll-mt-20 overflow-hidden bg-indigo py-16 text-white sm:py-20">
        <Chevrons className="pointer-events-none absolute -right-16 top-0 h-80 w-[28rem] text-white/10" />
        <div className="relative mx-auto max-w-6xl px-5">
          <Reveal><h2 className="font-display text-3xl font-extrabold sm:text-5xl">How it works</h2></Reveal>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {["Pick a programme", "Fill in the registration form", "Pay with Paystack by card or transfer", "Get your learning resources by email"].map((t, i) => (
              <Reveal key={t} delay={i * 90}>
                <li className="h-full rounded-[1.75rem] bg-white/10 p-6 backdrop-blur">
                  <span className="brand-bg grid h-10 w-10 place-items-center rounded-full font-display font-bold">{i + 1}</span>
                  <p className="mt-4 text-lg font-medium">{t}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-5 py-16 sm:py-20">
        <Reveal><h2 className="font-display text-3xl font-extrabold sm:text-5xl"><span className="brand-text">Questions</span></h2></Reveal>
        <div className="mt-8 space-y-3">
          {[["How do I pay?", "After you register, Paystack opens. You can pay by card or bank transfer."],
            ["What happens after I pay?", "Once Paystack confirms your payment, your learning resources are emailed to the address you registered with."],
            ["Can I register for the other skills?", "Not yet. They show Coming soon and will open for registration when they are ready."],
            ["I did not get my email. What now?", "Check your spam folder first. If it is not there, contact us with your payment reference."]].map(([qq, a]) => (
            <details key={qq} className="group rounded-2xl bg-paper px-5 py-4 open:shadow-md">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display font-semibold">{qq}<span className="text-brand-red transition group-open:rotate-45">+</span></summary>
              <p className="mt-3 text-ink/70">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Community + footer */}
      <footer id="contact" className="bg-indigo text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-5 pt-14 md:grid-cols-2">
          <div className="pb-4 md:pb-14">
            <h2 className="font-display text-3xl font-extrabold sm:text-4xl">Join our community</h2>
            <p className="mt-2 text-white/70">Get news on new programmes and when the other skills open.</p>
            {joined ? <p className="mt-5 font-display font-semibold text-brand-orange">Thank you. You&apos;re on the list.</p> : (
              <form onSubmit={join} className="mt-5 flex max-w-md overflow-hidden rounded-2xl bg-white text-ink">
                <input name="email" type="email" required placeholder="Enter your email" aria-label="Email" className="min-w-0 flex-1 bg-transparent px-5 py-4 outline-none" />
                <button className="brand-bg px-7 font-display font-semibold text-white">Go</button>
              </form>
            )}
          </div>
          <div className="relative mx-auto hidden h-72 w-72 md:block">
            <div className="absolute inset-x-4 bottom-0 top-10 rounded-t-[10rem] bg-gradient-to-b from-brand-orange to-brand-red" />
            <Image src={pMega} alt="" fill sizes="288px" className="object-contain object-bottom" />
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
            <Image src={logoWhite} alt="Skill Mountain Academy" unoptimized className="-my-12 h-auto w-52" />
            <div className="text-white/75">
              <a href={`https://wa.me/${CFG.whatsapp}`} className="font-display font-semibold text-brand-orange hover:underline">WhatsApp / call: {CFG.phone}</a>
              <p className="text-sm">© {new Date().getFullYear()} Skill Mountain Academy. Abuja, Nigeria.</p>
            </div>
          </div>
        </div>
      </footer>

      <a href={`https://wa.me/${CFG.whatsapp}`} aria-label="Chat with us on WhatsApp"
        className="fixed bottom-4 right-4 z-30 rounded-full bg-[#25d366] px-4 py-2.5 font-display text-sm font-semibold text-ink shadow-xl transition hover:scale-105">Chat</a>

      {pick && <Register p={pick} onClose={closeReg} />}
    </main>
  );
}
