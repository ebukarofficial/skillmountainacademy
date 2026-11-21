import type { Metadata } from "next";
import Link from "next/link";
import { Arrow, PageHero, SERIF, btnLight, btnOutline } from "../brand";
import { SiteFooter, SiteHeader } from "../site-parts";

export const metadata: Metadata = {
  title: "The Learning Experience | Skill Mountain Academy",
  description: "How a Skill Mountain Academy programme is taught: an assigned instructor, a weekly one-on-one live session with screen sharing and guided practice, 10–20 hours of independent study, assignments and assessment, AI learning support and an internship.",
  alternates: { canonical: "/learning-experience/" },
};

// Each element is explained once, here. Other pages link to this one instead of repeating it.
const ELEMENTS: [string, string][] = [
  ["An assigned instructor", "One instructor teaches you throughout the programme, so your progress is followed by someone who knows your work."],
  ["One-on-one instruction", "Sessions are for you alone. Explanations start from what you already understand and move at the pace your work shows you are ready for."],
  ["Live sessions", "A weekly session of 45–60 minutes on Google Meet, at a fixed time agreed when you enrol."],
  ["Screen sharing", "Your instructor demonstrates professional tools on screen; when asked, you share yours, so mistakes are seen and corrected as they happen."],
  ["Guided practice", "Much of each session is spent working under supervision, applying the technique just shown."],
  ["Assignments", "Weekly work set by your instructor, submitted in your dashboard and returned with a mark and written comments."],
  ["Assessments", "Quizzes and periodic assessments check understanding of each stage before you move to the next."],
  ["AI learning support", "A learning assistant, limited to your programme's approved materials, helps with revision between sessions. It does not complete graded work."],
  ["Internship", "After training, a supervised practical phase of one to three months, depending on the programme, applies the discipline to complete projects."],
];

const WEEK: [string, string, string][] = [
  ["Live session", "45–60 minutes", "Instruction and demonstration, then guided practice on your own screen. Your instructor sets the week's work at the end."],
  ["Independent study", "10–20 hours", "Assignments and classwork, practical exercises, video lessons, quizzes, revision with the learning assistant, reviewing the last session and preparing questions for the next. Spread across the week as suits you."],
  ["Submission", "By the deadline", "You submit the week's assignment and complete any quiz in your dashboard, where your weekly checklist records what is done."],
  ["Review and feedback", "Before the next session", "Your instructor marks your work, writes feedback and reviews your progress, and the next session begins from there."],
];

export default function LearningExperiencePage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        <PageHero title="We teach by instruction and by showing."
          lede="Every programme combines explanation with demonstration: your instructor tells you how the work is done, shows you, and then watches you do it." />

        <section aria-labelledby="elements" className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <h2 id="elements" className={`${SERIF} text-3xl leading-tight sm:text-4xl`}>How teaching is organised</h2>
          <dl className="mt-10 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
            {ELEMENTS.map(([t, d]) => (
              <div key={t} className="border-t border-ink/10 py-6">
                <dt className="font-display text-lg font-semibold">{t}</dt>
                <dd className="mt-2 leading-relaxed text-ink/75">{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="week" className="border-y border-ink/10 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-5">
            <h2 id="week" className={`${SERIF} text-3xl leading-tight sm:text-4xl`}>What a typical week looks like.</h2>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink/75">One live session and 10–20 hours of independent study form a single weekly cycle. Each week begins where the last one ended.</p>
            <ol className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {WEEK.map(([t, when, d], i) => (
                <li key={t} className="flex flex-col rounded-lg border border-ink/10 bg-white p-6">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-indigo/90 font-display text-sm font-semibold text-white">{i + 1}</span>
                  <p className="mt-4 font-display text-lg font-semibold">{t}</p>
                  <p className="text-sm font-semibold text-brand-red">{when}</p>
                  <p className="mt-2 leading-relaxed text-ink/75">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="practical" className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <h2 id="practical" className={`${SERIF} text-3xl leading-tight sm:text-4xl`}>The internship</h2>
              <p className="mt-4 text-lg leading-relaxed text-ink/75">After training, students apply the discipline to complete projects, real or carefully structured, under their instructor&apos;s supervision. The finished work forms a portfolio.</p>
              <p className="mt-3 text-ink/70">The internship is part of your studies. It is not paid employment, and the Academy does not promise external placements or jobs.</p>
            </div>
            <div>
              <h2 className={`${SERIF} text-3xl leading-tight sm:text-4xl`}>Your learning space</h2>
              <ul className="mt-4">
                {["Your next session and its join link", "The week's checklist of study activities", "Assignments, quizzes and assessments, with feedback", "Approved learning materials", "Progress and attendance", "Messages with your instructor"].map((t) => <li key={t} className="border-t border-ink/10 py-3 text-ink/80">{t}</li>)}
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
