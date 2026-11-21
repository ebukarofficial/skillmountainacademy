import type { Metadata } from "next";
import { FACULTY_STAGES } from "@/lib/institution";
import { Arrow, PageHero, SERIF, btnOutline } from "../brand";
import { SiteFooter, SiteHeader } from "../site-parts";
import { FacultyList } from "./faculty-list";

export const metadata: Metadata = {
  title: "Our Faculty | Skill Mountain Academy",
  description: "How Skill Mountain Academy selects and verifies its instructors: credential verification, portfolio review, discipline-specific technical assessment, a teaching demonstration and interview.",
  alternates: { canonical: "/faculty/" },
};


export default function FacultyPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        <PageHero title="The instructor is the institution."
          lede="Our faculty are practitioners with demonstrated expertise in the disciplines they teach, and the ability to teach them well." />

        <section aria-labelledby="members" className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <h2 id="members" className={`${SERIF} text-3xl leading-tight sm:text-4xl`}>Members of our faculty</h2>
          <div className="mt-8"><FacultyList /></div>
        </section>

        <section aria-labelledby="selection" className="border-t border-ink/10 bg-white py-16 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 lg:grid-cols-[.8fr_1.2fr]">
            <div>
              <h2 id="selection" className={`${SERIF} text-3xl leading-tight sm:text-4xl`}>How instructors are selected</h2>
              <p className="mt-4 text-lg leading-relaxed text-ink/75">Every candidate passes the same process, and only approved instructors teach. Candidates perform the work they will teach, and then they teach it. A verified badge appears beside an instructor&apos;s name once the Academy has approved their profile.</p>
            </div>
            <ol className="grid gap-x-8 sm:grid-cols-2">
              {FACULTY_STAGES.map(([t], i) => <li key={t} className="flex gap-4 border-t border-ink/10 py-3.5"><span className="w-6 shrink-0 font-display font-semibold text-ink/50">{i + 1}</span><span className="font-display font-semibold">{t}</span></li>)}
            </ol>
          </div>
        </section>

        <section className="border-t border-ink/10 py-16">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 sm:flex-row sm:items-center">
            <div>
              <p className={`${SERIF} text-3xl`}>Interested in teaching at the Academy?</p>
              <p className="mt-2 max-w-xl text-ink/70">We welcome enquiries from accomplished practitioners and academics. Write to us with your discipline, qualifications and examples of your work.</p>
            </div>
            <a href="mailto:admission@skillmountainacademy.com?subject=Faculty%20enquiry" className={btnOutline}>Faculty enquiries <Arrow /></a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
