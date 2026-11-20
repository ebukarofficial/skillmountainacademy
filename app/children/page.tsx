import type { Metadata } from "next";
import Link from "next/link";
import { CHILDREN, FLAGS, MESSAGE, PROGRAMMES } from "@/lib/config";
import { MessageStrip, SiteFooter, SiteHeader } from "../site-parts";
import { EnquiryForm } from "./enquiry-form";

export const metadata: Metadata = {
  title: "Children's package | Flexible, one-on-one learning | Skill Mountain Academy",
  description: "One-on-one online skill learning for children, through a parent account and with the parent's consent, with a customised curriculum. Skill Mountain Academy, Abuja, Nigeria.",
  alternates: { canonical: "/children/" },
};

const POINTS: [string, string][] = [
  ["Through a parent account", "Children learn only through a parent or guardian's account, and only with the parent's consent. You stay in charge of their details and schedule."],
  ["A curriculum made for your child", "We shape the curriculum around your child's age, interests and pace, including children who need additional support."],
  ["One teacher. One student.", "Your child learns live and online with their own mentor, one-on-one, never in a crowded class."],
  ["Flexible", "Pick the day and time that suit your family, weekday or Saturday."],
];

export default function ChildrenPage() {
  const selfServe = FLAGS.CHILDREN_ENABLED && CHILDREN.programmes.length > 0;
  return (
    <>
      <SiteHeader />
      <main id="main" className="overflow-x-clip">
        <MessageStrip />
        <section className="mx-auto max-w-4xl px-5 pb-10 pt-10 text-center sm:pt-14">
          <p className="mx-auto w-fit rounded-full bg-paper px-4 py-1.5 text-sm font-medium">Children&apos;s package</p>
          <h1 className="mt-4 font-display text-4xl font-extrabold leading-tight sm:text-5xl"><span className="brand-text">Skills for children, taught one-on-one</span></h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-ink/75">{MESSAGE.headline} Children learn through a parent account, with the parent&apos;s consent, a customised curriculum and a mentor of their own.</p>
        </section>

        <section aria-label="How the children's package works" className="mx-auto grid max-w-6xl gap-4 px-5 pb-12 sm:grid-cols-2">
          {POINTS.map(([t, d], i) => (
            <div key={t} className={`rounded-[1.75rem] p-6 ${["bg-paper", "bg-brand-orange/25", "bg-indigo text-white", "bg-brand-red/15"][i]}`}>
              <h2 className="font-display text-xl font-bold">{t}</h2>
              <p className={`mt-2 ${i === 2 ? "text-white/80" : "text-ink/75"}`}>{d}</p>
            </div>
          ))}
        </section>

        {selfServe && (
          <section aria-labelledby="register-child" className="mx-auto max-w-4xl px-5 pb-12" data-children-selfserve>
            <h2 id="register-child" className="font-display text-3xl font-extrabold">Register your child</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {CHILDREN.programmes.map((c) => {
                const p = PROGRAMMES.find((x) => x.slug === c.slug);
                return p ? <li key={c.slug} className="rounded-2xl bg-paper p-4"><b className="font-display">{p.name}</b><span className="block text-sm text-ink/70">Ages {c.ages}</span></li> : null;
              })}
            </ul>
          </section>
        )}

        <section aria-labelledby="enquire" className="mx-auto max-w-3xl px-5 pb-16">
          <div className="rounded-[2rem] bg-paper p-6 shadow-xl shadow-indigo/10 sm:p-8">
            <h2 id="enquire" className="font-display text-2xl font-extrabold sm:text-3xl">Talk to us about your child</h2>
            <p className="mt-2 text-ink/75">Tell us a little about your child. We will call or email you to plan their learning together. There is no payment at this stage.</p>
            <div className="mt-6"><EnquiryForm /></div>
          </div>
          <p className="mt-6 text-center text-sm text-ink/70">Looking for a programme for yourself? <Link href="/#programmes" className="font-semibold text-brand-red underline">See all programmes</Link>.</p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
