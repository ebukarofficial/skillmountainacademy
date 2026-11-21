// Shared, server-rendered parts: the brand line, the Career Launch Package, trust lines, curriculum actions
// and the footer. Colours come only from the existing tokens in app/globals.css.
import { AssistantLauncher } from "./assistant";
import { BookCallDialog } from "./book-call";
import Image from "next/image";
import Link from "next/link";
import logoWhite from "@/assets/sma-logo-white.png";
import { BUSINESS, IMAGE_CREDIT, MESSAGE, PROGRAMMES, SOCIAL, careerPackage, type Programme } from "@/lib/config";
import { hasPdf } from "@/lib/curricula";
import { CurriculumButton, SocialIcon } from "./components";
import { NAV } from "@/lib/nav";
export { SiteHeader } from "./header";

// Slim brand line at the top of programme pages and the enrolment page.
export function MessageStrip() {
  return (
    <div className="bg-indigo px-5 py-2.5 text-center font-display text-xs tracking-[0.18em] text-white/85 uppercase">
      <b className="font-semibold text-brand-orange">{MESSAGE.headline}</b> <span className="hidden sm:inline">· {MESSAGE.short}</span>
    </div>
  );
}

export function CareerLaunch({ p }: { p: Programme }) {
  return (
    <section aria-labelledby="career" className="rounded-lg bg-indigo p-6 text-white sm:p-10">
      <p className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-brand-orange">Professional preparation</p>
      <h2 id="career" className="mt-3 font-(family-name:--font-serif) text-3xl font-medium sm:text-4xl">Career Launch Package</h2>
      <p className="mt-2 text-white/70">Included with {p.name}.</p>
      <ul className="mt-6 grid gap-x-8 sm:grid-cols-2">
        {careerPackage(p).map((c) => (
          <li key={c} className="flex gap-3 border-t border-white/15 py-3.5"><span className="text-brand-orange" aria-hidden="true">—</span><span>{c}</span></li>
        ))}
      </ul>
      <p className="mt-5 text-sm text-white/65">Career support helps you prepare. We do not promise a job, a placement or income.</p>
    </section>
  );
}

export function TrustLines({ fullPaymentOnly = false }: { fullPaymentOnly?: boolean } = {}) {
  const items = [
    "Skill Mountain Academy certificate on completing the programme's requirements",
    "Online, one-on-one with your assigned instructor",
    fullPaymentOnly ? "Paid in full at admission" : "Pay in full or in 3 parts (50%, 30%, 20%)",
  ];
  return (
    <ul className="space-y-2.5 text-sm text-ink/75">
      {items.map((t) => <li key={t} className="flex gap-2.5"><span className="text-brand-red" aria-hidden="true">—</span>{t}</li>)}
      <li className="flex gap-2.5"><span className="text-brand-red" aria-hidden="true">—</span><span>Clear refund rules: read our <Link href="/refunds/" className="font-semibold text-brand-red underline">Refund Policy</Link></span></li>
    </ul>
  );
}

// "View curriculum": the PDF opens in a new tab (the browser's document viewer) with a separate Download link.
// Without a PDF, the button opens the curriculum viewer with the programme's official outline.
export function CurriculumActions({ p, dark = false }: { p: Programme; dark?: boolean }) {
  const btn = `inline-flex items-center justify-center rounded-full border px-7 py-3.5 font-display text-sm font-semibold tracking-wide transition ${dark ? "border-white/30 text-white hover:bg-white hover:text-ink" : "border-ink/20 text-ink hover:border-indigo hover:bg-indigo hover:text-cream"}`;
  if (!hasPdf(p)) return <CurriculumButton p={p} className={btn} label="View curriculum" />;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <a href={p.curriculum} target="_blank" rel="noopener" className={btn}>View curriculum<span className="sr-only"> (PDF, opens in a new tab)</span></a>
      <a href={p.curriculum} download className={`text-sm font-semibold underline ${dark ? "text-white" : "text-brand-red"}`}>Download PDF</a>
    </div>
  );
}

export function SiteFooter() {
  return (
    <>
    {/* Site-wide: the admissions assistant and the Book a call dialog (both open on request only). */}
    <BookCallDialog />
    <AssistantLauncher />
    <footer className="bg-ink text-white/75">
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid gap-10 py-14 [&>*]:min-w-0 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <Image src={logoWhite} alt="Skill Mountain Academy" unoptimized className="h-12 w-auto" />
            <p className="mt-6 font-(family-name:--font-serif) text-2xl text-white">{MESSAGE.headline}</p>
            <p className="mt-2 text-sm">{MESSAGE.short}</p>
            <div className="mt-6 flex items-center gap-5">
              {SOCIAL.map((so) => <a key={so.name} href={so.url} target="_blank" rel="noopener noreferrer" aria-label={`Skill Mountain Academy on ${so.name}`} className="text-white/60 transition hover:text-brand-orange"><SocialIcon name={so.name} /></a>)}
            </div>
          </div>
          <nav aria-label="Institution">
            <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-white">Institution</p>
            <ul className="mt-4 space-y-2.5 text-sm">{NAV.slice(1).map(([h, t]) => <li key={h}><Link href={h} className="hover:text-white">{t}</Link></li>)}</ul>
          </nav>
          <nav aria-label="Programmes">
            <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-white">Programmes</p>
            <ul className="mt-4 space-y-2.5 text-sm">{PROGRAMMES.map((p) => <li key={p.slug}><Link href={`/programmes/${p.slug}/`} className="hover:text-white">{p.name}</Link></li>)}</ul>
          </nav>
          <div>
            <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-white">Contact</p>
            <p className="mt-4 text-sm leading-relaxed">Email: <a href={`mailto:${BUSINESS.email}`} className="break-all font-semibold text-white underline">{BUSINESS.email}</a><br />Phone: <a href={`tel:${BUSINESS.phone.replace(/\s/g, "")}`} className="underline">{BUSINESS.phone}</a></p>
            <p className="mt-4 text-sm text-white/55">{BUSINESS.name}{BUSINESS.rc ? ` (RC ${BUSINESS.rc})` : ""}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-white/10 py-6 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <p>© Skill Mountain Academy {new Date().getFullYear()}{IMAGE_CREDIT ? ` · ${IMAGE_CREDIT}` : ""}</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-1">
            <Link href="/terms/" className="hover:text-white">Terms</Link>
            <Link href="/privacy/" className="hover:text-white">Privacy</Link>
            <Link href="/cookies/" className="hover:text-white">Cookies</Link>
            <Link href="/refunds/" className="hover:text-white">Refunds</Link>
            <Link href="/children/" className="hover:text-white">Children&apos;s package</Link>
          </nav>
        </div>
      </div>
    </footer>
    </>
  );
}
