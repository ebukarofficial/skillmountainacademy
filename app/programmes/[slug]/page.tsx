import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BUSINESS, MESSAGE, PROGRAMMES, SITE_URL, duration, type Programme } from "@/lib/config";
import { learnList } from "@/lib/curricula";
import { FOCUS, PHOTO } from "@/lib/photos";
import { CloudBadges } from "../../components";
import { HoldPrice } from "../../hold";
import { CareerLaunch, CurriculumActions, MessageStrip, SiteFooter, SiteHeader, TrustLines } from "../../site-parts";

type Params = { params: Promise<{ slug: string }> };

export const dynamicParams = false;
export function generateStaticParams() {
  return PROGRAMMES.map((p) => ({ slug: p.slug }));
}

const find = (slug: string) => PROGRAMMES.find((p) => p.slug === slug);
const describe = (p: Programme) => `${p.name}: ${MESSAGE.headline} ${p.blurb} ${duration(p)}. Online from Skill Mountain Academy, Abuja, Nigeria.`;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const p = find((await params).slug);
  if (!p) return {};
  const url = `/programmes/${p.slug}/`;
  return {
    title: `${p.name} | ${MESSAGE.headline.replace(/\.$/, "")} | Skill Mountain Academy`,
    description: describe(p),
    alternates: { canonical: url },
    openGraph: { title: `${p.name} at Skill Mountain Academy`, description: describe(p), url, type: "website", images: [{ url: "/og-share.jpg", width: 1200, height: 848, alt: "Skill Mountain Academy: One-on-One Skill Academy" }] },
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
    offers: { "@type": "Offer", category: "Paid", price: p.price, priceCurrency: "NGN", availability: "https://schema.org/InStock", url: `${SITE_URL}/checkout/?p=${p.slug}` },
    hasCourseInstance: { "@type": "CourseInstance", courseMode: "Online", courseWorkload: `P${p.trainingMonths}M`, instructor: { "@type": "Organization", name: BUSINESS.name } },
  };
}

export default async function ProgrammePage({ params }: Params) {
  const p = find((await params).slug);
  if (!p) notFound();
  const reg = `/checkout/?p=${p.slug}`;
  return (
    <>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(courseJsonLd(p)).replace(/</g, "\\u003c") }} />
        <MessageStrip />

        <section className="mx-auto grid max-w-6xl items-start gap-8 px-5 pb-12 pt-8 lg:grid-cols-[1.1fr_.9fr] lg:pt-12">
          <div>
            <nav aria-label="Breadcrumb" className="text-sm text-ink/70"><Link href="/#programmes" className="underline hover:text-brand-red">Programmes</Link> <span aria-hidden="true">/</span> {p.name}</nav>
            <h1 className="mt-3 font-display text-4xl font-extrabold leading-tight sm:text-5xl"><span className="brand-text">{p.name}</span></h1>
            {p.track === "cloud" && <CloudBadges className="mt-3" />}
            <p className="mt-3 font-medium">{p.level} · {duration(p)}</p>
            <p className="mt-3 max-w-xl text-lg text-ink/75">{p.blurb}</p>
            <div className="mt-6 rounded-[1.75rem] bg-paper p-5 sm:p-6">
              <HoldPrice p={p} />
              <p className="mt-1 text-sm text-ink/70">Pay in full, or in 3 parts (50%, 30%, 20%).</p>
              <Link href={reg} className="brand-bg mt-4 block rounded-full py-4 text-center font-display text-lg font-semibold text-white transition hover:brightness-110">Register for {p.name}</Link>
              <div className="mt-4"><CurriculumActions p={p} /></div>
              <div className="mt-5 border-t border-ink/10 pt-4"><TrustLines /></div>
            </div>
          </div>
          <div className={`relative h-80 overflow-hidden rounded-[2rem] bg-gradient-to-br sm:h-[28rem] ${p.tone}`}>
            <Image src={PHOTO[p.slug]} alt={`A learner studying ${p.name} online`} fill priority sizes="(max-width: 1024px) 90vw, 40vw" className="object-cover" style={{ objectPosition: FOCUS[p.slug] }} />
          </div>
        </section>

        <section aria-labelledby="learn" className="mx-auto max-w-6xl px-5 pb-12">
          <h2 id="learn" className="font-display text-3xl font-extrabold">What you&apos;ll learn</h2>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2">
            {learnList(p).map((l, i) => (
              <li key={l} className="flex gap-3 rounded-2xl bg-paper px-4 py-3">
                <span className="brand-bg grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold text-white">{i + 1}</span><span>{l}</span>
              </li>
            ))}
          </ol>
        </section>

        <div className="mx-auto max-w-6xl px-5 pb-12"><CareerLaunch p={p} /></div>

        <section className="mx-auto max-w-3xl px-5 pb-16 text-center">
          <h2 className="font-display text-3xl font-extrabold"><span className="brand-text">Ready to start?</span></h2>
          <p className="mt-2 text-ink/75">{MESSAGE.short} Choose your class days and times after you register.</p>
          <Link href={reg} className="brand-bg mt-6 inline-block rounded-full px-10 py-4 font-display text-lg font-semibold text-white transition hover:brightness-110">Register for {p.name}</Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
