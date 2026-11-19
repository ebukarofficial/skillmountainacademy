// Shared, server-rendered parts: the brand message, the Career Launch Package, trust lines and curriculum buttons.
// Colours come only from the existing tokens in app/globals.css.
import Image from "next/image";
import Link from "next/link";
import logo from "@/assets/sma-logo.png";
import logoWhite from "@/assets/sma-logo-white.png";
import { BUSINESS, MESSAGE, SOCIAL, careerPackage, pillars, type Programme } from "@/lib/config";
import { hasPdf } from "@/lib/curricula";
import { SocialIcon } from "./components";
import { CurrencySwitcher, FxNote } from "./currency";

// Slim strip that repeats the message at the top of programme pages and the registration page.
export function MessageStrip() {
  return (
    <div className="bg-indigo px-5 py-2.5 text-center text-sm text-white">
      <b className="font-display text-brand-orange">{MESSAGE.headline}</b> <span className="text-white/85">One teacher, one student · Pick your day and time · Pay in 3 parts</span>
    </div>
  );
}

// Full-width band directly under the hero.
export function PillarsBand() {
  const list = pillars();
  return (
    <section aria-label="How SMA works" className="bg-indigo text-white">
      <div className={`mx-auto grid max-w-6xl gap-6 px-5 py-9 sm:py-11 ${list.length > 2 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {list.map((pl) => (
          <div key={pl.title} className="flex gap-4">
            <span className="brand-bg mt-1 h-10 w-1.5 shrink-0 rounded-full" aria-hidden="true" />
            <div>
              <p className="font-display text-2xl font-extrabold text-brand-orange sm:text-3xl">{pl.title}</p>
              <p className="mt-1 text-lg text-white/85">{pl.text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CareerLaunch({ p }: { p: Programme }) {
  return (
    <section aria-labelledby="career" className="rounded-[1.75rem] bg-indigo p-6 text-white sm:p-8">
      <h2 id="career" className="font-display text-2xl font-extrabold">Career Launch Package</h2>
      <p className="mt-1 text-white/75">Included with {p.name}.</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {careerPackage(p).map((c) => (
          <li key={c} className="flex gap-3 rounded-2xl bg-white/10 px-4 py-3"><span className="text-brand-orange" aria-hidden="true">✓</span><span>{c}</span></li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-white/70">Career support helps you prepare. We do not promise a job, a placement or income.</p>
    </section>
  );
}

export function TrustLines() {
  const items = [
    "Skill Mountain Academy certificate when you complete the programme",
    "Online, one-on-one with your own mentor",
    "Pay in full or in 3 parts (50%, 30%, 20%)",
  ];
  return (
    <ul className="space-y-2 text-sm text-ink/80">
      {items.map((t) => <li key={t} className="flex gap-2"><span className="font-bold text-brand-red" aria-hidden="true">✓</span>{t}</li>)}
      <li className="flex gap-2"><span className="font-bold text-brand-red" aria-hidden="true">✓</span><span>Clear refund rules: read our <Link href="/refunds/" className="font-semibold text-brand-red underline">Refund Policy</Link></span></li>
    </ul>
  );
}

// "View curriculum" opens the PDF in a new tab; "Download" saves it. With no PDF the button is disabled.
export function CurriculumActions({ p, dark = false }: { p: Programme; dark?: boolean }) {
  const btn = `rounded-full border-2 px-6 py-3 text-center font-display font-semibold transition ${dark ? "border-white/40 text-white" : "border-indigo text-indigo"}`;
  if (!hasPdf(p)) {
    return (
      <div>
        <button type="button" disabled aria-describedby={`cur-${p.slug}`} className={`${btn} w-full cursor-not-allowed opacity-50 sm:w-auto`}>View curriculum</button>
        <p id={`cur-${p.slug}`} className={`mt-2 text-sm ${dark ? "text-white/70" : "text-ink/70"}`}>The curriculum PDF is not online yet. Your welcome email includes the full curriculum.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-3">
      <a href={p.curriculum} target="_blank" rel="noopener" className={`${btn} ${dark ? "hover:bg-white hover:text-ink" : "hover:bg-indigo hover:text-white"}`}>View curriculum<span className="sr-only"> (PDF, opens in a new tab)</span></a>
      <a href={p.curriculum} download className={`self-center text-sm font-semibold underline ${dark ? "text-white" : "text-brand-red"}`}>Download PDF</a>
    </div>
  );
}

// Header and footer for the programme and children pages.
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 bg-cream/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3" aria-label="Main">
        <Link href="/" aria-label="Skill Mountain Academy home"><Image src={logo} alt="Skill Mountain Academy" priority unoptimized className="h-10 w-auto sm:h-12" /></Link>
        <div className="flex items-center gap-3">
          <CurrencySwitcher />
          <Link href="/#programmes" className="rounded-full bg-indigo px-5 py-2.5 font-display text-sm font-semibold text-cream transition hover:bg-navy"><span className="hidden sm:inline">All </span>Programmes</Link>
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-black text-white/75">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 md:grid-cols-2">
        <div>
          <Image src={logoWhite} alt="Skill Mountain Academy" unoptimized className="h-12 w-auto" />
          <p className="mt-4 max-w-md">{MESSAGE.short}</p>
          <div className="mt-4 flex items-center gap-5">
            {SOCIAL.map((so) => <a key={so.name} href={so.url} target="_blank" rel="noopener noreferrer" aria-label={`Skill Mountain Academy on ${so.name}`} className="text-white/70 transition hover:text-brand-orange"><SocialIcon name={so.name} /></a>)}
          </div>
        </div>
        <div className="flex flex-col gap-3 text-sm md:items-end md:text-right">
          <p>Email: <a href={`mailto:${BUSINESS.email}`} className="font-semibold text-white underline">{BUSINESS.email}</a></p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1 text-white/70 md:justify-end">
            <Link href="/terms/" className="underline hover:text-white">Terms</Link>
            <Link href="/privacy/" className="underline hover:text-white">Privacy</Link>
            <Link href="/cookies/" className="underline hover:text-white">Cookies</Link>
            <Link href="/refunds/" className="underline hover:text-white">Refunds</Link>
          </nav>
          <FxNote className="text-white/60" />
          <p className="text-white/60">{BUSINESS.name}{BUSINESS.rc ? ` (RC ${BUSINESS.rc})` : ""}<br />{BUSINESS.address}</p>
        </div>
      </div>
    </footer>
  );
}
