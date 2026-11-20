import type { Metadata } from "next";
import Link from "next/link";
import { BANK, BUSINESS, PAY_PLAN } from "@/lib/config";
import { JOURNEY } from "@/lib/institution";
import { Arrow, Eyebrow, NumberedList, PageHero, SERIF, SectionHead, btnOutline, btnPrimary } from "../brand";
import { SiteFooter, SiteHeader } from "../site-parts";
import { StatusTable } from "./status-table";

export const metadata: Metadata = {
  title: "Admissions | Skill Mountain Academy",
  description: "How admission to Skill Mountain Academy works: admission periods, controlled enrolment matched to instructor availability, enrolment and payment, and what happens after you enrol.",
  alternates: { canonical: "/admissions/" },
};

export default function AdmissionsPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        <PageHero eyebrow="Admissions" title="Admission is meaningful here."
          lede="Admissions are managed in periods, and enrolment on each programme is matched to the number of verified instructors available to teach it. That is how every student receives an instructor's full attention." />

        <section className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
            <div>
              <SectionHead eyebrow="Current status" title="Admissions by programme." />
              <p className="mt-5 text-ink/65">Status is updated by the Admissions office. When a programme&apos;s intake is complete it remains listed, and opens again in a later admission period.</p>
            </div>
            <StatusTable />
          </div>
        </section>

        <section className="border-y border-ink/10 bg-paper/60 py-20">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHead eyebrow="The path to enrolment" title="From first visit to first session." />
            <div className="mt-10"><NumberedList items={JOURNEY} /></div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-12 lg:grid-cols-3">
            <div>
              <Eyebrow>Controlled enrolment</Eyebrow>
              <h2 className={`${SERIF} mt-3 text-3xl leading-tight`}>Matched to instruction.</h2>
              <p className="mt-4 leading-relaxed text-ink/70">Every instructor teaches a limited number of students. We accept enrolments only while a verified instructor is available to teach them, so no student waits for attention.</p>
            </div>
            <div>
              <Eyebrow>Requirements</Eyebrow>
              <h2 className={`${SERIF} mt-3 text-3xl leading-tight`}>What we ask of applicants.</h2>
              <p className="mt-4 leading-relaxed text-ink/70">Programmes run from beginner to advanced unless a programme page says otherwise. We ask about your background and goals so your instructor can plan from your first session. Learners under 18 enrol with a parent or guardian.</p>
            </div>
            <div>
              <Eyebrow>Fees and payment</Eyebrow>
              <h2 className={`${SERIF} mt-3 text-3xl leading-tight`}>Transparent terms.</h2>
              <p className="mt-4 leading-relaxed text-ink/70">Each programme&apos;s fee is shown on its programme page. Pay in full, or in three parts ({PAY_PLAN.split.join("%, ")}%), by Paystack or by bank transfer to {BANK.bank}. Payments are verified by our server before anything is activated.</p>
            </div>
          </div>
        </section>

        <section className="bg-indigo py-20 text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 lg:grid-cols-2">
            <SectionHead light eyebrow="After you enrol" title="What happens next." />
            <ol className="text-white/80">
              {["Your payment is confirmed with the payment provider.", "Your student account is created and a secure, single-use sign-in link is emailed to you. There is no password to create.", "An instructor is assigned and your fixed weekly session time is confirmed.", "Your first session's Google Meet link appears in your dashboard, with reminders before it begins."].map((t, i) => (
                <li key={t} className="flex gap-4 border-t border-white/15 py-4"><span className={`${SERIF} text-xl text-brand-orange`}>{String(i + 1).padStart(2, "0")}</span>{t}</li>
              ))}
            </ol>
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 sm:flex-row sm:items-center">
            <div>
              <p className={`${SERIF} text-3xl`}>Speak with Admissions.</p>
              <p className="mt-2 text-ink/70">Email <a href={`mailto:${BUSINESS.email}`} className="font-semibold text-indigo underline">{BUSINESS.email}</a> or call {BUSINESS.phone}.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/programmes/" className={btnPrimary}>Explore programmes <Arrow /></Link>
              <Link href="/#book" className={btnOutline}>Book a call</Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
