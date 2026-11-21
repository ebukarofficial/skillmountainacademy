"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BANK, CFG, CURRICULUM_LINKS, GFORM, duration, type Programme } from "@/lib/config";
import { hasPdf, learnList } from "@/lib/curricula";
import { Money, QuotePrice } from "./currency";

// The investment and payment panel colour set by the final brief (#F8F8F9).
export const PANEL_BG = "bg-[#f8f8f9]";
export { FOCUS, PHOTO, SMA_PHOTO } from "@/lib/photos";
export { naira } from "@/lib/format";

// "AWS" and "Azure" text badges for Cloud track programmes (text only, no third-party logos).
export function CloudBadges({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  return (
    <span className={`flex flex-wrap gap-1.5 ${className}`}>
      {["AWS", "Azure"].map((b) => <span key={b} className={`rounded-full px-2.5 py-0.5 text-xs font-bold text-white ${dark ? "bg-white/20" : "bg-indigo"}`}>{b}</span>)}
    </span>
  );
}

// Sends data to the Google Apps Script (payment check). no-cors: we cannot read the reply, and do not need to.
export function postSheet(data: object) {
  if (!CFG.sheetUrl) return Promise.resolve();
  return fetch(CFG.sheetUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(data) }).catch(() => {});
}

// Submits the registration to the Google Form (it lands in the form's response sheet).
export function postForm(d: { name: string; email: string; phone: string; programme: string; reference: string; terms?: string }) {
  if (!GFORM.url) return Promise.resolve();
  const body = new URLSearchParams();
  (Object.keys(GFORM.entries) as (keyof typeof GFORM.entries)[]).forEach((k) => { if (GFORM.entries[k]) body.append(GFORM.entries[k], d[k] ?? ""); });
  return fetch(GFORM.url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }).catch(() => {});
}

export function Chevrons({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 120" fill="none" stroke="currentColor" strokeWidth="1.2" className={className} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => <path key={i} d={`M${10 + i * 14} 116 L100 ${10 + i * 14} L${190 - i * 14} 116`} />)}
    </svg>
  );
}

// Fade-up on scroll
export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.add("in"); io.disconnect(); } }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

export function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (t: number) => { const k = Math.min(1, (t - t0) / 1000); setN(Math.round(to * k)); if (k < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [to]);
  return <span ref={ref}>{n}{suffix}</span>;
}

export function Price({ p, size = "md" }: { p: Programme; size?: "md" | "lg" }) {
  const save = p.was ? p.was - p.price : 0;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {p.was && <s className="text-ink/70 decoration-brand-red decoration-2"><Money naira={p.was} /></s>}
        <QuotePrice slug={p.slug} fallbackNaira={p.price} size={size} />
        {save > 0 && <span className="rounded-full bg-brand-red/10 px-2.5 py-0.5 text-xs font-bold text-brand-red">Save <Money naira={save} /></span>}
      </div>
    </div>
  );
}

// SMA logo animation on the cream background. Plays once per visit.
export function Intro() {
  const [show, setShow] = useState(true);
  const [out, setOut] = useState(false);
  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem("sma-intro") === "1"; sessionStorage.setItem("sma-intro", "1"); } catch { /* ignore */ }
    const skipNow = seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t1 = skipNow ? undefined : setTimeout(() => setOut(true), 1200);
    const t2 = setTimeout(() => setShow(false), skipNow ? 0 : 1800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  if (!show) return null;
  const skip = () => { setOut(true); setTimeout(() => setShow(false), 500); };
  return (
    <div className={`fixed inset-0 z-[70] grid place-items-center bg-paper transition-opacity duration-700 ${out ? "opacity-0" : "opacity-100"}`}>
      <video src="/sma-intro.mp4" poster="/sma-intro-poster.webp" autoPlay muted playsInline preload="auto" className="w-full max-w-2xl" aria-label="Skill Mountain Academy" />
      <button onClick={skip} className="absolute bottom-8 right-6 rounded-full bg-white px-5 py-2 text-sm font-medium shadow">Skip</button>
    </div>
  );
}

export function SocialIcon({ name }: { name: string }) {
  const c = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
  switch (name) {
    case "Facebook": return <svg {...c}><path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H7v4h3v7h4v-7h3l1-4h-4V8.5c0-.3.2-.5.5-.5z" /></svg>;
    case "LinkedIn": return <svg {...c}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7" /></svg>;
    case "X": return <svg {...c}><path d="M4 4h4l12 16h-4zM19.5 4 13 11M4.5 20 11 13" /></svg>;
    case "Instagram": return <svg {...c}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.5 6.5v.01" /></svg>;
    case "TikTok": return <svg {...c}><path d="M15 3c.3 2.4 1.8 3.9 4 4v3.2c-1.5 0-2.8-.5-4-1.3v6.1a5.5 5.5 0 1 1-5.5-5.5c.3 0 .7 0 1 .1v3.3a2.3 2.3 0 1 0 1.5 2.1V3z" /></svg>;
    default: return <svg {...c}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
  }
}

// Curriculum viewer: shows what a learner will cover, with a download link when a Google Drive link is set.
export function CurriculumModal({ p, onClose, action }: { p: Programme; onClose: () => void; action?: ReactNode }) {
  // The PDF in public/curricula/ wins; otherwise the Google Drive link in lib/config.ts, if any.
  const pdf = hasPdf(p);
  const link = pdf ? p.curriculum : CURRICULUM_LINKS[p.slug];
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-ink/60 sm:place-items-center sm:p-5" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${p.name} curriculum`} onClick={(e) => e.stopPropagation()}
        className="pop max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-6 sm:rounded-xl sm:p-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-brand-red">Curriculum</p>
            <h2 className="mt-2 font-(family-name:--font-serif) text-3xl font-medium leading-tight">{p.name}</h2>
            <p className="mt-1 text-sm text-ink/70">{duration(p)} · one-on-one instruction</p>
          </div>
          <button ref={closeBtn} type="button" aria-label="Close" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-ink/15">✕</button>
        </div>
        <h3 className="mt-6 font-display text-sm font-semibold">What the programme covers</h3>
        <ol className="mt-2">
          {learnList(p).map((l, i) => (
            <li key={l} className="flex gap-4 border-t border-ink/10 py-3 text-[0.95rem]">
              <span className="w-6 shrink-0 font-(family-name:--font-serif) text-lg leading-6 text-brand-red">{String(i + 1).padStart(2, "0")}</span>
              <span>{l}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5">
          {link ? (
            <div className="flex flex-wrap items-center gap-4">
              <a href={link} target="_blank" rel={pdf ? "noopener" : "noopener noreferrer"} className="rounded-full bg-indigo px-6 py-3 text-center font-display text-sm font-semibold text-cream transition hover:bg-navy">{pdf ? "Open the full curriculum (PDF)" : "Open the full curriculum"}</a>
              {pdf && <a href={link} download className="text-sm font-semibold text-brand-red underline">Download PDF</a>}
            </div>
          ) : (
            <p className="border-t border-ink/10 pt-4 text-sm text-ink/70">The detailed curriculum document is sent with your welcome email after enrolment. The topics above are the programme&apos;s official outline.</p>
          )}
        </div>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

// "View curriculum" button: opens the curriculum viewer above.
export function CurriculumButton({ p, className = "", label = "View curriculum" }: { p: Programme; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>{label}</button>
      {open && <CurriculumModal p={p} onClose={close} />}
    </>
  );
}

// Calendly booking widget. It loads only after the visitor clicks (it is a third-party service). If no link is set, shows a WhatsApp button.
export function CalendlyEmbed({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!url || !loaded || document.getElementById("calendly-js")) return;
    const sc = document.createElement("script");
    sc.id = "calendly-js"; sc.src = "https://assets.calendly.com/assets/external/widget.js"; sc.async = true;
    document.body.appendChild(sc);
  }, [url, loaded]);
  if (!url) {
    return (
      <a href={`https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent("Hello Skill Mountain Academy, I would like to book a free consultation call.")}`} target="_blank" rel="noopener noreferrer"
        className="brand-bg inline-block rounded-full px-8 py-4 font-display font-semibold text-white transition hover:brightness-110">Book a call on WhatsApp</a>
    );
  }
  if (!loaded) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl bg-white p-6 text-center shadow-sm">
        <p className="text-sm text-ink/70">Our booking calendar is provided by Calendly. Loading it shares some data with Calendly. See our <a href="/cookies/" className="font-semibold text-brand-red underline">Cookie Policy</a> and <a href="/privacy/" className="font-semibold text-brand-red underline">Privacy Policy</a>.</p>
        <button type="button" onClick={() => setLoaded(true)} className="brand-bg mt-4 rounded-full px-8 py-3.5 font-display font-semibold text-white">Load booking calendar</button>
      </div>
    );
  }
  return <div className="calendly-inline-widget overflow-hidden rounded-3xl bg-white" data-url={url} style={{ minWidth: "280px", height: "720px" }} />;
}

// Bank transfer details with copy buttons.
export function BankDetails() {
  const [copied, setCopied] = useState("");
  const copy = async (k: string, v: string) => {
    try { await navigator.clipboard.writeText(v); setCopied(k); setTimeout(() => setCopied(""), 1500); } catch { /* ignore */ }
  };
  const rows: [string, string][] = [["Account name", BANK.name], ["Account number", BANK.number], ["Bank", BANK.bank]];
  return (
    <div className={`rounded-2xl ${PANEL_BG} p-4`}>
      <p className="text-sm text-ink/75">Kindly pay for the programme using the account below.</p>
      <dl className="mt-3 space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-3">
            <div className="min-w-0"><dt className="text-xs text-ink/70">{k}</dt><dd className="truncate font-display font-bold">{v}</dd></div>
            <button type="button" aria-label={`Copy ${k.toLowerCase()}`} onClick={() => copy(k, v)} className="shrink-0 rounded-full bg-indigo px-3 py-1.5 text-xs font-semibold text-white">{copied === k ? "Copied" : "Copy"}</button>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm font-medium">Send us a teller for confirmation on or before the scheduled date for the programme.</p>
    </div>
  );
}
