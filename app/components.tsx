"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CFG, FORM, type Programme } from "@/lib/config";

export const naira = (n: number) => "₦" + n.toLocaleString("en-NG");
export const pctOff = (p: Programme) => (p.was && p.fee && p.was > p.fee ? Math.round((1 - p.fee / p.was) * 100) : 0);

// Sends data to the Apps Script web app (payment check, community signups). We cannot read the reply, and do not need to.
export function postSheet(data: object) {
  if (!CFG.sheetUrl) return Promise.resolve();
  return fetch(CFG.sheetUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(data) }).catch(() => {});
}

// Submits a registration to the Google Form (its responses land in your Google Sheet).
export function postForm(d: { name: string; email: string; phone: string; programme: string; amount: number; reference: string }) {
  if (!FORM.action) return Promise.resolve();
  const body = new URLSearchParams();
  const e = FORM.entries;
  body.set(e.name, d.name); body.set(e.email, d.email); body.set(e.phone, d.phone);
  body.set(e.programme, d.programme); body.set(e.amount, String(d.amount)); body.set(e.reference, d.reference);
  return fetch(FORM.action, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }).catch(() => {});
}

export function Chevrons({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 120" fill="none" stroke="currentColor" strokeWidth="1.2" className={className} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => <path key={i} d={`M${10 + i * 14} 116 L100 ${10 + i * 14} L${190 - i * 14} 116`} />)}
    </svg>
  );
}

// Slashed price: old price crossed out, new price, and the saving
export function Price({ p, big = false }: { p: Programme; big?: boolean }) {
  const off = pctOff(p);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className={`font-display font-extrabold ${big ? "text-4xl" : "text-2xl"}`}>{naira(p.fee!)}</span>
      {off > 0 && <s className="text-ink/50 decoration-brand-red decoration-2">{naira(p.was!)}</s>}
      {off > 0 && <span className="rounded-full bg-brand-red px-2.5 py-0.5 text-xs font-bold text-white">Save {off}%</span>}
    </div>
  );
}

// Fade-up on scroll, like the Skillex sections
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

// Number that counts up when it scrolls into view
export function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (t: number) => { const k = Math.min(1, (t - t0) / 1200); setN(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [to]);
  return <span ref={ref}>{n}{suffix}</span>;
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
