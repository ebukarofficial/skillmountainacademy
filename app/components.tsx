"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { StaticImageData } from "next/image";
import { BANK, CFG, CURRICULUM_LINKS, GFORM, type Programme } from "@/lib/config";
import pGraphics from "@/assets/photos/photo-graphics.webp";
import pDevops from "@/assets/photos/photo-devops.webp";
import pCloud from "@/assets/photos/photo-cloud.webp";
import pMarketing from "@/assets/photos/photo-marketing.webp";
import pIelts from "@/assets/photos/photo-ielts.webp";
import pUiux from "@/assets/photos/photo-uiux.webp";
import pCyber from "@/assets/photos/photo-cyber.webp";
import pWeb from "@/assets/photos/photo-web.webp";
import pCert from "@/assets/photos/photo-certificate.webp";

export const PHOTO: Record<string, StaticImageData> = {
  graphics: pGraphics, devops: pDevops, cloud: pCloud, cyber: pCyber, marketing: pMarketing, ielts: pIelts, uiux: pUiux, web: pWeb, data: pCert,
};

export const naira = (n: number) => "₦" + n.toLocaleString("en-NG");

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

let ratePromise: Promise<number> | null = null;
function fetchRate(): Promise<number> {
  if (!ratePromise) {
    ratePromise = fetch("https://open.er-api.com/v6/latest/USD").then((r) => r.json())
      .then((j) => (j?.rates?.NGN > 500 ? (j.rates.NGN as number) : CFG.usdRate)).catch(() => CFG.usdRate);
  }
  return ratePromise;
}
// Naira per US dollar: the live rate when it loads, otherwise the fallback in lib/config.ts
export function useRate() {
  const [r, setR] = useState(CFG.usdRate);
  useEffect(() => { let on = true; fetchRate().then((x) => { if (on) setR(x); }); return () => { on = false; }; }, []);
  return r;
}
export const usd = (naira: number, rate: number) => "US$" + Math.round(naira / rate).toLocaleString("en-US");

export function Price({ p, size = "md" }: { p: Programme; size?: "md" | "lg" }) {
  const rate = useRate();
  const save = p.was ? p.was - p.fee! : 0;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {p.was && <s className="text-ink/45 decoration-brand-red decoration-2">{naira(p.was)}</s>}
        <span className={`font-display font-extrabold ${size === "lg" ? "text-3xl" : "text-2xl"}`}>{naira(p.fee!)}</span>
        {save > 0 && <span className="rounded-full bg-brand-red/10 px-2.5 py-0.5 text-xs font-bold text-brand-red">Save {naira(save)}</span>}
      </div>
      <p className="mt-0.5 text-sm text-ink/60">≈ {usd(p.fee!, rate)}{p.was ? <span className="text-ink/40"> (was {usd(p.was, rate)})</span> : null}</p>
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
    const t1 = skipNow ? undefined : setTimeout(() => setOut(true), 4200);
    const t2 = setTimeout(() => setShow(false), skipNow ? 0 : 4900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  if (!show) return null;
  const skip = () => { setOut(true); setTimeout(() => setShow(false), 500); };
  return (
    <div className={`fixed inset-0 z-[70] grid place-items-center bg-cream transition-opacity duration-700 ${out ? "opacity-0" : "opacity-100"}`}>
      <video src={`${CFG.base}/sma-intro.mp4`} autoPlay muted playsInline preload="auto" className="w-full max-w-2xl" aria-label="Skill Mountain Academy" />
      <button onClick={skip} className="absolute bottom-8 right-6 rounded-full bg-paper px-5 py-2 text-sm font-medium shadow">Skip</button>
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
  const link = CURRICULUM_LINKS[p.id];
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-ink/60 sm:place-items-center sm:p-5" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${p.name} curriculum`} onClick={(e) => e.stopPropagation()}
        className="pop max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-paper p-6 sm:rounded-[2rem]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-brand-red">Curriculum</p>
            <h2 className="font-display text-2xl font-extrabold">{p.name}</h2>
            <p className="text-sm text-ink/60">{p.months ? `${p.months} months · ` : ""}one-on-one mentorship</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="h-10 w-10 shrink-0 rounded-full bg-cream">✕</button>
        </div>
        <p className="mt-3 text-ink/75">{p.blurb}</p>
        <h3 className="mt-5 font-display font-bold">What you will cover</h3>
        <ol className="mt-3 space-y-2">
          {p.learn.map((l, i) => (
            <li key={l} className="flex gap-3 rounded-2xl bg-cream px-4 py-3 text-sm">
              <span className="brand-bg grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white">{i + 1}</span>
              <span>{l}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5">
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" className="block rounded-full border-2 border-indigo py-3 text-center font-display font-semibold text-indigo transition hover:bg-indigo hover:text-white">Download the full curriculum</a>
          ) : (
            <p className="rounded-2xl bg-cream px-4 py-3 text-sm text-ink/70">The full curriculum document is coming soon. Your welcome email will include it after you register.</p>
          )}
        </div>
        <div className="mt-5 border-t border-ink/10 pt-4"><Price p={p} /></div>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

// Calendly booking widget. If no link is set yet, shows a WhatsApp button instead.
export function CalendlyEmbed({ url }: { url: string }) {
  useEffect(() => {
    if (!url || document.getElementById("calendly-js")) return;
    const sc = document.createElement("script");
    sc.id = "calendly-js"; sc.src = "https://assets.calendly.com/assets/external/widget.js"; sc.async = true;
    document.body.appendChild(sc);
  }, [url]);
  if (!url) {
    return (
      <a href={`https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent("Hello Skill Mountain Academy, I would like to book a free consultation call.")}`} target="_blank" rel="noopener noreferrer"
        className="brand-bg inline-block rounded-full px-8 py-4 font-display font-semibold text-white transition hover:brightness-110">Book a call on WhatsApp</a>
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
    <div className="rounded-2xl bg-cream p-4">
      <p className="text-sm text-ink/75">Kindly pay for the programme using the account below.</p>
      <dl className="mt-3 space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-3">
            <div className="min-w-0"><dt className="text-xs text-ink/55">{k}</dt><dd className="truncate font-display font-bold">{v}</dd></div>
            <button type="button" onClick={() => copy(k, v)} className="shrink-0 rounded-full bg-indigo px-3 py-1.5 text-xs font-semibold text-white">{copied === k ? "Copied" : "Copy"}</button>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm font-medium">Send us a teller for confirmation on or before the scheduled date for the programme.</p>
    </div>
  );
}
