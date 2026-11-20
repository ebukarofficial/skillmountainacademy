import Link from "next/link";
import { BUSINESS } from "@/lib/config";
import { SiteFooter, SiteHeader } from "./site-parts";
import { LEGAL_UPDATED } from "@/lib/legal";

const LINKS: [string, string][] = [["/terms/", "Terms"], ["/privacy/", "Privacy"], ["/cookies/", "Cookies"], ["/refunds/", "Refunds"]];

export function LegalShell({ title, intro, items, updated = LEGAL_UPDATED }: { title: string; intro: string; items: [string, string][]; updated?: string }) {
  return (
    <>
    <SiteHeader />
    <main id="main" className="min-h-screen px-5 py-14 sm:py-20">
      <article className="mx-auto max-w-3xl">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-brand-red">Legal</p>
        <h1 className="mt-3 font-(family-name:--font-serif) text-5xl font-medium leading-tight">{title}</h1>
        <p className="mt-2 text-sm text-ink/70">Last updated: {updated}</p>
        <p className="mt-4 text-ink/80">{intro}</p>
        <div className="mt-6 space-y-6">
          {items.map(([t, d]) => (
            <section key={t} className="border-t border-ink/10 pt-5"><h2 className="font-display text-lg font-semibold">{t}</h2><p className="mt-1.5 leading-relaxed text-ink/80">{d}</p></section>
          ))}
        </div>
        <section className="mt-10 rounded-lg border border-ink/10 bg-paper p-6">
          <h2 className="font-display text-lg font-bold">Business details</h2>
          <p className="mt-1 text-ink/80">{BUSINESS.name}{BUSINESS.rc ? ` (RC ${BUSINESS.rc})` : ""}<br />{BUSINESS.address}<br />Phone: {BUSINESS.phone}<br />Email: <a className="font-semibold text-brand-red underline" href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a></p>
        </section>
        <nav aria-label="Legal pages" className="mt-6 flex flex-wrap gap-3 text-sm">
          {LINKS.map(([h, t]) => <Link key={h} href={h} className="font-semibold text-brand-red underline">{t}</Link>)}
        </nav>
      </article>
    </main>
    <SiteFooter />
    </>
  );
}
