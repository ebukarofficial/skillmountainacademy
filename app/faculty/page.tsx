import type { Metadata } from "next";
import { FACULTY_STAGES } from "@/lib/institution";
import { Arrow, Eyebrow, NumberedList, PageHero, SERIF, SectionHead, btnOutline } from "../brand";
import { SiteFooter, SiteHeader } from "../site-parts";
import { FacultyList } from "./faculty-list";

export const metadata: Metadata = {
  title: "Our Faculty | Skill Mountain Academy",
  description: "How Skill Mountain Academy selects and verifies its instructors: credential verification, portfolio review, discipline-specific technical assessment, a teaching demonstration and interview.",
  alternates: { canonical: "/faculty/" },
};

const PRIORITIES = ["Master's degree holders", "PhD holders, doctoral researchers and specialists", "Experienced industry professionals", "Recognised practitioners and certified specialists", "Individuals with demonstrable professional achievements"];

export default function FacultyPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        <PageHero eyebrow="Our Faculty" title="The instructor is the institution."
          lede="We do not recruit people because they have an idea of a skill. We look for genuine expertise, demonstrable practical knowledge and the ability to teach it to someone else." />

        <section className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
            <div>
              <SectionHead eyebrow="Who we look for" title="Expertise, demonstrated." />
              <p className="mt-5 text-lg leading-relaxed text-ink/70">Advanced academic qualifications are valued. They are not sufficient alone, and their absence is not disqualifying when a candidate&apos;s practical mastery and professional record are exceptional.</p>
            </div>
            <ul>{PRIORITIES.map((t) => <li key={t} className={`${SERIF} border-t border-ink/10 py-4 text-2xl`}>{t}</li>)}</ul>
          </div>
        </section>

        <section className="bg-indigo py-20 text-white">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHead light eyebrow="Selection" title="Eight stages before anyone teaches." lede="Every candidate passes through the same structured process. Only approved instructors are permitted to teach students." />
            <div className="mt-10"><NumberedList light items={FACULTY_STAGES} /></div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <Eyebrow>Discipline-specific assessment</Eyebrow>
              <h2 className={`${SERIF} mt-3 text-4xl leading-tight`}>Candidates perform the work they will teach.</h2>
            </div>
            <div className="space-y-4 text-lg leading-relaxed text-ink/70">
              <p>A graphic design candidate produces real design work, explains the principles behind it and works fluently in professional software. A web development candidate builds. A cybersecurity candidate demonstrates practical security competence.</p>
              <p>Then they teach. Knowing a subject and being able to teach it are different abilities, and we require both.</p>
            </div>
          </div>
        </section>

        <section className="border-t border-ink/10 py-20">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHead eyebrow="Faculty members" title="Members of our faculty." />
            <div className="mt-10"><FacultyList /></div>
          </div>
        </section>

        <section className="border-t border-ink/10 bg-paper/60 py-16">
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
