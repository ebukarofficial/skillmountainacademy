"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import banner from "@/assets/photos/banner-students.webp";
import { AUDIENCE, BUSINESS, CFG, faqList, GOALS, PROGRAMMES, REVIEW_SHOTS, duration, findProgramme, type Programme } from "@/lib/config";
import { MENTORS, REVIEWS, SHOW_MENTORS, SHOW_REVIEWS } from "@/lib/content";
import { BRAND, JOURNEY, MODEL, STANDARDS } from "@/lib/institution";
import { CalendlyEmbed, CloudBadges, FOCUS, Intro, PHOTO, Reveal, SMA_PHOTO, SocialIcon, postSheet } from "./components";
import { Arrow, Eyebrow, NumberedList, ProgrammeGrid, Rule, SERIF, SectionHead, btnLight, btnOutline, btnOutlineLight, btnPrimary } from "./brand";
import { useAdmission } from "./admissions-status";
import { SiteHeader } from "./header";
import { SiteFooter } from "./site-parts";

const FAQS = faqList();
// FAQ structured data (https://schema.org/FAQPage), from the same list the page shows.
const FAQ_LD = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQS.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
const progName = (slug: string) => PROGRAMMES.find((p) => p.slug === slug)?.name ?? slug;

type Slide = { id: string; name: string; tone: string; photo: StaticImageData; prog: Programme };
const SLIDES: Slide[] = [
  ...PROGRAMMES.map((p) => ({
    id: p.slug, name: p.name, tone: p.tone, photo: PHOTO[p.slug], prog: p,
  })),
];

const CLOUD_TRACK = PROGRAMMES.filter((p) => p.track === "cloud");
const progHref = (p: Programme) => `/programmes/${p.slug}/`;

// The status line on the active slide (in place of the old price line).
function SlideStatus({ slug }: { slug: string }) {
  const a = useAdmission(slug);
  return <span className="rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-ink">{a.ready ? a.title : "Skill Mountain Academy"}</span>;
}

export default function Home() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cat, setCat] = useState("All");
  const [goal, setGoal] = useState(0);
  const [shot, setShot] = useState<number | null>(null);
  const [subbed, setSubbed] = useState(false);
  const [notice, setNotice] = useState<"" | "removed" | "pay-unavailable">("");
  const touch = useRef(0);

  const cats = ["All", ...Array.from(new Set(PROGRAMMES.map((p) => p.tag)))];
  const list = PROGRAMMES.filter((p) => cat === "All" || p.tag === cat);
  const rec = findProgramme(GOALS[goal].slug)!;

  // Links to programmes that are no longer offered arrive here as /?notice=removed (see public/_redirects and the checkout page).
  useEffect(() => {
    const u = new URL(window.location.href);
    const n = u.searchParams.get("notice");
    if (n !== "removed" && n !== "pay-unavailable") return;
    u.searchParams.delete("notice");
    window.history.replaceState(null, "", u.pathname + u.search + u.hash);
    // Shown on the next tick: the URL is the external system here, and React state follows it.
    const t = setTimeout(() => setNotice(n), 0);
    return () => clearTimeout(t);
  }, []);

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

  const slide = useCallback((d: number) => setActive((a) => (a + d + SLIDES.length) % SLIDES.length), []);
  const subscribe = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await postSheet({ action: "subscribe", email: String(new FormData(e.currentTarget).get("email")).trim() });
    setSubbed(true);
  };
  const partnerHref = `https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent("Hello, I would like to discuss an institutional partnership with Skill Mountain Academy.")}`;

  return (
    <>
      <Intro />
      <div className="fixed left-0 top-0 z-50 h-0.5 bg-brand-red" style={{ width: `${progress * 100}%` }} aria-hidden="true" />
      <SiteHeader />
      <main id="main" className="overflow-x-clip">

      {notice && (
        <div className="mx-auto mt-3 max-w-6xl px-5">
          <div role="status" className="flex items-center justify-between gap-4 rounded-lg bg-indigo px-5 py-3 text-white">
            {notice === "removed"
              ? <p>IELTS Training and Data Analytics are no longer offered. <a href="#programmes" className="font-semibold underline">See our current programmes</a>.</p>
              : <p>Online payment links are not available right now. Please <a href={`https://wa.me/${CFG.whatsapp}`} className="font-semibold underline">message us on WhatsApp</a> or email {BUSINESS.email} and we will help you pay.</p>}
            <button type="button" aria-label="Dismiss notice" onClick={() => setNotice("")} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15">✕</button>
          </div>
        </div>
      )}

      {/* Hero: the approved slider stays as it is; the message beside it carries the institution's identity. */}
      <section id="top" className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-10 lg:grid-cols-[.95fr_1.05fr] lg:pb-24 lg:pt-16">
        {/* The hero fades up with CSS alone (no wait for JavaScript), so the headline paints at once. */}
        <div className="relative motion-safe:animate-[pop_.7s_cubic-bezier(.2,.7,.2,1)_both]">
          <Eyebrow>Skill Mountain Academy · Established 2021</Eyebrow>
          {/* The brand message: the largest type on the site. */}
          <h1 data-hero-headline className="mt-5 font-(family-name:--font-serif) text-[clamp(3.6rem,11vw,6rem)] font-medium leading-[0.98] lg:text-[clamp(3.6rem,5.4vw,5.1rem)] tracking-[-0.02em]">
            For those{" "}
            <em className="font-medium text-brand-red">made for more.</em>
          </h1>
          <p className="mt-7 max-w-lg font-display text-lg font-medium leading-snug text-ink">{BRAND.positioning}</p>
          <p className="mt-4 max-w-lg text-lg leading-relaxed text-ink/70">Learn directly from experienced professionals through personalised one-on-one mentorship, intelligent learning assistance and intensive practical training, designed to turn knowledge into professional capability.</p>
          <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
            <a href="#programmes" className={btnPrimary}>Explore programmes <Arrow /></a>
            <Link href="/learning-experience/" className="font-display text-sm font-semibold text-ink underline decoration-ink/30 underline-offset-[6px] transition hover:decoration-brand-red">The learning experience</Link>
          </div>
        </div>

        <div className="motion-safe:animate-[pop_.7s_cubic-bezier(.2,.7,.2,1)_.15s_both]">
          <div className="flex h-[26rem] gap-3 sm:h-[30rem] lg:h-[33rem]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
            onTouchStart={(e) => { touch.current = e.touches[0].clientX; setPaused(true); }}
            onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 40) slide(dx < 0 ? 1 : -1); setPaused(false); }}>
            {SLIDES.map((sl, i) => {
              const on = i === active;
              return (
                <div key={sl.id} onClick={() => setActive(i)} onMouseEnter={() => setActive(i)} role="button" tabIndex={0} aria-label={sl.name} onKeyDown={(e) => e.key === "Enter" && setActive(i)}
                  className={`relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br ${sl.tone} transition-all duration-700 ease-out ${on ? "flex-[6]" : "hidden flex-[1] cursor-pointer md:block"}`}>
                  <Image src={sl.photo} alt={`A learner studying ${sl.name} online with Skill Mountain Academy`} fill priority={i === 0} sizes="(max-width: 768px) 90vw, 40vw" className="object-cover" style={{ objectPosition: FOCUS[sl.id] }} />
                  <div className={`absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent transition-opacity duration-500 ${on ? "opacity-100" : "opacity-40"}`} />
                  {on ? (
                    <div className="pop absolute inset-x-0 bottom-0 p-5 text-white sm:p-6">
                      <SlideStatus slug={sl.id} />
                      <h2 className="mt-3 font-display text-2xl font-extrabold sm:text-3xl">{sl.name}</h2>
                      <p className="text-white/85">{duration(sl.prog)} · one-on-one</p>
                      <Link href={progHref(sl.prog)} onClick={(e) => e.stopPropagation()} className="mt-3 inline-block whitespace-nowrap rounded-full bg-white px-6 py-3 font-display font-semibold text-ink transition hover:bg-cream">Explore Programme</Link>
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
        </div>
      </section>

      {/* Three principles */}
      <section aria-label="Our principles" className="border-y border-ink/10 bg-paper">
        <div className="mx-auto grid max-w-6xl md:grid-cols-3">
          {[["Human mentorship", "An assigned instructor teaches you one-on-one, live, every week."], ["Intelligent learning", "An AI assistant limited to your programme supports revision between sessions."], ["Practical mastery", "Assignments, assessed projects and an internship phase build demonstrable competence."]].map(([t, d], i) => (
            <div key={t} className={`px-5 py-9 md:px-8 ${i ? "border-t border-ink/10 md:border-l md:border-t-0" : ""}`}>
              <p className={`${SERIF} text-2xl`}>{t}<span className="text-brand-red">.</span></p>
              <p className="mt-2 text-ink/70">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The institution */}
      <section id="why" className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-14 px-5 py-20 sm:py-28 lg:grid-cols-2">
        <Reveal>
          <SectionHead eyebrow="An institution with standards" title={<>Taught by people who practise what they teach.</>}
            lede="Skill Mountain Academy is not a marketplace where anyone uploads a course. Every student is taught by an instructor we have verified, in a live one-on-one session, every week." />
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink/70">You are not left alone with prerecorded videos. Your instructor demonstrates, watches you work, corrects you and marks what you produce. Technology supports that relationship; it does not replace it.</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/about/" className={btnOutline}>About the Academy</Link>
            <Link href="/faculty/" className="self-center font-display text-sm font-semibold text-indigo underline decoration-indigo/30 underline-offset-[6px]">How we select our faculty</Link>
          </div>
        </Reveal>
        <Reveal delay={150} className="relative">
          <div className="relative overflow-hidden rounded-lg bg-indigo pt-10">
            <Image src={banner} alt="Five students sitting together with their hands raised" className="relative mx-auto h-auto w-full max-w-[34rem] px-4" />
          </div>
          <div className="absolute -bottom-6 left-6 rounded-md bg-paper px-6 py-4 shadow-xl shadow-ink/10">
            <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-ink/55">Learning format</p>
            <p className={`${SERIF} mt-1 text-xl`}>One instructor, one student</p>
          </div>
        </Reveal>
      </section>

      {/* Programmes */}
      <section id="programmes" className="scroll-mt-20 border-t border-ink/10 bg-paper/60 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal className="flex flex-wrap items-end justify-between gap-6">
            <SectionHead eyebrow="Programmes" title="Disciplines of professional consequence." lede="Each programme combines one-on-one instruction, structured assessment and an intensive practical phase. Explore a programme to understand the experience before you enrol." />
            <Link href="/programmes/" className="font-display text-sm font-semibold text-indigo underline decoration-indigo/30 underline-offset-[6px]">All programmes</Link>
          </Reveal>
          <div className="mt-10 flex gap-1 overflow-x-auto border-b border-ink/10 no-scrollbar" role="tablist" aria-label="Disciplines">
            {cats.map((c) => (
              <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)} className={`-mb-px shrink-0 border-b-2 px-4 py-3 font-display text-sm font-medium transition ${cat === c ? "border-brand-red text-ink" : "border-transparent text-ink/60 hover:text-ink"}`}>{c}</button>
            ))}
          </div>
          <div className="mt-10"><ProgrammeGrid list={list} /></div>

          {/* Cloud track comparison */}
          <Reveal className="mt-20">
            <div id="cloud-track" className="scroll-mt-24 rounded-lg border border-ink/10 bg-paper p-6 sm:p-10">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <Eyebrow>The Cloud track</Eyebrow>
                  <h3 className={`${SERIF} mt-3 text-3xl sm:text-4xl`}>Which cloud programme is right for you?</h3>
                  <p className="mt-3 max-w-2xl text-ink/70">All three teach both AWS and Azure. Choose by where you are today.</p>
                </div>
                <CloudBadges />
              </div>
              <div className="mt-8 grid md:grid-cols-3">
                {CLOUD_TRACK.map((p, i) => (
                  <div key={p.slug} className={`flex flex-col py-6 md:px-6 ${i ? "border-t border-ink/10 md:border-l md:border-t-0" : "md:pl-0"}`}>
                    <h4 className="font-display text-lg font-semibold">{p.name}</h4>
                    <dl className="mt-4 flex-1 space-y-3 text-sm">
                      <div><dt className="font-semibold">Level</dt><dd className="text-ink/70">{p.level}</dd></div>
                      <div><dt className="font-semibold">Who it&apos;s for</dt><dd className="text-ink/70">{p.audience}</dd></div>
                      <div><dt className="font-semibold">Duration</dt><dd className="text-ink/70">{duration(p)}</dd></div>
                    </dl>
                    <Link href={progHref(p)} className="mt-5 inline-flex items-center gap-2 font-display text-sm font-semibold text-indigo">Explore Programme <Arrow /></Link>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          {/* Goal finder */}
          <Reveal className="mt-8">
            <div id="goal" className="scroll-mt-24 rounded-lg bg-indigo p-6 text-white sm:p-10">
              <Eyebrow light>Find your discipline</Eyebrow>
              <p className={`${SERIF} mt-3 text-3xl`}>What do you want to be able to do?</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {GOALS.map((g, i) => (
                  <button key={g.goal} onClick={() => setGoal(i)} aria-pressed={goal === i} className={`rounded-full border px-4 py-2 text-sm font-medium transition ${goal === i ? "border-cream bg-cream text-indigo" : "border-white/25 hover:border-white/60"}`}>{g.goal}</button>
                ))}
              </div>
              <div className="mt-8 grid items-end gap-6 border-t border-white/15 pt-6 sm:grid-cols-[1fr_auto]">
                <div>
                  <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-white/60">We suggest</p>
                  <p className={`${SERIF} mt-2 text-3xl`}>{rec.name}</p>
                  <p className="mt-2 max-w-2xl text-white/75">{GOALS[goal].why}</p>
                </div>
                <Link href={progHref(rec)} className={btnLight}>Explore Programme <Arrow /></Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* The learning experience */}
      <section id="experience" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:py-28">
        <Reveal className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
          <div>
            <SectionHead eyebrow="The learning experience" title="Not a collection of videos." lede="Students learn through a structured relationship with an instructor, supported by technology and tested by practical work." />
            <Link href="/learning-experience/" className={`${btnOutline} mt-8`}>How a programme works</Link>
          </div>
          <NumberedList items={MODEL} />
        </Reveal>
      </section>

      {/* Practical mastery */}
      <section className="relative overflow-hidden bg-indigo py-20 text-white sm:py-28">
        <div className="relative mx-auto grid max-w-6xl gap-12 px-5 lg:grid-cols-2">
          <Reveal>
            <SectionHead light eyebrow="Practical mastery" title="Knowledge is demonstrated through application." lede="After the instructional phase, every programme continues into an intensive practical phase. Students work on structured projects, receive corrections and build a portfolio of completed work." />
            <p className="mt-5 max-w-xl text-white/60">Where approved internship partners exist we may connect students with practical opportunities. We do not promise external placements, employment or income.</p>
          </Reveal>
          <Reveal delay={120}>
            <ul className="grid gap-x-8 sm:grid-cols-2">
              {["Practical assignments set and marked by your instructor", "Real or carefully structured simulated projects", "Corrections and written feedback", "A portfolio of completed, explainable work", "Assessment of demonstrated competence", "An SMA certificate on meeting the requirements"].map((t) => (
                <li key={t} className="border-t border-white/15 py-4 text-white/85">{t}</li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* Standards and faculty */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
        <Reveal className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
          <div>
            <SectionHead eyebrow="Our standards" title="Selected with care. Held to account." lede="Instructors are verified and assessed before they teach. Every session is scheduled on a fixed timetable, every outcome is logged, and students rate their instructors." />
            <Link href="/faculty/" className={`${btnOutline} mt-8`}>Our Faculty</Link>
          </div>
          <NumberedList items={STANDARDS} cols={1} />
        </Reveal>
      </section>

      {/* Who we teach */}
      <section id="who" className="scroll-mt-20 border-t border-ink/10 bg-paper/60 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal><SectionHead eyebrow="Who we teach" title="For people who intend to go further." /></Reveal>
          <div className="mt-10 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
            {AUDIENCE.map(([t, d, href]) => (
              <div key={t} className="border-t border-ink/10 py-6">
                <h3 className="font-display text-base font-semibold">{href ? <Link href={href} className="hover:text-brand-red">{t}</Link> : t}</h3>
                <p className="mt-1.5 text-ink/70">{d}</p>
                {href && <Link href={href} className="mt-2 inline-block text-sm font-semibold text-brand-red underline">About the children&apos;s package</Link>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Admissions */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:py-28">
        <Reveal className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
          <div>
            <SectionHead eyebrow="Admissions" title="An intentional path to enrolment." lede="Admissions are managed in periods, and enrolment on each programme is matched to the instructors available to teach it." />
            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/admissions/" className={btnPrimary}>Admissions</Link>
            </div>
          </div>
          <NumberedList items={JOURNEY} />
        </Reveal>
      </section>

      {/* Free consultation */}
      <section id="book" className="scroll-mt-20 border-t border-ink/10 px-5 py-20 text-center sm:py-24">
        <Reveal className="mx-auto max-w-3xl">
          <SectionHead center eyebrow="Speak with Admissions" title="Questions before you decide?" lede="Book a call. We will listen to your goals and help you choose the right programme before you pay anything." />
          <div className="mt-8"><CalendlyEmbed url={CFG.calendlyConsult} /></div>
        </Reveal>
      </section>

      {(SHOW_REVIEWS || REVIEW_SHOTS.length > 0) && (
      <section id="reviews" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:py-24">
        <Reveal><SectionHead center eyebrow="Students" title="In their own words." /></Reveal>
        {SHOW_REVIEWS && (
          <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3" data-reviews>
            {REVIEWS.map((r) => (
              <li key={`${r.name}-${r.quote.slice(0, 20)}`} className="flex flex-col border-t border-ink/15 pt-6">
                <blockquote className={`${SERIF} flex-1 text-2xl leading-snug text-ink/85`}>&ldquo;{r.quote}&rdquo;</blockquote>
                <div className="mt-5 flex items-center gap-3">
                  {r.photo && <img src={`/reviews/${r.photo}`} alt={`Photo of ${r.name}`} loading="lazy" width={48} height={48} className="h-12 w-12 rounded-full object-cover" />}
                  <p className="text-sm"><b className="font-display">{r.name}</b><span className="block text-ink/65">{progName(r.programme)} · {r.year}</span></p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {REVIEW_SHOTS.length ? (
          <div className="mt-12 columns-1 gap-4 sm:columns-2 lg:columns-3">
            {REVIEW_SHOTS.map((r, i) => (
              <button key={r.file} onClick={() => setShot(i)} className="mb-4 block w-full break-inside-avoid overflow-hidden rounded-lg border border-ink/10 bg-white text-left transition hover:shadow-xl hover:shadow-ink/10" aria-label={`Open ${r.alt}`}>
                <img src={`/reviews/${r.file}`} alt={r.alt} loading="lazy" className="h-auto w-full" />
                <span className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-ink/70"><SocialIcon name={r.platform} />{r.platform}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>
      )}
      {shot !== null && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/80 p-4" onClick={() => setShot(null)} role="dialog" aria-modal="true" aria-label="Student post">
          <img src={`/reviews/${REVIEW_SHOTS[shot].file}`} alt={REVIEW_SHOTS[shot].alt} className="max-h-[90dvh] max-w-full rounded-lg bg-white object-contain" />
          <button aria-label="Close" className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white text-lg">✕</button>
        </div>
      )}

      {SHOW_MENTORS && (
        <section id="mentors" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-20" data-mentors>
          <Reveal><SectionHead center eyebrow="Faculty" title="Members of our faculty." /></Reveal>
          <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {MENTORS.map((m) => (
              <li key={m.name} className="border-t border-ink/15 pt-6">
                {m.photo && <img src={`/mentors/${m.photo}`} alt={`Photo of ${m.name}, ${m.role}`} loading="lazy" width={80} height={80} className="h-20 w-20 rounded-full object-cover" />}
                <h3 className={`${SERIF} mt-4 text-2xl`}>{m.name}</h3>
                <p className="text-sm font-semibold text-brand-red">{m.role}</p>
                {m.bio && <p className="mt-2 text-ink/70">{m.bio}</p>}
                {m.programmes?.length ? <p className="mt-2 text-sm text-ink/65">Teaches: {m.programmes.map(progName).join(", ")}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 border-t border-ink/10 bg-paper/60 py-20 sm:py-24">
        <div className="mx-auto max-w-3xl px-5">
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_LD).replace(/</g, "\\u003c") }} />
          <Reveal><SectionHead eyebrow="Questions" title="Frequently asked." /></Reveal>
          <div className="mt-10">
            {FAQS.map(([qq, a]) => (
              <details key={qq} className="group border-t border-ink/10 py-5 last:border-b">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display font-semibold">{qq}<span className="text-xl font-light text-brand-red transition group-open:rotate-45" aria-hidden="true">+</span></summary>
                <p className="mt-3 leading-relaxed text-ink/70">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Vision and partners */}
      <section className="relative overflow-hidden bg-indigo pt-20 text-white sm:pt-24">
        <div className="relative mx-auto grid max-w-6xl items-end gap-10 px-5 lg:grid-cols-[1.2fr_.8fr]">
          <Reveal className="pb-20 sm:pb-24">
            <Eyebrow light>Our ambition</Eyebrow>
            <h2 className={`${SERIF} mt-4 text-4xl leading-tight sm:text-5xl`}>A globally respected institution for professional digital skills.</h2>
            <p className="mt-5 max-w-2xl text-lg text-white/75">We are building, carefully, an institution that combines exceptional human instruction with intelligent learning support, for students wherever they are. If you represent an organisation that shares this ambition, we would welcome a conversation.</p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a href={partnerHref} target="_blank" rel="noopener noreferrer" className={btnLight}>Institutional partnerships</a>
              <Link href="/about/" className={btnOutlineLight}>About the Academy</Link>
            </div>
          </Reveal>
          <div className="hidden justify-center lg:flex">
            <Image src={SMA_PHOTO} alt="A learner wearing a Skill Mountain Academy t-shirt" className="h-auto max-h-[25rem] w-auto" />
          </div>
        </div>
      </section>

      {/* Mailing list */}
      <section className="bg-black text-white/75">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 pt-12 md:flex-row md:items-end md:justify-between">
          <div>
            <p className={`${SERIF} text-2xl text-white`}>Correspondence from the Academy</p>
            <p className="mt-1 text-sm text-white/60">Admission periods, new programmes and institutional news. Occasional, never noisy.</p>
          </div>
          <div className="w-full max-w-md">
            {subbed ? <p className="font-semibold text-brand-orange">Thank you. You&apos;re subscribed.</p> : (
              <form onSubmit={subscribe}>
                <div className="flex overflow-hidden rounded-full bg-white text-ink">
                  <input name="email" type="email" required maxLength={120} placeholder="Your email address" aria-label="Email address" className="min-w-0 flex-1 bg-transparent px-5 py-3.5 text-left outline-none" />
                  <button className="bg-indigo px-6 font-display text-sm font-semibold text-cream">Subscribe</button>
                </div>
                <label className="mt-3 flex items-start gap-2 text-left text-xs text-white/65">
                  <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 shrink-0 accent-[#f7892b]" />
                  <span>I agree to receive emails from Skill Mountain Academy and can unsubscribe at any time. See our <Link href="/privacy/" className="underline hover:text-white">Privacy Policy</Link>.</span>
                </label>
              </form>
            )}
          </div>
        </div>
        <Rule light className="mx-auto mt-12 max-w-6xl" />
      </section>
      </main>
      <SiteFooter />

      <a href={`https://wa.me/${CFG.whatsapp}`} aria-label="Chat with us on WhatsApp" className="fixed bottom-4 right-4 z-30 rounded-full bg-[#25d366] px-4 py-2.5 font-display text-sm font-semibold text-ink shadow-xl transition hover:scale-105">Chat</a>
    </>
  );
}

