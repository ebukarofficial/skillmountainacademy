// The institutional design language for the public pages: an editorial serif for headlines, quiet eyebrows,
// hairline rules and two button styles. Colours come only from the existing tokens in app/globals.css.
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { PROGRAMMES, duration, type Programme } from "@/lib/config";
import { programmeCopy } from "@/lib/programme-content";
import { FOCUS, PHOTO } from "@/lib/photos";
import { AdmissionBadge, ListedOnly } from "./admissions-status";

// Serif headline face (loaded in app/layout.tsx as --font-serif).
export const SERIF = "font-(family-name:--font-serif) font-medium tracking-[-0.01em]";

export function Eyebrow({ children, light = false, className = "" }: { children: ReactNode; light?: boolean; className?: string }) {
  return <p className={`font-display text-xs font-semibold uppercase tracking-[0.22em] ${light ? "text-brand-orange" : "text-brand-red"} ${className}`}>{children}</p>;
}

export function SectionHead({ eyebrow, title, lede, light = false, center = false, as = "h2" }: { eyebrow?: string; title: ReactNode; lede?: ReactNode; light?: boolean; center?: boolean; as?: "h1" | "h2" }) {
  const H = as;
  return (
    <div className={center ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      {eyebrow && <Eyebrow light={light}>{eyebrow}</Eyebrow>}
      <H className={`${SERIF} mt-3 text-4xl leading-[1.08] sm:text-5xl ${light ? "text-white" : "text-ink"}`}>{title}</H>
      {lede && <p className={`mt-5 text-lg leading-relaxed ${light ? "text-white/75" : "text-ink/70"} ${center ? "mx-auto max-w-2xl" : "max-w-2xl"}`}>{lede}</p>}
    </div>
  );
}

export const Rule = ({ light = false, className = "" }: { light?: boolean; className?: string }) => <hr className={`border-0 border-t ${light ? "border-white/15" : "border-ink/10"} ${className}`} />;

const BTN = "inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 font-display text-sm font-semibold tracking-wide transition";
export const btnPrimary = `${BTN} bg-indigo text-cream hover:bg-navy`;
export const btnLight = `${BTN} bg-cream text-indigo hover:bg-white`;
export const btnOutline = `${BTN} border border-ink/20 text-ink hover:border-indigo hover:bg-indigo hover:text-cream`;
export const btnOutlineLight = `${BTN} border border-white/30 text-white hover:bg-white hover:text-ink`;

export function Arrow() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}

// A numbered editorial list (used for the teaching model, the methodology and the admissions journey).
export function NumberedList({ items, light = false, cols = 2 }: { items: [string, string][]; light?: boolean; cols?: 1 | 2 | 4 }) {
  const grid = cols === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : cols === 2 ? "md:grid-cols-2" : "";
  return (
    <ol className={`grid gap-x-10 ${grid}`}>
      {items.map(([t, d], i) => (
        <li key={t} className={`flex gap-5 border-t py-6 ${light ? "border-white/15" : "border-ink/10"}`}>
          <span className={`${SERIF} w-8 shrink-0 text-2xl leading-none ${light ? "text-brand-orange" : "text-brand-red"}`}>{String(i + 1).padStart(2, "0")}</span>
          <span>
            <span className={`block font-display text-base font-semibold ${light ? "text-white" : "text-ink"}`}>{t}</span>
            <span className={`mt-1.5 block leading-relaxed ${light ? "text-white/70" : "text-ink/70"}`}>{d}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// Programme card for discovery: title, image, institutional description and one action. No price, no topic list.
export function ProgrammeCard({ p, priority = false }: { p: Programme; priority?: boolean }) {
  const href = `/programmes/${p.slug}/`;
  return (
    <ListedOnly slug={p.slug}>
      <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-ink/10 bg-paper transition duration-300 hover:border-ink/25 hover:shadow-xl hover:shadow-ink/10">
        <div className={`relative aspect-[4/3] overflow-hidden bg-gradient-to-br ${p.tone}`}>
          <Image src={PHOTO[p.slug]} alt={`A learner studying ${p.name}`} fill priority={priority} sizes="(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 30vw" className="object-cover transition duration-700 group-hover:scale-[1.03]" style={{ objectPosition: FOCUS[p.slug] }} />
        </div>
        <div className="flex flex-1 flex-col p-6">
          <div className="flex items-center justify-between gap-3">
            <span className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-ink/55">{p.tag}</span>
            <AdmissionBadge slug={p.slug} compact />
          </div>
          <h3 className={`${SERIF} mt-3 text-[1.7rem] leading-tight`}><Link href={href} className="after:absolute after:inset-0">{p.name}</Link></h3>
          <p className="mt-2 font-display text-sm font-medium text-ink/80">{programmeCopy(p.slug).discipline}</p>
          <p className="mt-3 flex-1 leading-relaxed text-ink/70">{p.blurb}</p>
          <p className="mt-5 border-t border-ink/10 pt-4 text-sm text-ink/60">{duration(p)}</p>
          <span className="mt-4 inline-flex items-center gap-2 font-display text-sm font-semibold text-indigo transition group-hover:gap-3">Explore Programme <Arrow /></span>
        </div>
      </article>
    </ListedOnly>
  );
}

export function ProgrammeGrid({ list = PROGRAMMES }: { list?: Programme[] }) {
  return <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{list.map((p, i) => <ProgrammeCard key={p.slug} p={p} priority={i < 3} />)}</div>;
}

export function PageHero({ eyebrow, title, lede, children }: { eyebrow: string; title: ReactNode; lede: ReactNode; children?: ReactNode }) {
  return (
    <section className="border-b border-ink/10">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:pb-20 sm:pt-20">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className={`${SERIF} mt-4 max-w-4xl text-5xl leading-[1.04] sm:text-[3.4rem]`}>{title}</h1>
        <p className="mt-6 max-w-2xl text-xl leading-relaxed text-ink/70">{lede}</p>
        {children}
      </div>
    </section>
  );
}
