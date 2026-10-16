import Image from "next/image";
import Link from "next/link";
import logo from "@/assets/sma-logo.png";
import { BUSINESS } from "@/lib/config";
import { LEGAL_UPDATED } from "@/lib/legal";

const LINKS: [string, string][] = [["/terms/", "Terms"], ["/privacy/", "Privacy"], ["/cookies/", "Cookies"], ["/refunds/", "Refunds"]];

export function LegalShell({ title, intro, items, updated = LEGAL_UPDATED }: { title: string; intro: string; items: [string, string][]; updated?: string }) {
  return (
    <main id="main" className="min-h-screen px-5 pb-20">
      <header className="mx-auto flex max-w-3xl items-center justify-between py-5">
        <Link href="/" aria-label="Skill Mountain Academy home"><Image src={logo} alt="Skill Mountain Academy" priority unoptimized className="h-10 w-auto sm:h-12" /></Link>
        <Link href="/#programmes" className="rounded-full bg-paper px-4 py-1.5 text-sm font-medium">Back to programmes</Link>
      </header>
      <article className="mx-auto max-w-3xl rounded-[2rem] bg-paper p-6 shadow-xl shadow-indigo/10 sm:p-10">
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl"><span className="brand-text">{title}</span></h1>
        <p className="mt-2 text-sm text-ink/70">Last updated: {updated}</p>
        <p className="mt-4 text-ink/80">{intro}</p>
        <div className="mt-6 space-y-6">
          {items.map(([t, d]) => (
            <section key={t}><h2 className="font-display text-lg font-bold">{t}</h2><p className="mt-1 text-ink/80">{d}</p></section>
          ))}
        </div>
        <section className="mt-8 rounded-2xl bg-cream p-5">
          <h2 className="font-display text-lg font-bold">Business details</h2>
          <p className="mt-1 text-ink/80">{BUSINESS.name}{BUSINESS.rc ? ` (RC ${BUSINESS.rc})` : ""}<br />{BUSINESS.address}<br />Phone: {BUSINESS.phone}<br />Email: <a className="font-semibold text-brand-red underline" href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a></p>
        </section>
        <nav aria-label="Legal pages" className="mt-6 flex flex-wrap gap-3 text-sm">
          {LINKS.map(([h, t]) => <Link key={h} href={h} className="font-semibold text-brand-red underline">{t}</Link>)}
        </nav>
      </article>
    </main>
  );
}
