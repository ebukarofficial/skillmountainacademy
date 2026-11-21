import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BUSINESS, MESSAGE, PROGRAMMES, SITE_URL, duration, type Programme } from "@/lib/config";
import { learnList } from "@/lib/curricula";
import { programmeCopy } from "@/lib/programme-content";
import { FOCUS, PHOTO } from "@/lib/photos";
import { CloudBadges, PANEL_BG } from "../../components";
import { HoldPrice } from "../../hold";
import { CountrySelect } from "../../currency";
import { AdmissionBadge } from "../../admissions-status";
import { Arrow, SERIF, btnPrimary } from "../../brand";
import { FacultyList } from "../../faculty/faculty-list";
import { CareerLaunch, CurriculumActions, MessageStrip, SiteFooter, SiteHeader, TrustLines } from "../../site-parts";
import { EnrolSection } from "./enrol";

type Params = { params: Promise<{ slug: string }> };

export const dynamicParams = false;
export function generateStaticParams() {
  return PROGRAMMES.map((p) => ({ slug: p.slug }));
}

const find = (slug: string) => PROGRAMMES.find((p) => p.slug === slug);
const describe = (p: Programme) => `${p.name} at Skill Mountain Academy. ${programmeCopy(p.slug).discipline} ${p.blurb} ${duration(p)}, one-on-one with an assigned instructor, online.`;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const p = find((await params).slug);
  if (!p) return {};
  const url = `/programmes/${p.slug}/`;
  return {
    title: `${p.name} | ${MESSAGE.headline.replace(/\.$/, "")} | Skill Mountain Academy`,
    description: describe(p),
    alternates: { canonical: url },
    openGraph: { title: `${p.name} at Skill Mountain Academy`, description: describe(p), url, type: "website", images: [{ url: "/og-share.jpg", width: 1200, height: 848, alt: "Skill Mountain Academy: For those made for more" }] },
  };
}

// schema.org Course: https://developers.google.com/search/docs/appearance/structured-data/course-info
function courseJsonLd(p: Programme) {
  return {
    "@context": "https://schema.org",
    "@type": "Course",
    name: p.name,
    description: p.blurb,
    url: `${SITE_URL}/programmes/${p.slug}/`,
    inLanguage: "en",
    educationalLevel: p.level,
    teaches: learnList(p),
    provider: { "@type": "Organization", name: BUSINESS.name, sameAs: SITE_URL },
    offers: { "@type": "Offer", category: "Paid", price: p.price, priceCurrency: "NGN", url: `${SITE_URL}/programmes/${p.slug}/#enrol` },
    hasCourseInstance: { "@type": "CourseInstance", courseMode: "Online", courseWorkload: `P${p.trainingMonths}M`, instructor: { "@type": "Organization", name: BUSINESS.name } },
  };
}

function Section({ id, title, children }: { id: string; n?: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-t border-ink/10 py-14">
      <h2 id={`${id}-h`} className={`${SERIF} text-3xl leading-tight`}>{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

const Lines = ({ items }: { items: string[] }) => <ul className="grid gap-x-8 sm:grid-cols-2">{items.map((t) => <li key={t} className="border-t border-ink/10 py-3.5 text-ink/80">{t}</li>)}</ul>;

export default async function ProgrammePage({ params }: Params) {
  const p = find((await params).slug);
  if (!p) notFound();
  const copy = programmeCopy(p.slug);
  const facts: [string, string][] = [
    ["Duration", `${duration(p)}.`],
    ["Format", "Live instruction."],
    ["Instruction", "One-on-one live session with an assigned instructor."],
    ["Level", `${p.level}.`],
    ["Live session", "45–60 minutes each week."],
    ["Independent study", "10–20 hours per week."],
  ];
  return (
    <>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(courseJsonLd(p)).replace(/</g, "\\u003c") }} />
        <MessageStrip />

        {/* Introduction */}
        <section className="border-b border-ink/10">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-10 lg:grid-cols-[1.1fr_.9fr] lg:pt-14">
            <div>
              <nav aria-label="Breadcrumb" className="text-sm text-ink/60"><Link href="/programmes/" className="hover:text-brand-red">Programmes</Link> <span aria-hidden="true">/</span> {p.name}</nav>
              <h1 className={`${SERIF} mt-6 text-4xl leading-[1.1] sm:text-[2.75rem]`}>{p.name}</h1>
              {p.track === "cloud" && <CloudBadges className="mt-4" />}
              <p className="mt-5 font-display text-lg font-medium text-ink">{copy.discipline}</p>
              <p className="mt-3 max-w-xl text-lg leading-relaxed text-ink/70">{p.blurb}</p>
              <div className="mt-5"><AdmissionBadge slug={p.slug} /></div>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <a href="#enrol" className={btnPrimary}>Apply for Admission <Arrow /></a>
                <CurriculumActions p={p} />
              </div>
            </div>
            <div className={`relative h-80 overflow-hidden rounded-lg bg-gradient-to-br sm:h-[30rem] ${p.tone}`}>
              <Image src={PHOTO[p.slug]} alt={`A learner studying ${p.name} online`} fill priority sizes="(max-width: 1024px) 90vw, 40vw" className="object-cover" style={{ objectPosition: FOCUS[p.slug] }} />
            </div>
          </div>
          <dl className="mx-auto grid max-w-6xl gap-x-8 border-t border-ink/10 px-5 sm:grid-cols-2 lg:grid-cols-3">
            {facts.map(([k, v]) => (
              <div key={k} className="border-b border-ink/10 py-5 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:[&:nth-last-child(-n+3)]:border-b-0">
                <dt className="font-display text-sm font-semibold text-ink/70">{k}</dt>
                <dd className="mt-1 text-ink/90">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="mx-auto grid max-w-6xl gap-12 px-5 lg:grid-cols-[1fr_22rem]">
          <div>
            <Section id="overview" title="Programme introduction">
              <div className="max-w-2xl space-y-4 text-lg leading-relaxed text-ink/75">{copy.intro.map((t) => <p key={t}>{t}</p>)}</div>
              <h3 className="mt-8 font-display text-base font-semibold">Where it is practised</h3>
              <div className="mt-2"><Lines items={copy.opportunities} /></div>
            </Section>

            <Section id="outcomes" title="Learning outcomes">
              <p className="text-lg text-ink/75">By the end of the programme you will be able to:</p>
              <ol className="mt-3">
                {copy.mastery.map((t, i) => <li key={t} className="flex gap-4 border-t border-ink/10 py-4"><span className="w-7 shrink-0 font-display text-lg font-semibold text-brand-red">{i + 1}.</span><span className="text-lg text-ink/85">{t}</span></li>)}
              </ol>
            </Section>

            <Section id="suited" title="Intended audience">
              <p className="max-w-2xl text-lg leading-relaxed text-ink/75">{p.audience ?? copy.suitedTo}</p>
              <dl className="mt-6 grid gap-x-8 sm:grid-cols-2">
                <div className="border-t border-ink/10 py-4"><dt className="font-display font-semibold">Level</dt><dd className="mt-1 text-ink/75">{p.level}</dd></div>
                <div className="border-t border-ink/10 py-4"><dt className="font-display font-semibold">What you need</dt><dd className="mt-1 text-ink/75">A laptop or desktop computer and a reliable internet connection for live sessions. Your instructor confirms any software or accounts before your first session.</dd></div>
              </dl>
            </Section>

            <Section id="curriculum" title="Curriculum">
              <ol>
                {learnList(p).map((l, i) => <li key={l} className="flex gap-5 border-t border-ink/10 py-3"><span className="w-6 shrink-0 font-display font-semibold text-ink/65">{i + 1}</span><span className="text-ink/85">{l}</span></li>)}
              </ol>
              <div className="mt-6"><CurriculumActions p={p} /></div>
            </Section>

            <Section id="structure" title="Weekly commitment">
              <p className="max-w-2xl text-lg leading-relaxed text-ink/75">Over {duration(p)}, each week combines one 45–60 minute live session with your instructor and 10–20 hours of independent study. The study time is spread across the week to suit you; it is not one continuous sitting.</p>
              <h3 className="mt-8 font-display text-base font-semibold">Independent study includes</h3>
              <ul className="mt-2 grid gap-x-8 sm:grid-cols-2">
                {["Weekly assignments and classwork", "Practical tasks and projects", "Quizzes and revision", "Video lessons and reading", "Revision with the learning assistant", "Reviewing previous sessions", "Preparing questions for your instructor", "Other activities your instructor sets"].map((t) => <li key={t} className="border-t border-ink/10 py-3 text-ink/80">{t}</li>)}
              </ul>
              <p className="mt-5 text-ink/75">Your dashboard shows each week&apos;s checklist and records what you complete. Students who meet the programme&apos;s requirements receive a Skill Mountain Academy certificate.</p>
            </Section>

            <Section id="practical" title="Practical work">
              <p className="max-w-2xl text-lg leading-relaxed text-ink/75">Throughout the programme you produce finished work, reviewed by your instructor. By the end you should be able to show:</p>
              <div className="mt-4"><Lines items={copy.outcomes} /></div>
            </Section>

            <Section id="internship" title="Internship">
              <p className="max-w-2xl text-lg leading-relaxed text-ink/75">After the training comes a {p.internshipMonths}-month practical phase on structured projects, reviewed by your instructor.</p>
              <div className="mt-8"><CareerLaunch p={p} /></div>
            </Section>

            <Section id="faculty" title="Faculty">
              <FacultyList programme={p.slug} />
            </Section>
          </div>

          {/* Investment and enrolment: sticky on desktop, in the flow of the page on mobile */}
          <aside aria-labelledby="investment" className="lg:py-14">
            <div className={`rounded-lg border border-ink/10 ${PANEL_BG} p-6 lg:sticky lg:top-24`}>
              <p id="investment" className="font-display text-sm font-semibold text-brand-red">Programme investment</p>
              <p className={`${SERIF} mt-2 text-2xl leading-tight`}>{p.name}</p>
              <div className="mt-4"><HoldPrice p={p} /></div>
              <p className="mt-2 text-sm text-ink/65">{p.fullPaymentOnly ? "Paid in full at admission." : "Pay in full, or in 3 parts (50%, 30%, 20%)."}</p>
              <div className="mt-5"><CountrySelect compact /></div>
              <p className="mt-2 text-sm text-ink/70">The amount above updates to the currency of the country you select.</p>
              <a href="#enrol" className={`${btnPrimary} mt-6 w-full`}>Apply for Admission</a>
              <div className="mt-6 border-t border-ink/10 pt-5"><TrustLines fullPaymentOnly={!!p.fullPaymentOnly} /></div>
            </div>
          </aside>
        </div>

        <section id="enrol" aria-labelledby="enrol-h" className="scroll-mt-20 border-t border-ink/10 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-5">
            <h2 id="enrol-h" className={`${SERIF} text-3xl leading-tight`}>Admission and investment</h2>
            <p className="mt-3 text-ink/75">Complete the admission form and pay here. Your place is confirmed once your payment is verified; your registration number and access email follow.</p>
            <div className="mt-8"><EnrolSection p={p} /></div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
