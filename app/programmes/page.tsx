import type { Metadata } from "next";
import Link from "next/link";
import { PROGRAMMES } from "@/lib/config";
import { Arrow, PageHero, ProgrammeGrid, btnOutline } from "../brand";
import { SiteFooter, SiteHeader } from "../site-parts";

export const metadata: Metadata = {
  title: "Programmes | Skill Mountain Academy",
  description: "Programmes in design, web development, digital marketing, cybersecurity, cloud and DevOps, taught one-on-one by an assigned instructor, with assessment and an intensive practical phase.",
  alternates: { canonical: "/programmes/" },
};

const GROUPS = Array.from(new Set(PROGRAMMES.map((p) => p.tag)));

export default function ProgrammesPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        <PageHero eyebrow="Programmes" title="Disciplines of professional consequence."
          lede="Every programme is taught one-on-one by an assigned instructor, assessed through practical work and completed with an intensive practical phase. Choose a programme to read about the experience, the outcomes and the curriculum." />
        {GROUPS.map((g) => (
          <section key={g} aria-labelledby={`g-${g}`} className="mx-auto max-w-6xl px-5 py-14 first-of-type:pt-16">
            <h2 id={`g-${g}`} className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-brand-red">{g}</h2>
            <div className="mt-6"><ProgrammeGrid list={PROGRAMMES.filter((p) => p.tag === g)} /></div>
          </section>
        ))}
        <section className="mx-auto max-w-6xl px-5 pb-24 pt-6">
          <div className="flex flex-col items-start justify-between gap-6 border-t border-ink/10 pt-10 sm:flex-row sm:items-center">
            <p className="max-w-xl text-lg text-ink/70">Unsure which programme suits you? Our Admissions team can help you decide before you pay anything.</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/admissions/" className={btnOutline}>Admissions <Arrow /></Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
