import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BUSINESS, MESSAGE, PROGRAMMES, SITE_URL, duration, type Programme } from "@/lib/config";
import { learnList } from "@/lib/curricula";
import { programmeCopy } from "@/lib/programme-content";
import { FOCUS, PHOTO } from "@/lib/photos";
import { CloudBadges } from "../../components";
import { HoldPrice } from "../../hold";
import { Approx, CountrySelect } from "../../currency";
import { AdmissionBadge } from "../../admissions-status";
import { Arrow, Eyebrow, SERIF, btnPrimary } from "../../brand";
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

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-t border-ink/10 py-14">
      <p className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-brand-red">{String(n).padStart(2, "0")}</p>
      <h2 id={`${id}-h`} className={`${SERIF} mt-2 text-4xl leading-tight`}>{title}</h2>
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
    ["Duration", duration(p)],
    ["Format", "One-on-one, live online"],
    ["Level", p.level],
    ["Weekly session", "45 to 60 minutes"],
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
              <Eyebrow className="mt-6">{p.tag} · {p.level}</Eyebrow>
              <h1 className={`${SERIF} mt-3 text-5xl leading-[1.04] sm:text-[3.4rem]`}>{p.name}</h1>
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
          <dl className="mx-auto grid max-w-6xl grid-cols-2 border-t border-ink/10 px-5 lg:grid-cols-4">
            {facts.map(([k, v], i) => (
              <div key={k} className={`py-6 pr-4 ${i % 2 ? "pl-4 sm:pl-6" : ""} ${i ? "lg:border-l lg:border-ink/10 lg:pl-6" : ""}`}>
                <dt className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-ink/55">{k}</dt>
                <dd className="mt-1.5 text-ink/85">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="mx-auto grid max-w-6xl gap-12 px-5 lg:grid-cols-[1fr_22rem]">
          <div>
            <Section id="overview" n={1} title="The discipline">
              <div className="max-w-2xl space-y-4 text-lg leading-relaxed text-ink/75">{copy.intro.map((t) => <p key={t}>{t}</p>)}</div>
              <h3 className="mt-8 font-display text-sm font-semibold">Where it is practised</h3>
              <div className="mt-2"><Lines items={copy.opportunities} /></div>
            </Section>

            <Section id="suited" n={2} title="Who it suits">
              <p className="max-w-2xl text-lg leading-relaxed text-ink/75">{p.audience ?? copy.suitedTo}</p>
              <dl className="mt-6 grid gap-x-8 sm:grid-cols-2">
                <div className="border-t border-ink/10 py-4"><dt className="font-display text-sm font-semibold">Level</dt><dd className="mt-1 text-ink/70">{p.level}</dd></div>
                <div className="border-t border-ink/10 py-4"><dt className="font-display text-sm font-semibold">What you need</dt><dd className="mt-1 text-ink/70">A laptop or desktop computer and a reliable internet connection for live sessions. Your instructor confirms any software or accounts before your first session.</dd></div>
              </dl>
            </Section>

            <Section id="outcomes" n={3} title="What you will be able to do">
              <ol>
                {copy.mastery.map((t, i) => <li key={t} className="flex gap-5 border-t border-ink/10 py-4"><span className={`${SERIF} w-7 shrink-0 text-xl text-brand-red`}>{String(i + 1).padStart(2, "0")}</span><span className="text-lg text-ink/85">{t}</span></li>)}
              </ol>
              <h3 className="mt-8 font-display text-sm font-semibold">By the end you should be able to show</h3>
              <div className="mt-2"><Lines items={copy.outcomes} /></div>
            </Section>

            <Section id="curriculum" n={4} title="Curriculum">
              <ol>
                {learnList(p).map((l, i) => <li key={l} className="flex gap-5 border-t border-ink/10 py-3"><span className="w-6 shrink-0 font-display text-sm font-semibold text-ink/45">{i + 1}</span><span className="text-ink/85">{l}</span></li>)}
              </ol>
              <div className="mt-6"><CurriculumActions p={p} /></div>
            </Section>

            <Section id="structure" n={5} title="Programme structure">
              <dl className="grid gap-x-8 sm:grid-cols-2">
                {([
                  ["Duration", `${duration(p)}.`],
                  ["Sessions", "One fixed weekly session of 45 to 60 minutes, live and one-on-one on Google Meet."],
                  ["Coursework", "Weekly assignments, quizzes and instructor-marked assessments, with written feedback."],
                  ["Internship", `A ${p.internshipMonths}-month practical phase after the training, on structured projects reviewed by your instructor.`],
                  ["Completion", "Judged on your coursework, assessments and practical work. Students who meet the requirements receive a Skill Mountain Academy certificate."],
                  ["How learning works", "The weekly rhythm, the live workspace and the learning assistant are described on The Learning Experience."],
                ] as [string, string][]).map(([k, v]) => <div key={k} className="border-t border-ink/10 py-4"><dt className="font-display text-sm font-semibold">{k}</dt><dd className="mt-1 text-ink/70">{k === "How learning works" ? <>{v.replace(" on The Learning Experience.", " ")}<Link href="/learning-experience/" className="font-semibold text-indigo underline">on The Learning Experience</Link>.</> : v}</dd></div>)}
              </dl>
              <div className="mt-10"><CareerLaunch p={p} /></div>
            </Section>

            <Section id="faculty" n={6} title="Faculty">
              <FacultyList programme={p.slug} />
            </Section>
          </div>

          {/* Investment and enrolment: sticky on desktop, in the flow of the page on mobile */}
          <aside aria-labelledby="investment" className="lg:py-14">
            <div className="rounded-lg border border-ink/10 bg-paper p-6 lg:sticky lg:top-24">
              <p id="investment" className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-brand-red">Investment</p>
              <p className={`${SERIF} mt-2 text-2xl leading-tight`}>{p.name}</p>
              <div className="mt-4"><HoldPrice p={p} /></div>
              <Approx naira={p.price} className="mt-1 block text-sm text-ink/60" />
              <p className="mt-2 text-sm text-ink/65">Pay in full, or in 3 parts (50%, 30%, 20%).</p>
              <div className="mt-5"><CountrySelect compact /></div>
              <p className="mt-2 text-xs text-ink/55">Your country sets the currency used for guide amounts. Payment is processed in naira.</p>
              <a href="#enrol" className={`${btnPrimary} mt-6 w-full`}>Apply for Admission</a>
              <div className="mt-6 border-t border-ink/10 pt-5"><TrustLines /></div>
            </div>
          </aside>
        </div>

        <section id="enrol" aria-labelledby="enrol-h" className="scroll-mt-20 border-t border-ink/10 bg-paper/60 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-5">
            <p className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-brand-red">07</p>
            <h2 id="enrol-h" className={`${SERIF} mt-2 text-4xl leading-tight`}>Admission and investment</h2>
            <p className="mt-3 text-ink/70">Apply for {p.name} here. Your place is confirmed once your payment is verified.</p>
            <div className="mt-8"><EnrolSection p={p} /></div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
