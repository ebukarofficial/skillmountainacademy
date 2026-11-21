import type { Metadata } from "next";
import Link from "next/link";
import { BRAND, STANDARDS } from "@/lib/institution";
import { Arrow, PageHero, SERIF, SectionHead, btnLight, btnOutlineLight } from "../brand";
import { SiteFooter, SiteHeader } from "../site-parts";

export const metadata: Metadata = {
  title: "About | Skill Mountain Academy",
  description: "Why Skill Mountain Academy exists, how it teaches and the standards it holds itself to: human expertise, one-on-one instruction, intelligent learning support and practical application.",
  alternates: { canonical: "/about/" },
};

function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-6 border-t border-ink/10 py-14 lg:grid-cols-[.75fr_1.25fr] lg:gap-16 lg:py-16">
      <h2 id={id} className={`${SERIF} text-3xl leading-tight sm:text-4xl`}>{title}</h2>
      <div className="space-y-5 text-lg leading-relaxed text-ink/75">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        <PageHero title={<>{BRAND.line.replace(/\.$/, "")}<span className="text-brand-red">.</span></>} lede={BRAND.positioning} />

        <div className="mx-auto max-w-6xl px-5">
          <Block id="story" title="Why the Academy exists.">
            <p>Online education made information abundant. It did not make competence common. Many learners complete courses without anyone having watched them work, corrected them or held them to a standard.</p>
            <p>Skill Mountain Academy was founded to close that gap: to teach professional disciplines through instructors who demonstrate the work, supervise its practice and assess what students produce.</p>
          </Block>

          <Block id="vision" title="A globally respected institution.">
            <p>Our vision is to become a globally respected institution for advanced digital skills education, human expertise and practical professional development.</p>
          </Block>

          <Block id="education" title="Human expertise, supported by intelligent tools.">
            <p>The instructor teaches, demonstrates and judges the quality of the work. Technology supports practice and revision between sessions. Assessment confirms understanding at each stage, and the internship confirms that it holds in practice.</p>
            <p>How this is organised week by week is set out on <Link href="/learning-experience/" className="font-semibold text-indigo underline">The Learning Experience</Link>.</p>
          </Block>

          <section aria-labelledby="standards" className="grid gap-6 border-t border-ink/10 py-14 lg:grid-cols-[.75fr_1.25fr] lg:gap-16 lg:py-16">
            <h2 id="standards" className={`${SERIF} text-3xl leading-tight sm:text-4xl`}>What we hold ourselves to.</h2>
            <dl className="divide-y divide-ink/10 border-y border-ink/10">
              {STANDARDS.map(([t, d]) => (
                <div key={t} className="py-4"><dt className="font-display text-lg font-semibold">{t}</dt><dd className="mt-1 text-lg leading-relaxed text-ink/75">{d}</dd></div>
              ))}
            </dl>
          </section>

          <Block id="future" title="Our future.">
            <p>Our ambition is long-term: an international faculty of verified instructors teaching students and professionals worldwide. We will grow only as fast as we can find instructors who meet our standards.</p>
            <p>We are not accredited by a government body or ranked by any league table, and we do not claim to be. Our certificate is a Skill Mountain Academy certificate, and our reputation will rest on the work our students can do.</p>
          </Block>
        </div>

        <section className="bg-indigo/90 py-16 text-white sm:py-20">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-5 md:flex-row md:items-end">
            <SectionHead light title="Explore our programmes." lede="Read about each discipline, its curriculum and the investment before you decide." />
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
