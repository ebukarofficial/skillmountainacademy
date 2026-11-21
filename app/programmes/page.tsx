import type { Metadata } from "next";
import Link from "next/link";
import { PROGRAMMES, PROGRAMME_COUNT, duration } from "@/lib/config";
import { CloudBadges } from "../components";
import { Arrow, PageHero, SERIF, btnOutline } from "../brand";
import { Catalogue } from "./catalogue";
import { SiteFooter, SiteHeader } from "../site-parts";

export const metadata: Metadata = {
  title: "Programmes | Skill Mountain Academy",
  description: "Programmes in design, web development, digital marketing, cybersecurity, cloud and DevOps, taught one-on-one by an assigned instructor, with assessment and an intensive practical phase.",
  alternates: { canonical: "/programmes/" },
};

export default function ProgrammesPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        <PageHero title="Programmes"
          lede={`${PROGRAMME_COUNT[0].toUpperCase()}${PROGRAMME_COUNT.slice(1)} programmes in design, engineering, security, cloud, marketing and AI automation. Filter by discipline or search, then open a programme for its curriculum, duration, internship and investment.`} />
        <Catalogue />
        <section aria-labelledby="cloud-track" className="mx-auto max-w-6xl px-5 py-14">
          <div className="rounded-xl border border-ink/10 bg-white p-6 sm:p-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="cloud-track" className={`${SERIF} text-3xl sm:text-4xl`}>Choosing within the Cloud track</h2>
                <p className="mt-2 max-w-2xl text-ink/70">All three teach both AWS and Azure. Choose by where you are today.</p>
              </div>
              <CloudBadges />
            </div>
            <div className="mt-8 grid md:grid-cols-3">
              {PROGRAMMES.filter((p) => p.track === "cloud").map((p, i) => (
                <div key={p.slug} className={`flex flex-col py-6 md:px-6 ${i ? "border-t border-ink/10 md:border-l md:border-t-0" : "md:pl-0"}`}>
                  <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                  <dl className="mt-4 flex-1 space-y-3 text-sm">
                    <div><dt className="font-semibold">Level</dt><dd className="text-ink/70">{p.level}</dd></div>
                    <div><dt className="font-semibold">Suited to</dt><dd className="text-ink/70">{p.audience}</dd></div>
                    <div><dt className="font-semibold">Duration</dt><dd className="text-ink/70">{duration(p)}</dd></div>
                  </dl>
                  <Link href={`/programmes/${p.slug}/`} className="mt-5 inline-flex items-center gap-2 font-display text-sm font-semibold text-indigo">Explore Programme <Arrow /></Link>
                </div>
              ))}
            </div>
          </div>
        </section>
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
