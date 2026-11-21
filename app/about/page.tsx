import type { Metadata } from "next";
import Link from "next/link";
import { BRAND, STANDARDS } from "@/lib/institution";
import { Arrow, Eyebrow, NumberedList, PageHero, SERIF, SectionHead, btnLight, btnOutlineLight } from "../brand";
import { SiteFooter, SiteHeader } from "../site-parts";

export const metadata: Metadata = {
  title: "About | Skill Mountain Academy",
  description: "Why Skill Mountain Academy exists, how it teaches and the standards it holds itself to: human expertise, one-on-one instruction, intelligent learning support and practical application.",
  alternates: { canonical: "/about/" },
};

function Block({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-6 border-t border-ink/10 py-14 lg:grid-cols-[.75fr_1.25fr] lg:gap-16 lg:py-20">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 id={id} className={`${SERIF} mt-3 text-4xl leading-tight`}>{title}</h2>
      </div>
      <div className="space-y-5 text-lg leading-relaxed text-ink/75">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        <PageHero eyebrow="About Skill Mountain Academy" title={<>{BRAND.line.replace(/\.$/, "")}<span className="text-brand-red">.</span></>}
          lede="An institution for advanced digital skills, built on a simple conviction: that serious professional learning still depends on serious human instruction." />

        <div className="mx-auto max-w-6xl px-5">
          <Block id="story" eyebrow="Our story" title="Why the Academy exists.">
            <p>Online education made information abundant. It did not make competence common. Many learners finish courses with certificates and little they can actually do, because no one ever watched them work, corrected them or held them to a standard.</p>
            <p>Skill Mountain Academy was founded to close that gap. We teach one student at a time, through an instructor assigned to them, and we measure progress by the work students can produce and explain.</p>
          </Block>

          <Block id="philosophy" eyebrow="Our philosophy" title="Competence, not certificates.">
            <p>A certificate should record an ability, not attendance. Our programmes are designed backwards from what a student should be able to do at the end, and every stage is tested by practical work that an instructor reviews.</p>
            <p>That is why our programmes end with an intensive practical phase rather than a final lecture.</p>
          </Block>

          <Block id="vision" eyebrow="Our vision" title="A globally respected institution.">
            <p>To become a globally respected institution for advanced digital skills education, human expertise and practical professional development.</p>
          </Block>

          <Block id="mission" eyebrow="Our mission" title="Exceptional knowledge, made accessible.">
            <p>To make exceptional professional knowledge accessible through rigorous instruction, personalised mentorship, intelligent learning support and practical application.</p>
          </Block>

          <Block id="education" eyebrow="Our educational philosophy" title="Human expertise, supported by intelligent tools.">
            <p>The instructor teaches and judges. Technology supports practice and revision between sessions. Assessment and a period of practical application confirm what has been learned.</p>
            <p>How this works week by week is set out on <Link href="/learning-experience/" className="font-semibold text-indigo underline">The Learning Experience</Link>.</p>
          </Block>

          <Block id="different" eyebrow="Why we are different" title="Instruction, not consumption.">
            <p>Most online learning asks the student to consume: watch, read, click through. Students are left to discover their own mistakes, if they discover them at all.</p>
            <p>At Skill Mountain Academy the student is taught. An instructor who knows the discipline demonstrates it, watches the student attempt it, corrects them in the moment and assesses what they produce. The pace adapts to the student, not to a cohort, and nothing important is skipped.</p>
          </Block>

          <section aria-labelledby="standards" className="border-t border-ink/10 py-14 lg:py-20">
            <SectionHead eyebrow="Our standards" title="What we hold ourselves to." />
            <div className="mt-10"><NumberedList items={STANDARDS} /></div>
          </section>

          <Block id="future" eyebrow="Our future" title="Growth without compromise.">
            <p>Our ambition is long-term: a substantial international network of verified instructors teaching students and professionals worldwide. We will grow only as fast as we can find instructors who meet our standards, because the quality of instruction is the institution.</p>
            <p>We are not accredited by a government body or ranked by any league table, and we do not claim to be. Our certificate is a Skill Mountain Academy certificate. Our reputation will rest on the work our students can do.</p>
          </Block>
        </div>

        <section className="bg-indigo py-20 text-white">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-5 md:flex-row md:items-end">
            <SectionHead light eyebrow="Begin" title="Explore our programmes." lede="Read about each discipline, the learning experience and the curriculum before you decide." />
            <div className="flex flex-wrap gap-3">
              <Link href="/programmes/" className={btnLight}>Programmes <Arrow /></Link>
              <Link href="/faculty/" className={btnOutlineLight}>Our Faculty</Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
