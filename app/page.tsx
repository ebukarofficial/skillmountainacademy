"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import logo from "@/assets/sma-logo.png";
import logoWhite from "@/assets/sma-logo-white.png";
import banner from "@/assets/photos/banner-students.webp";
import { AUDIENCE, BUSINESS, CFG, FAQ, GOALS, IMAGE_CREDIT, PROGRAMMES, REVIEW_SHOTS, SOCIAL, STEPS, type Programme } from "@/lib/config";
import { CalendlyEmbed, Chevrons, CurriculumModal, FOCUS, Intro, PHOTO, SMA_PHOTO, Price, Reveal, SocialIcon, naira, postSheet, useRate, usd } from "./components";

const NAV = [["#programmes", "Programmes"], ["#why", "Our approach"], ["#who", "Who it's for"], ["#how", "Your path"], ["#reviews", "Reviews"], ["#faq", "FAQ"]].filter(([h]) => h !== "#reviews" || REVIEW_SHOTS.length > 0);

type Slide = { id: string; name: string; tone: string; photo: StaticImageData; note: string; prog?: Programme };
const SLIDES: Slide[] = [
  ...PROGRAMMES.filter((p) => p.live).map((p) => ({
    id: p.id, name: p.name, tone: p.tone, photo: PHOTO[p.id], prog: p,
    note: `${naira(p.fee!)}${p.was ? ` · was ${naira(p.was)}` : ""}${p.months ? ` · ${p.months} months` : ""}`,
  })),
];


const USPS = [
  ["1-on-1 Personalized Training & Mentorship", "Individual attention tailored to each learner's goals, pace and learning style."],
  ["Flexible Scheduling", "Choose training times that fit around your school, work or personal commitments."],
  ["Beginner to Advanced Training", "Structured learning paths for complete beginners right through to advanced learners."],
  ["Inclusive & Specialized Learning", "Customized curricula for children, including learners who need additional support, and for adults with little or no prior IT experience."],
  ["Practical, Career-Focused Learning", "Learn by doing with hands-on projects, real-world scenarios, industry tools, portfolio development and career guidance, so you build skills you can actually use."],
];

function UspIcon({ i }: { i: number }) {
  const c = { width: 26, height: 26, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
  if (i === 0) return <svg {...c}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-4 3-6 7-6s7 2 7 6" /></svg>;
  if (i === 1) return <svg {...c}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  if (i === 2) return <svg {...c}><path d="M3 20h5v-5h5v-5h5V5h3" /></svg>;
  if (i === 3) return <svg {...c}><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 19c0-3.5 2.7-5 6-5s6 1.5 6 5M15 14c3 0 6 1 6 4.5" /></svg>;
  return <svg {...c}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" /></svg>;
}

const regHref = (p: Programme) => `/checkout/?p=${p.id}`;

export default function Home() {
  const [menu, setMenu] = useState(false);
  const [view, setView] = useState<Programme | null>(null);
  const closeView = useCallback(() => setView(null), []);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [goal, setGoal] = useState(0);
  const [step, setStep] = useState(0);
  const [shot, setShot] = useState<number | null>(null);
  const [subbed, setSubbed] = useState(false);
  const touch = useRef(0);
  const rail = useRef<HTMLDivElement>(null);
  const rate = useRate();

  const cats = ["All", ...Array.from(new Set(PROGRAMMES.map((p) => p.tag)))];
  const term = q.trim().toLowerCase();
  const list = PROGRAMMES.filter((p) => (cat === "All" || p.tag === cat) && (!term || `${p.name} ${p.tag} ${p.blurb}`.toLowerCase().includes(term)));
  const rec = PROGRAMMES.find((p) => p.id === GOALS[goal].id)!;
  const s = STEPS[step];

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setActive((a) => (a + 1) % SLIDES.length), 5500);
    return () => clearInterval(t);
  }, [paused]);

  useEffect(() => {
    const on = () => { const h = document.documentElement; setProgress(h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)); };
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => {
    if (shot === null) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setShot(null);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [shot]);

  const go = (e: FormEvent) => { e.preventDefault(); document.getElementById("programmes")?.scrollIntoView({ behavior: "smooth" }); };
  const slide = useCallback((d: number) => setActive((a) => (a + d + SLIDES.length) % SLIDES.length), []);
  const subscribe = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await postSheet({ action: "subscribe", email: String(new FormData(e.currentTarget).get("email")).trim() });
    setSubbed(true);
  };
  const partnerHref = `https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent("Hello, I would like to partner with Skill Mountain Academy.")}`;

  return (
    <main id="main" className="overflow-x-clip">
      <Intro />
      <div className="fixed left-0 top-0 z-50 h-1 brand-bg" style={{ width: `${progress * 100}%` }} aria-hidden="true" />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-cream/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3" aria-label="Main">
          <a href="#top" aria-label="Skill Mountain Academy home"><Image src={logo} alt="Skill Mountain Academy" priority unoptimized className="h-10 w-auto sm:h-12" /></a>
          <div className="hidden items-center gap-6 font-medium xl:flex">{NAV.map(([h, t]) => <a key={h} href={h} className="transition hover:text-brand-red">{t}</a>)}</div>
          <a href="#programmes" className="hidden rounded-full bg-indigo px-6 py-2.5 font-display text-sm font-semibold text-cream transition hover:bg-navy xl:block">Register now</a>
          <button aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)} className="grid h-11 w-11 place-items-center rounded-full bg-paper text-lg xl:hidden">{menu ? "✕" : "☰"}</button>
        </nav>
        {menu && (
          <div className="pop mx-5 mb-3 flex flex-col gap-1 rounded-3xl bg-paper p-3 xl:hidden" onClick={() => setMenu(false)}>
            {NAV.map(([h, t]) => <a key={h} href={h} className="rounded-2xl px-4 py-3.5 font-medium hover:bg-cream">{t}</a>)}
            <a href="#programmes" className="brand-bg mt-1 rounded-2xl px-4 py-3.5 text-center font-display font-semibold text-white">Register now</a>
          </div>
        )}
      </header>

      {/* Hero */}
      <section id="top" className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pb-10 pt-6 lg:grid-cols-[.9fr_1.1fr] lg:pt-12">
        <div className="pointer-events-none absolute -bottom-10 -left-32 -z-10 hidden h-40 w-40 donut float lg:block" aria-hidden="true" />
        <Reveal className="relative">
          <p className="mb-4 w-fit rounded-full bg-paper px-4 py-1.5 text-sm font-medium">One-on-One Skill Academy</p>
          <h1 className="font-display text-[2.6rem] font-extrabold leading-[1.04] sm:text-6xl xl:text-7xl"><span className="brand-text">For those made for more.</span></h1>
          <p className="mt-5 max-w-md text-xl text-ink/70">Learn in-demand skills with structure, depth, and guidance, at your time, space, and pace.</p>
          <p className="mt-3 max-w-md text-ink/70">You are welcome here. Learn the way a homeschool teaches: one teacher, one student, at your pace.</p>
          <form onSubmit={go} className="mt-7 flex max-w-md overflow-hidden rounded-2xl bg-white shadow-lg shadow-indigo/10">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find your programme" aria-label="Find your programme" list="progs" className="min-w-0 flex-1 bg-transparent px-5 py-4 outline-none" />
            <datalist id="progs">{PROGRAMMES.map((p) => <option key={p.id} value={p.name} />)}</datalist>
            <button aria-label="Search programmes" className="brand-bg px-7 font-display font-semibold text-white transition hover:brightness-110">Search</button>
          </form>
        </Reveal>

        <Reveal delay={150}>
          <div className="flex h-[26rem] gap-3 sm:h-[30rem] lg:h-[33rem]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
            onTouchStart={(e) => { touch.current = e.touches[0].clientX; setPaused(true); }}
            onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 40) slide(dx < 0 ? 1 : -1); setPaused(false); }}>
            {SLIDES.map((sl, i) => {
              const on = i === active;
              return (
                <div key={sl.id} onClick={() => setActive(i)} onMouseEnter={() => setActive(i)} role="button" tabIndex={0} aria-label={sl.name} onKeyDown={(e) => e.key === "Enter" && setActive(i)}
                  className={`relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br ${sl.tone} transition-all duration-700 ease-out ${on ? "flex-[6]" : "hidden flex-[1] cursor-pointer md:block"}`}>
                  <Image src={sl.photo} alt="" fill sizes="(max-width: 768px) 90vw, 40vw" className="object-cover" style={{ objectPosition: FOCUS[sl.id] }} />
                  <div className={`absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent transition-opacity duration-500 ${on ? "opacity-100" : "opacity-40"}`} />
                  {on ? (
                    <div className="pop absolute inset-x-0 bottom-0 p-5 text-white sm:p-6">
                      <span className="rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-ink">{sl.prog ? "Open for registration" : "SMA"}</span>
                      <h2 className="mt-3 font-display text-2xl font-extrabold sm:text-3xl">{sl.name}</h2>
                      <p className="text-white/85">{sl.note}</p>
                      {sl.prog && <p className="text-sm text-white/70">≈ {usd(sl.prog.fee!, rate)}</p>}
                      {sl.prog && <Link href={regHref(sl.prog)} onClick={(e) => e.stopPropagation()} className="mt-3 inline-block rounded-full bg-white px-6 py-3 font-display font-semibold text-ink transition hover:bg-cream">Register</Link>}
                    </div>
                  ) : (
                    <span className="absolute inset-x-2.5 bottom-4 flex justify-center rounded-full bg-indigo py-4 text-white">
                      <span className="whitespace-nowrap font-display text-[13px] font-semibold leading-none [writing-mode:vertical-rl] [rotate:180deg]">{sl.name}</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-center gap-2 md:hidden" aria-hidden="true">
            {SLIDES.map((sl, i) => <span key={sl.id} className={`h-2 rounded-full transition-all ${i === active ? "w-6 bg-brand-red" : "w-2 bg-ink/20"}`} />)}
          </div>
        </Reveal>
      </section>

      {/* Our approach */}
      <section id="why" className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-10 px-5 py-14 sm:py-20 lg:grid-cols-2">
        <Reveal>
          <h2 className="font-display text-3xl font-extrabold sm:text-5xl"><span className="brand-text">Learn without the crowd.</span></h2>
          <p className="mt-4 max-w-lg text-lg text-ink/75">Some people learn best when they are not surrounded by everyone. Skill Mountain Academy is designed for learners who find it hard to learn in the middle of a crowd.</p>
          <p className="mt-3 max-w-lg text-lg text-ink/75">It works like a homeschool: one teacher, one student. Your mentor&apos;s full attention, your pace, your goals. Better learning, and a better future.</p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {["One teacher. One student.", "Your pace, your schedule", "Real skills for real careers"].map((t) => <li key={t} className="rounded-full bg-paper px-4 py-2 font-medium">{t}</li>)}
          </ul>
        </Reveal>
        <Reveal delay={150} className="relative">
          <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-indigo via-plum to-brand-red pt-10 shadow-2xl shadow-indigo/20">
            <Chevrons className="pointer-events-none absolute -right-8 top-2 h-48 w-64 text-white/15" />
            <Image src={banner} alt="Five smiling students sitting together with their hands raised" className="relative mx-auto h-auto w-full max-w-[34rem] px-4" />
          </div>
          <div className="float absolute -bottom-5 -left-2 rounded-2xl bg-indigo px-5 py-3 text-white shadow-xl sm:-left-6">
            <p className="text-sm text-white/70">Learning format</p><p className="font-display font-bold">One teacher, one student</p>
          </div>
        </Reveal>
      </section>

      {/* Programmes */}
      <section id="programmes" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-14 sm:pb-20">
        <Reveal className="text-center">
          <h2 className="font-display text-3xl font-extrabold sm:text-5xl">One mentor. One student<span className="text-brand-orange">.</span></h2>
          <p className="mx-auto mt-3 max-w-xl text-ink/70">Choose a programme and register. More skills are coming.</p>
          <div className="mt-6 flex justify-start gap-2 overflow-x-auto pb-2 no-scrollbar sm:justify-center" role="tablist" aria-label="Categories">
            {cats.map((c) => (
              <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)} className={`shrink-0 border-b-2 px-4 py-2 font-medium transition ${cat === c ? "border-brand-red text-ink" : "border-transparent text-ink/70 hover:text-ink"}`}>{c}</button>
            ))}
          </div>
        </Reveal>
        {list.length === 0 && <p className="mt-10 text-center text-ink/70">No match yet. That skill may be coming soon.</p>}
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {list.map((p, i) => (
            <Reveal key={p.id} delay={(i % 4) * 80} className="h-full">
              <article className="flex h-full flex-col rounded-[1.75rem] bg-paper p-3 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo/10">
                <div className={`relative h-48 overflow-hidden rounded-[1.25rem] bg-gradient-to-br ${p.tone} ${p.live ? "" : "opacity-70 saturate-50"}`}>
                  <Image src={PHOTO[p.id]} alt="" fill sizes="(max-width: 640px) 90vw, 25vw" className="object-cover" style={{ objectPosition: FOCUS[p.id] }} />
                  {p.live && p.was && <span className="absolute left-3 top-3 rounded-full bg-brand-red px-3 py-1 text-xs font-bold text-white">{`${Math.round((1 - p.fee! / p.was) * 100)}% OFF`}</span>}
                </div>
                <div className="flex flex-1 flex-col px-2 pb-2 pt-4">
                  <h3 className="font-display text-xl font-bold">{p.name}</h3>
                  <p className="mt-1 text-sm text-ink/70">{p.live ? `${p.months ? `${p.months} months · ` : ""}one-on-one` : "Coming soon"}</p>
                  <p className="mt-2 flex-1 text-ink/75">{p.blurb}</p>
                  {p.live ? (
                    <>
                      <details className="group mt-3 rounded-2xl bg-cream px-4 py-3">
                        <summary className="flex cursor-pointer list-none items-center justify-between font-display text-sm font-semibold">What you&apos;ll learn<span className="text-brand-red transition group-open:rotate-45">+</span></summary>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/75">{p.learn.map((l) => <li key={l}>{l}</li>)}</ul>
                      </details>
                      <button onClick={() => setView(p)} className="mt-3 w-full rounded-full border-2 border-indigo/25 py-2.5 font-display text-sm font-semibold text-indigo transition hover:bg-indigo hover:text-white">View curriculum</button>
                      <div className="mt-4"><Price p={p} /></div>
                      <Link href={regHref(p)} className="brand-bg mt-3 rounded-full py-3.5 text-center font-display font-semibold text-white transition hover:brightness-110">Register</Link>
                    </>
                  ) : (
                    <p className="mt-4 rounded-full bg-cream py-3.5 text-center font-display font-semibold text-ink/70">Coming soon</p>
                  )}
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-20 text-center">
          <h3 className="font-display text-3xl font-extrabold sm:text-4xl"><span className="brand-text">The right place. The right way.</span></h3>
          <p className="mx-auto mt-3 max-w-xl text-ink/70">Every SMA programme comes with:</p>
        </Reveal>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-6">
          {USPS.map(([t, d], i) => (
            <Reveal key={t} delay={(i % 3) * 90} className={`h-full ${i < 3 ? "lg:col-span-2" : "lg:col-span-3"} ${i === 4 ? "sm:col-span-2" : ""}`}>
              <div className={`h-full rounded-[1.75rem] p-6 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo/10 ${["bg-paper", "bg-brand-orange/25", "bg-indigo text-white", "bg-brand-red/15", "bg-paper"][i]}`}>
                <span className={`grid h-12 w-12 place-items-center rounded-full ${i === 2 ? "bg-white/15 text-white" : "brand-bg text-white"}`}><UspIcon i={i} /></span>
                <h4 className="mt-5 font-display text-xl font-bold">{t}</h4>
                <p className={`mt-2 ${i === 2 ? "text-white/75" : "text-ink/75"}`}>{d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Who it's for */}
      <section id="who" className="scroll-mt-20 pb-16 sm:pb-24">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal className="flex items-end justify-between gap-4">
            <h2 className="font-display text-3xl font-extrabold sm:text-5xl">Who it&apos;s for<span className="text-brand-orange">.</span></h2>
            <div className="flex gap-2">
              {[-1, 1].map((d) => <button key={d} aria-label={d < 0 ? "Previous" : "Next"} onClick={() => rail.current?.scrollBy({ left: d * 320, behavior: "smooth" })} className="grid h-11 w-11 place-items-center rounded-full bg-paper transition hover:bg-white">{d < 0 ? "←" : "→"}</button>)}
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

      {/* Your path */}
      <section id="how" className="relative scroll-mt-20 overflow-hidden bg-indigo py-16 text-white sm:py-24">
        <Chevrons className="pointer-events-none absolute -right-16 top-0 h-80 w-[28rem] text-white/10" />
        <div className="relative mx-auto max-w-6xl px-5">
          <Reveal>
            <h2 className="font-display text-3xl font-extrabold sm:text-5xl">Your path to getting started</h2>
            <p className="mt-3 max-w-2xl text-white/75">Follow these steps, or tell us your goal and we will point you to the right programme.</p>
          </Reveal>

          <Reveal delay={80}>
            <div id="goal" className="mt-8 scroll-mt-24 rounded-[1.75rem] bg-white/10 p-5 backdrop-blur sm:p-7">
              <p className="font-display font-bold">What do you want to achieve?</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {GOALS.map((g, i) => (
                  <button key={g.goal} onClick={() => setGoal(i)} aria-pressed={goal === i} className={`rounded-full px-4 py-2 font-medium transition ${goal === i ? "bg-white text-ink" : "bg-white/10 hover:bg-white/20"}`}>{g.goal}</button>
                ))}
              </div>
              <div className="mt-5 grid items-center gap-4 rounded-2xl bg-white p-5 text-ink sm:grid-cols-[1fr_auto]">
                <div>
                  <p className="text-sm font-medium text-brand-red">We suggest</p>
                  <p className="font-display text-2xl font-extrabold">{rec.name}</p>
                  <p className="mt-1 text-ink/70">{GOALS[goal].why}</p>
                  <p className="mt-2 font-display font-bold">{naira(rec.fee!)} <span className="text-sm font-normal text-ink/70">≈ {usd(rec.fee!, rate)}{rec.was ? ` · usual price ${naira(rec.was)}` : ""}</span></p>
                </div>
                <Link href={regHref(rec)} className="brand-bg rounded-full px-7 py-3.5 text-center font-display font-semibold text-white transition hover:brightness-110">Register for {rec.name}</Link>
              </div>
            </div>
          </Reveal>

          <div className="mt-8 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
            <ol className="space-y-2">
              {STEPS.map((st, i) => (
                <li key={st.title}>
                  <button onClick={() => setStep(i)} aria-current={step === i} className={`flex w-full items-center gap-4 rounded-2xl px-4 py-3 text-left transition ${step === i ? "bg-white text-ink" : "bg-white/10 hover:bg-white/20"}`}>
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-display font-bold ${step === i ? "brand-bg text-white" : "bg-white/15"}`}>{i + 1}</span>
                    <span className="font-medium">{st.title}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="flex flex-col justify-between rounded-[1.75rem] bg-white p-6 text-ink sm:p-8">
              <div>
                <p className="text-sm font-medium text-brand-red">Step {step + 1} of {STEPS.length}</p>
                <h3 className="mt-1 font-display text-2xl font-extrabold">{s.title}</h3>
                <p className="mt-3 text-lg text-ink/75">{s.text}</p>
                {s.cta && <a href={s.cta[1]} className="brand-bg mt-5 inline-block rounded-full px-6 py-3 font-display font-semibold text-white">{s.cta[0]}</a>}
              </div>
              <div className="mt-8 flex justify-between">
                <button onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0} className="rounded-full bg-cream px-5 py-2.5 font-medium disabled:opacity-40">← Back</button>
                <button onClick={() => setStep((x) => Math.min(STEPS.length - 1, x + 1))} disabled={step === STEPS.length - 1} className="rounded-full bg-indigo px-5 py-2.5 font-medium text-white disabled:opacity-40">Next →</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Reviews */}
      {/* Free consultation */}
      <section id="book" className="mx-auto max-w-4xl scroll-mt-20 px-5 pb-16 pt-20 text-center sm:pb-24 sm:pt-32">
        <Reveal>
          <h2 className="font-display text-3xl font-extrabold sm:text-5xl"><span className="brand-text">Not sure yet? Talk to us first.</span></h2>
          <p className="mx-auto mt-3 max-w-xl text-ink/70">Book a free call. We will listen to your goals and help you choose the right programme before you pay anything.</p>
          <div className="mt-8"><CalendlyEmbed url={CFG.calendlyConsult} /></div>
        </Reveal>
      </section>

      {REVIEW_SHOTS.length > 0 && (
      <section id="reviews" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:py-24">
        <Reveal className="text-center">
          <h2 className="font-display text-3xl font-extrabold sm:text-5xl">Real Learners. Real Transformation<span className="text-brand-orange">.</span></h2>
          <p className="mx-auto mt-3 max-w-xl text-ink/70">What learners say about us on social media.</p>
        </Reveal>
        {REVIEW_SHOTS.length ? (
          <div className="mt-10 columns-1 gap-4 sm:columns-2 lg:columns-3">
            {REVIEW_SHOTS.map((r, i) => (
              <button key={r.file} onClick={() => setShot(i)} className="mb-4 block w-full break-inside-avoid overflow-hidden rounded-2xl bg-white text-left shadow-md transition hover:-translate-y-1 hover:shadow-xl" aria-label={`Open ${r.alt}`}>
                <img src={`${CFG.base}/reviews/${r.file}`} alt={r.alt} loading="lazy" className="h-auto w-full" />
                <span className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-ink/70"><SocialIcon name={r.platform} />{r.platform}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>
      )}
      {shot !== null && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/80 p-4" onClick={() => setShot(null)} role="dialog" aria-modal="true" aria-label="Learner post">
          <img src={`${CFG.base}/reviews/${REVIEW_SHOTS[shot].file}`} alt={REVIEW_SHOTS[shot].alt} className="max-h-[90dvh] max-w-full rounded-2xl bg-white object-contain" />
          <button aria-label="Close" className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white text-lg">✕</button>
        </div>
      )}

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-5 pb-16 sm:pb-24">
        <Reveal><h2 className="font-display text-3xl font-extrabold sm:text-5xl"><span className="brand-text">Questions, answered</span></h2></Reveal>
        <div className="mt-8 space-y-3">
          {FAQ.map(([qq, a]) => (
            <details key={qq} className="group rounded-2xl bg-paper px-5 py-4 open:shadow-md">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display font-semibold">{qq}<span className="text-brand-red transition group-open:rotate-45">+</span></summary>
              <p className="mt-3 text-ink/75">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Vision / partners */}
      <section className="relative overflow-hidden bg-gradient-to-br from-indigo via-navy to-plum pb-16 pt-16 text-white sm:pb-20 sm:pt-20 lg:pb-0">
        <Chevrons className="pointer-events-none absolute -left-20 bottom-0 h-72 w-96 text-white/10" />
        <div className="relative mx-auto grid max-w-5xl items-end gap-8 px-5 lg:grid-cols-[1.15fr_.85fr]">
          <Reveal className="text-center lg:pb-20 lg:text-left">
          <p className="text-sm font-medium uppercase tracking-widest text-brand-orange">Our vision</p>
          <h2 className="mt-3 font-display text-3xl font-extrabold sm:text-5xl">A mentor beside every learner.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80 lg:mx-0">We believe the best education is personal. Our mission is to give every learner a teacher of their own and to open doors to careers and opportunities wherever they are. If you share this vision and would like to help us grow it, we would love to hear from you.</p>
          <a href={partnerHref} target="_blank" rel="noopener noreferrer" className="brand-bg mt-8 inline-block rounded-full px-8 py-4 font-display font-semibold text-white transition hover:brightness-110">Partner with us</a>
        </Reveal>
          <div className="hidden justify-center lg:flex">
            <Image src={SMA_PHOTO} alt="A smiling learner wearing a Skill Mountain Academy t-shirt" className="h-auto max-h-[27rem] w-auto" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer id="contact" className="bg-black text-white/75">
        <div className="mx-auto max-w-6xl px-5">
          <div className="grid gap-10 border-t border-white/10 py-12 md:grid-cols-2">
            <div>
              <Image src={logoWhite} alt="Skill Mountain Academy" unoptimized className="h-14 w-auto" />
              <p className="mt-6 max-w-md text-lg">Skill Mountain Academy is a one-on-one skill academy where one teacher teaches one student.</p>
              <div className="mt-6 flex items-center gap-5">
                {SOCIAL.map((so) => <a key={so.name} href={so.url} target="_blank" rel="noopener noreferrer" aria-label={`Skill Mountain Academy on ${so.name}`} className="text-white/70 transition hover:text-brand-orange"><SocialIcon name={so.name} /></a>)}
              </div>
            </div>
            <div className="flex flex-col gap-6 md:items-end md:text-right">
              <p className="italic text-white/60">Learn deeply. Grow confidently. Graduate prepared.</p>
              <div className="w-full max-w-sm">
                <p className="font-display font-semibold text-white">Subscribe to our mailing list</p>
                <p className="text-sm text-white/60">News, new programmes and offers.</p>
                {subbed ? <p className="mt-3 font-semibold text-brand-orange">Thank you. You&apos;re subscribed.</p> : (
                  <form onSubmit={subscribe} className="mt-3">
                    <div className="flex overflow-hidden rounded-2xl bg-white text-ink">
                      <input name="email" type="email" required maxLength={120} placeholder="Enter your email" aria-label="Email address" className="min-w-0 flex-1 bg-transparent px-4 py-3.5 text-left outline-none" />
                      <button className="brand-bg px-6 font-display font-semibold text-white">Subscribe</button>
                    </div>
                    <label className="mt-3 flex items-start gap-2 text-left text-xs text-white/70">
                      <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 shrink-0 accent-[#f7892b]" />
                      <span>I agree to receive emails from Skill Mountain Academy and can unsubscribe at any time. See our <Link href="/privacy/" className="underline hover:text-white">Privacy Policy</Link>.</span>
                    </label>
                  </form>
                )}
              </div>
              <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/70 md:justify-end">
                <Link href="/terms/" className="underline hover:text-white">Terms</Link>
                <Link href="/privacy/" className="underline hover:text-white">Privacy</Link>
                <Link href="/cookies/" className="underline hover:text-white">Cookies</Link>
                <Link href="/refunds/" className="underline hover:text-white">Refunds</Link>
              </nav>
              <p className="text-sm text-white/60">{BUSINESS.name}{BUSINESS.rc ? ` (RC ${BUSINESS.rc})` : ""}<br />{BUSINESS.address}</p>
              <p className="text-sm text-white/60">© Skill Mountain Academy 2021–{new Date().getFullYear()}{IMAGE_CREDIT ? ` · ${IMAGE_CREDIT}` : ""}</p>
            </div>
          </div>
        </div>
      </footer>

      <a href={`https://wa.me/${CFG.whatsapp}`} aria-label="Chat with us on WhatsApp" className="fixed bottom-4 right-4 z-30 rounded-full bg-[#25d366] px-4 py-2.5 font-display text-sm font-semibold text-ink shadow-xl transition hover:scale-105">Chat</a>
      {view && <CurriculumModal p={view} onClose={closeView} action={<Link href={regHref(view)} className="brand-bg block rounded-full py-3.5 text-center font-display font-semibold text-white">Register for {view.name}</Link>} />}
    </main>
  );
}
