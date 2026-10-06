import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import logo from "@/assets/sma-logo.png";
import { TERMS, TERMS_UPDATED } from "@/lib/terms";

export const metadata: Metadata = { title: "Terms and Conditions | Skill Mountain Academy" };

export default function TermsPage() {
  return (
    <main className="min-h-screen px-5 pb-20">
      <header className="mx-auto flex max-w-3xl items-center justify-between py-5">
        <Link href="/" aria-label="Skill Mountain Academy home"><Image src={logo} alt="Skill Mountain Academy" priority unoptimized className="h-10 w-auto sm:h-12" /></Link>
        <Link href="/#programmes" className="rounded-full bg-paper px-4 py-1.5 text-sm font-medium">Back to programmes</Link>
      </header>
      <article className="mx-auto max-w-3xl rounded-[2rem] bg-paper p-6 shadow-xl shadow-indigo/10 sm:p-10">
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl"><span className="brand-text">Terms and Conditions</span></h1>
        <p className="mt-2 text-sm text-ink/60">Last updated: {TERMS_UPDATED}</p>
        <p className="mt-4 text-ink/75">Please read these terms carefully before you register and pay. You will be asked to confirm that you have read and understood them.</p>
        <div className="mt-6 space-y-6">
          {TERMS.map(([t, d]) => (
            <section key={t}><h2 className="font-display text-lg font-bold">{t}</h2><p className="mt-1 text-ink/75">{d}</p></section>
          ))}
        </div>
      </article>
    </main>
  );
}
