"use client";
// The institutional header, shared by every public page: six sections and one admission action.
// There is deliberately no sign-in link on the public site: students and staff use the private entry pages
// (/app/login/ and /app/staff/) from their emails.
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import logo from "@/assets/sma-logo.png";
import { NAV } from "@/lib/nav";


export function SiteHeader() {
  const path = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const here = (h: string) => (h === "/" ? path === "/" : path.startsWith(h) || (h === "/programmes/" && path.startsWith("/checkout")));
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);
  return (
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-cream/95 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-3.5" aria-label="Main">
        <Link href="/" aria-label="Skill Mountain Academy home" className="shrink-0"><Image src={logo} alt="Skill Mountain Academy" priority unoptimized className="h-10 w-auto sm:h-11" /></Link>
        <ul className="hidden items-center gap-7 xl:flex">
          {NAV.map(([h, t]) => (
            <li key={h}><Link href={h} aria-current={here(h) ? "page" : undefined} className={`relative py-2 font-display text-[0.8125rem] font-medium tracking-wide transition hover:text-brand-red ${here(h) ? "text-ink after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:bg-brand-red" : "text-ink/75"}`}>{t}</Link></li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Link href="/admissions/" className="hidden rounded-full bg-indigo px-5 py-2 font-display text-[0.8125rem] font-semibold text-cream transition hover:bg-navy sm:inline-block">Apply</Link>
          <button type="button" aria-label="Menu" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen(!open)} className="grid h-11 w-11 place-items-center rounded-full border border-ink/15 xl:hidden">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">{open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}</svg>
          </button>
        </div>
      </nav>
      {open && (
        <div id="site-menu" className="border-t border-ink/10 bg-paper xl:hidden" onClick={() => setOpen(false)}>
          <ul className="mx-auto max-w-6xl px-5 py-3">
            {NAV.map(([h, t]) => <li key={h}><Link href={h} aria-current={here(h) ? "page" : undefined} className={`block border-b border-ink/10 py-3.5 font-display font-medium ${here(h) ? "text-brand-red" : ""}`}>{t}</Link></li>)}
          </ul>
        </div>
      )}
    </header>
  );
}
