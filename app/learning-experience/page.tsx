import type { Metadata } from "next";
import Link from "next/link";
import { METHOD, MODEL } from "@/lib/institution";
import { Arrow, Eyebrow, NumberedList, PageHero, SERIF, SectionHead, btnLight, btnOutline } from "../brand";
import { SiteFooter, SiteHeader } from "../site-parts";

export const metadata: Metadata = {
  title: "The Learning Experience | Skill Mountain Academy",
  description: "How a Skill Mountain Academy programme works: an assigned instructor, a fixed weekly one-on-one live session, guided practice with screen sharing, assignments, assessment, an AI learning assistant and an intensive practical phase.",
  alternates: { canonical: "/learning-experience/" },
};

const WEEK: [string, string][] = [
  ["Before the session", "Your dashboard shows your next session, your assignments and any message from your instructor. The Google Meet link appears as soon as your instructor adds it, with reminders 24 hours, 1 hour and 15 minutes before."],
  ["In the session", "Forty-five minutes to an hour, live and one-on-one. Your instructor explains, demonstrates on screen, then watches you work on yours and corrects you as you go."],
  ["After the session", "Your instructor logs the session's outcome and sets the week's assignment. You submit it in your dashboard and receive a mark and written feedback."],
  ["Between sessions", "The learning assistant helps you revise, explains concepts again and points you to approved materials. It will not write graded work for you."],
];

export default function LearningExperiencePage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        <PageHero eyebrow="The Learning Experience" title="Taught, not merely shown."
          lede="Students at Skill Mountain Academy learn through a structured relationship with one instructor. Technology supports that relationship. It does not replace it." />

        <section className="mx-auto max-w-6xl px-5 py-20">
          <SectionHead eyebrow="The model" title="Eight elements of every programme." />
          <div className="mt-10"><NumberedList items={MODEL} /></div>
        </section>

        <section className="bg-indigo py-20 text-white">
          <div className="mx-auto max-w-6xl px-5">
            <SectionHead light eyebrow="A week of study" title="What a typical week looks like." />
            <div className="mt-10 grid gap-x-10 md:grid-cols-2">
              {WEEK.map(([t, d]) => (
                <div key={t} className="border-t border-white/15 py-6">
                  <p className={`${SERIF} text-2xl`}>{t}</p>
                  <p className="mt-2 leading-relaxed text-white/75">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
            <SectionHead eyebrow="Methodology" title="From instruction to demonstrated competence." lede="The same sequence runs through every discipline, adapted to its tools and its standards." />
            <NumberedList items={METHOD} cols={1} />
          </div>
        </section>

        <section className="border-y border-ink/10 bg-paper/60 py-20">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 lg:grid-cols-2">
            <div>
              <Eyebrow>The live workspace</Eyebrow>
              <h2 className={`${SERIF} mt-3 text-4xl leading-tight`}>Screen sharing, both ways.</h2>
              <p className="mt-5 text-lg leading-relaxed text-ink/70">Sessions run on Google Meet. Your instructor shares their screen to demonstrate professional tools and processes. When asked, you share yours, so your instructor can see exactly what you are doing, spot mistakes and guide you through them. For design, development and other practical disciplines, this is where most learning happens.</p>
            </div>
            <div>
              <Eyebrow>The AI learning assistant</Eyebrow>
              <h2 className={`${SERIF} mt-3 text-4xl leading-tight`}>A companion, not a substitute.</h2>
              <p className="mt-5 text-lg leading-relaxed text-ink/70">Your assistant is limited to your programme and the materials your instructors have approved. It explains difficult ideas, offers further examples and helps you prepare for assessments. It is deliberately not a general chatbot, and it will not produce answers to graded work.</p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <Eyebrow>Internship and practical application</Eyebrow>
              <h2 className={`${SERIF} mt-3 text-4xl leading-tight`}>The practical phase.</h2>
              <p className="mt-5 text-lg leading-relaxed text-ink/70">After the instructional phase, each programme continues into an intensive practical phase: two months for most programmes and three for Digital Marketing. Students work on real or carefully structured simulated projects, their instructor evaluates the work and returns corrections, and the finished work forms a portfolio.</p>
              <p className="mt-4 text-ink/60">Where approved internship partners exist, we may connect students with practical opportunities. The practical phase is part of your learning. It is not a paid job, and we do not promise external placements or employment.</p>
            </div>
            <div>
              <Eyebrow>Your private dashboard</Eyebrow>
              <h2 className={`${SERIF} mt-3 text-4xl leading-tight`}>Everything in one place.</h2>
              <ul className="mt-5">
                {["Your weekly timetable and the next session's join link", "Assignments, quizzes and assessments, with marks and feedback", "Learning materials approved for your programme", "Progress, attendance and grades", "Private messages with your instructor", "Your payment plan and payment history"].map((t) => <li key={t} className="border-t border-ink/10 py-3 text-ink/75">{t}</li>)}
              </ul>
            </div>
          </div>
        </section>

        <section className="border-t border-ink/10 py-16">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 sm:flex-row sm:items-center">
            <p className={`${SERIF} text-3xl`}>See how this applies to each discipline.</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/programmes/" className={btnOutline}>Programmes <Arrow /></Link>
              <Link href="/admissions/" className={`${btnLight} border border-ink/10`}>Admissions</Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
