import type { Metadata } from "next";
import Link from "next/link";
import { BANK, BUSINESS, PAY_PLAN } from "@/lib/config";
import { Arrow, PageHero, SERIF, btnOutline, btnPrimary } from "../brand";
import { BookCallButton } from "../book-call";
import { SiteFooter, SiteHeader } from "../site-parts";
import { StatusTable } from "./status-table";

export const metadata: Metadata = {
  title: "Admissions | Skill Mountain Academy",
  description: "How admission to Skill Mountain Academy works: admission periods, controlled enrolment matched to instructor availability, enrolment and payment, and what happens after you enrol.",
  alternates: { canonical: "/admissions/" },
};

const STEPS: [string, string][] = [
  ["Admission availability", "Each programme admits students in periods, and only while a verified instructor is available to teach them. The current status is shown above and on each programme page."],
  ["Requirements", "Most programmes begin at beginner level; each programme page states its level and who it suits. You need a computer and a reliable internet connection. Learners under 18 apply with a parent or guardian."],
  ["Choosing a programme", "Read the programme page: the discipline, curriculum, duration, weekly commitment, internship and investment. Admissions can advise if you are unsure."],
  ["Application", "Complete the admission form on the programme page. It asks for your details, country of residence and learning background."],
  ["Payment", "Pay on the same page, online with Paystack or by bank transfer. The fee is shown in the currency of your country of residence and charged in naira."],
  ["Confirmation", "Once your payment is verified, you receive your registration number and admission confirmation by email."],
  ["Onboarding", "A separate email gives you access to your learning space, where your programme, materials and weekly checklist are waiting."],
  ["Instructor allocation", "The Academy assigns your instructor and confirms your fixed weekly session time."],
  ["First session", "You join your first live session from your learning space, and your programme begins."],
];

export default function AdmissionsPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        <PageHero title="Admissions"
          lede="Admission to each programme is managed in periods and matched to the instructors available to teach it, so that every student is taught from their first week." />

        <section aria-labelledby="status" className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
            <div>
              <h2 id="status" className={`${SERIF} text-3xl leading-tight sm:text-4xl`}>Admission status</h2>
              <p className="mt-4 text-ink/70">Updated by the Admissions office. A programme whose intake is complete stays listed and reopens in a later admission period.</p>
            </div>
            <StatusTable />
          </div>
        </section>

        <section aria-labelledby="how" className="border-y border-ink/10 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-5">
            <h2 id="how" className={`${SERIF} text-3xl leading-tight sm:text-4xl`}>How admission works</h2>
            <ol className="mt-8 grid gap-x-10 md:grid-cols-2 lg:grid-cols-3">
              {STEPS.map(([t, d], i) => (
                <li key={t} className="border-t border-ink/10 py-5">
                  <p className="font-display text-lg font-semibold"><span className="mr-2 text-ink/45">{i + 1}.</span>{t}</p>
                  <p className="mt-1.5 leading-relaxed text-ink/75">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="fees" className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
            <h2 id="fees" className={`${SERIF} text-3xl leading-tight sm:text-4xl`}>Fees and payment</h2>
            <div className="space-y-4 text-lg leading-relaxed text-ink/75">
              <p>Each programme&apos;s fee is stated on its programme page. Most programmes can be paid in full or in three parts ({PAY_PLAN.split.join("%, ")}%); AI Automation is paid in full.</p>
              <p>Payments are made online with Paystack or by bank transfer to {BANK.bank}, and are verified with the payment provider before admission is confirmed. See the <Link href="/terms/" className="font-semibold text-indigo underline">Terms</Link> and <Link href="/refunds/" className="font-semibold text-indigo underline">Refund Policy</Link>.</p>
            </div>
          </div>
        </section>

        <section className="border-t border-ink/10 bg-white py-16">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 sm:flex-row sm:items-center">
            <div>
              <p className={`${SERIF} text-3xl`}>Speak with Admissions.</p>
              <p className="mt-2 text-ink/70">Email <a href={`mailto:${BUSINESS.email}`} className="font-semibold text-indigo underline">{BUSINESS.email}</a>, or request a call at a time that suits you.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/programmes/" className={btnPrimary}>Explore programmes <Arrow /></Link>
              <BookCallButton className={btnOutline} />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
