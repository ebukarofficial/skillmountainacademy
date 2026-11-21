"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import banner from "@/assets/photos/banner-students.webp";
import logoMark from "@/assets/sma-logo.png";
import { BUSINESS, CFG, faqList, PROGRAMMES, REVIEW_SHOTS, duration, type Programme } from "@/lib/config";
import { MENTORS, REVIEWS, SHOW_MENTORS, SHOW_REVIEWS } from "@/lib/content";
import { BRAND } from "@/lib/institution";
import { FOCUS, Intro, PHOTO, Reveal, SocialIcon, postSheet } from "./components";
import { Arrow, Eyebrow, ProgrammeGrid, Rule, SERIF, SectionHead, btnOutline, btnPrimary } from "./brand";
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
  const [shot, setShot] = useState<number | null>(null);
  const [subbed, setSubbed] = useState(false);
  const [notice, setNotice] = useState<"" | "removed" | "pay-unavailable">("");
  const touch = useRef(0);

  const cats = ["All", ...Array.from(new Set(PROGRAMMES.map((p) => p.tag)))];
  const list = PROGRAMMES.filter((p) => cat === "All" || p.tag === cat);

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
          <Eyebrow>Skill Mountain Academy</Eyebrow>
          {/* The brand message: the largest type on the site. */}
          <h1 data-hero-headline className="mt-5 font-(family-name:--font-serif) text-[clamp(3.6rem,11vw,6rem)] font-medium leading-[0.98] lg:text-[clamp(3.6rem,5.4vw,5.1rem)] tracking-[-0.02em]">
            For those{" "}
            <em className="font-medium text-brand-red">made for more.</em>
          </h1>
          <p className="mt-7 max-w-lg text-xl leading-relaxed text-ink/75">{BRAND.positioning}</p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
            <a href="#programmes" className={btnPrimary}>Explore programmes <Arrow /></a>
            <Link href="/admissions/" className="font-display text-[0.95rem] font-semibold text-indigo underline decoration-indigo/30 underline-offset-[6px] transition hover:decoration-indigo">How admission works</Link>
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

      {/* 3. A concise introduction to the Academy */}
      <section id="why" className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-12 border-t border-ink/10 px-5 py-16 sm:py-20 lg:grid-cols-2">
        <Reveal>
          <SectionHead eyebrow="The Academy" title="An online academy for professional digital disciplines."
            lede="Skill Mountain Academy teaches eight programmes in design, engineering, security, cloud and marketing. Each student is admitted to one programme and studies it with an assigned instructor, live and online." />
          <div className="mt-7 flex flex-wrap gap-4">
            <Link href="/about/" className={btnOutline}>About the Academy</Link>
          </div>
        </Reveal>
        <Reveal delay={150}>
          <div className="relative overflow-hidden rounded-xl bg-indigo pt-8">
            <Image src={banner} alt="Five students sitting together with their hands raised" className="relative mx-auto h-auto w-full max-w-[32rem] px-4" />
          </div>
        </Reveal>
      </section>

      {/* 4. Programme discovery */}
      <section id="programmes" className="scroll-mt-20 border-t border-ink/10 bg-paper/60 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-5">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHead eyebrow="Programmes" title="Choose a discipline." lede="Each programme page sets out what you will study, how long it takes, the internship and the investment." />
            <Link href="/programmes/" className="font-display text-[0.95rem] font-semibold text-indigo underline decoration-indigo/30 underline-offset-[6px]">Search the catalogue</Link>
          </div>
          <div className="mt-8 flex gap-1 overflow-x-auto border-b border-ink/15 no-scrollbar" role="tablist" aria-label="Disciplines">
            {cats.map((c) => (
              <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)} className={`-mb-px shrink-0 border-b-[3px] px-4 py-3 font-display text-[0.95rem] font-semibold transition ${cat === c ? "border-indigo text-indigo" : "border-transparent text-ink/70 hover:text-ink"}`}>{c}</button>
            ))}
          </div>
          <div className="mt-8"><ProgrammeGrid list={list} /></div>
        </div>
      </section>

      {/* 5. Institutional credibility: what the Academy actually issues and checks */}
      <section id="certificate" aria-labelledby="cert-h" className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-12 px-5 py-16 sm:py-20 lg:grid-cols-[1fr_1.05fr]">
        <Reveal>
          <Eyebrow>Records and certification</Eyebrow>
          <h2 id="cert-h" className={`${SERIF} mt-2 text-3xl leading-tight sm:text-4xl`}>Your study is recorded, and your completion is certified.</h2>
          <p className="mt-4 text-lg leading-relaxed text-ink/75">Students who complete their programme&apos;s requirements receive a Skill Mountain Academy certificate. It is the Academy&apos;s own certificate, not a university degree or a government or professional qualification.</p>
          <ul className="mt-7 divide-y divide-ink/10 border-y border-ink/10">
            {[["A registration number for every student", "Issued on admission, in the form SMA/26/000001, and used on your records."],
              ["Verified instructors", "Identity, credentials and a technical assessment are checked before an instructor teaches."],
              ["Assessed coursework and attendance", "Assignments, assessments and every class are recorded in your learning space."]].map(([t, d]) => (
              <li key={t} className="py-4"><p className="font-display font-semibold">{t}</p><p className="mt-1 text-ink/75">{d}</p></li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={150}>
          <figure>
            {/* An illustrative certificate drawn in HTML: clearly marked as a sample. */}
            <div className="relative overflow-hidden rounded-md border-[6px] border-double border-indigo/70 bg-white p-2 shadow-xl shadow-ink/10">
              <div className="relative border border-indigo/30 px-6 py-8 text-center sm:px-10 sm:py-10">
                <Image src={logoMark} alt="Skill Mountain Academy" className="mx-auto h-12 w-auto" />
                <p className="mt-5 text-sm text-ink/70">This is to certify that</p>
                <p className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">Student Name</p>
                <p className="mt-3 text-sm text-ink/70">has successfully completed the programme</p>
                <p className="mt-1 font-display text-xl font-semibold text-indigo sm:text-2xl">UI/UX Design (Product Design)</p>
                <p className="mt-2 text-sm text-ink/70">Registration No. SMA/26/000000</p>
                <div className="mt-8 grid grid-cols-2 gap-6 text-xs text-ink/70">
                  <div className="border-t border-ink/30 pt-2">Programme instructor</div>
                  <div className="border-t border-ink/30 pt-2">For the Academy</div>
                </div>
                <p aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center font-display text-4xl font-bold text-brand-red/15 [rotate:-18deg] [letter-spacing:0.3em] sm:text-[2.5rem]">SAMPLE</p>
              </div>
            </div>
            <figcaption className="mt-3 text-sm text-ink/70">Illustration only. The certificate actually issued may differ in layout and wording.</figcaption>
          </figure>
        </Reveal>
      </section>

      {/* 6. The learning model, once and briefly */}
      <section id="model" aria-labelledby="model-h" className="scroll-mt-20 border-t border-ink/10 bg-paper/60 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-5">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-3xl"><Eyebrow>How you learn</Eyebrow><h2 id="model-h" className={`${SERIF} mt-2 text-3xl leading-tight sm:text-4xl`}>One programme, one instructor, one weekly class.</h2></div>
            <Link href="/learning-experience/" className="font-display text-[0.95rem] font-semibold text-indigo underline decoration-indigo/30 underline-offset-[6px]">The Learning Experience</Link>
          </div>
          <ol className="mt-10 grid gap-6 md:grid-cols-4">
            {[["Live classes", "A fixed weekly class with your instructor on Google Meet."],
              ["Coursework", "Assignments and assessments, marked with written feedback."],
              ["Between classes", "Approved materials and a learning assistant grounded in them."],
              ["Practical work", "Finished projects, followed by the programme's internship period."]].map(([t, d], i) => (
              <li key={t} className="rounded-xl border border-ink/10 bg-paper p-5">
                <span className="font-display text-sm font-semibold text-brand-red">Step {i + 1}</span>
                <p className="mt-1 font-display text-lg font-semibold">{t}</p>
                <p className="mt-1.5 text-ink/75">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 7. Faculty introduction */}
      <section id="faculty" aria-labelledby="fac-h" className="mx-auto grid max-w-6xl scroll-mt-20 gap-10 px-5 py-16 sm:py-20 lg:grid-cols-[1fr_1.2fr]">
        <Reveal>
          <Eyebrow>Faculty</Eyebrow>
          <h2 id="fac-h" className={`${SERIF} mt-2 text-3xl leading-tight sm:text-4xl`}>Instructors who practise what they teach.</h2>
          <p className="mt-4 text-lg leading-relaxed text-ink/75">Every instructor completes a faculty profile, with certifications that can be checked, and is verified by the Academy before teaching. Verified instructors carry a badge beside their name.</p>
          <Link href="/faculty/" className={`${btnOutline} mt-7`}>Our Faculty</Link>
        </Reveal>
        <Reveal delay={150}>
          <ol className="grid gap-4 sm:grid-cols-2">
            {[["Profile", "Biography, discipline, languages and professional links."], ["Credentials", "Certifications with public verification links."], ["Assessment", "A discipline-specific technical assessment."], ["Approval", "Identity and credentials confirmed by the Academy."]].map(([t, d]) => (
              <li key={t} className="rounded-xl border border-ink/10 p-5"><p className="font-display font-semibold">{t}</p><p className="mt-1 text-ink/75">{d}</p></li>
            ))}
          </ol>
        </Reveal>
      </section>

      {/* 8. Admissions pathway */}
      <section id="book" aria-labelledby="adm-h" className="scroll-mt-20 border-t border-ink/10 bg-paper/60 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-5">
          <SectionHead eyebrow="Admissions" title={<span id="adm-h">From programme to learning space in three steps.</span>} />
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {[["Choose your programme", "Read the programme page: curriculum, duration, internship and investment."],
              ["Apply for admission", "Complete the short admission form on the programme page and pay in full or in three parts."],
              ["Receive your access", "Your registration number and admission confirmation are emailed, followed by a link to your learning space."]].map(([t, d], i) => (
              <li key={t} className="relative rounded-xl border border-ink/10 bg-paper p-6">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-indigo font-display font-semibold text-white">{i + 1}</span>
                <p className="mt-4 font-display text-lg font-semibold">{t}</p>
                <p className="mt-1.5 text-ink/75">{d}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a href="#programmes" className={btnPrimary}>Apply for Admission <Arrow /></a>
            <a href={CFG.calendlyConsult} target="_blank" rel="noopener noreferrer" className={btnOutline}>Speak with Admissions</a>
          </div>
        </div>
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

      {/* Questions before applying (part of the admissions pathway) */}
      <section id="faq" className="scroll-mt-20 border-t border-ink/10 py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-5">
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_LD).replace(/</g, "\\u003c") }} />
          <SectionHead eyebrow="Questions" title="Before you apply." />
          <div className="mt-8">
            {FAQS.map(([qq, a]) => (
              <details key={qq} className="group border-t border-ink/10 py-5 last:border-b">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display font-semibold">{qq}<span className="text-xl text-indigo transition group-open:rotate-45" aria-hidden="true">+</span></summary>
                <p className="mt-3 leading-relaxed text-ink/75">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Mailing list */}
      <section className="bg-black text-white/75">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 pt-12 md:flex-row md:items-end md:justify-between">
          <div>
            <p className={`${SERIF} text-2xl text-white`}>Correspondence from the Academy</p>
            <p className="mt-1 text-sm text-white/70">Admission periods, new programmes and institutional news. Occasional, never noisy.</p>
            <a href={partnerHref} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-white underline decoration-white/40 underline-offset-4">Institutional partnerships</a>
          </div>
          <div className="w-full max-w-md">
            {subbed ? <p className="font-semibold text-brand-orange">Thank you. You&apos;re subscribed.</p> : (
              <form onSubmit={subscribe}>
                <div className="flex overflow-hidden rounded-lg bg-white text-ink">
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

