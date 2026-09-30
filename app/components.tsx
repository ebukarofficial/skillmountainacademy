"use client";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CFG, type Programme } from "@/lib/config";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { PaystackPop: any } }

export const naira = (n: number) => "₦" + n.toLocaleString("en-NG");

// Sends data to the Google Sheet script. no-cors: we cannot read the reply, and do not need to.
export function postSheet(data: object) {
  if (!CFG.sheetUrl) return Promise.resolve();
  return fetch(CFG.sheetUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(data) }).catch(() => {});
}

export function Chevrons({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 120" fill="none" stroke="currentColor" strokeWidth="1.2" className={className} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => <path key={i} d={`M${10 + i * 14} 116 L100 ${10 + i * 14} L${190 - i * 14} 116`} />)}
    </svg>
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

export function Register({ p, onClose }: { p: Programme; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [onClose]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    if (!window.PaystackPop || !CFG.paystackKey) return setErr("Payment is not ready yet. Refresh the page and try again.");
    const f = new FormData(e.currentTarget);
    const d = { name: String(f.get("name")).trim(), email: String(f.get("email")).trim(), phone: String(f.get("phone")).trim() };
    const reference = "SMA-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
    setBusy(true);
    await postSheet({ action: "register", ...d, programme: p.name, reference }); // saved as PENDING
    window.PaystackPop.setup({
      key: CFG.paystackKey, email: d.email, amount: p.fee! * 100, currency: "NGN", ref: reference,
      channels: ["card", "bank_transfer"],
      metadata: { programme: p.name, name: d.name, phone: d.phone },
      // The server re-checks the payment with Paystack before marking PAID and emailing resources.
      callback: () => { postSheet({ action: "verify", reference }); setBusy(false); setRef(reference); },
      onClose: () => setBusy(false),
    }).openIframe();
  }

  const field = "mt-1 w-full rounded-2xl border border-ink/15 bg-white px-4 py-3.5 text-base outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/40";
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-ink/60 sm:place-items-center sm:p-5" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Register for ${p.name}`} onClick={(e) => e.stopPropagation()}
        className="pop max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[2rem] bg-paper p-6 sm:rounded-[2rem]">
        {ref ? (
          <div className="py-4 text-center">
            <p className="font-display text-2xl font-extrabold brand-text">Payment received</p>
            <p className="mt-3 text-ink/70">We are confirming it with Paystack. Your learning resources will be emailed to you shortly. Check your spam folder if you don&apos;t see it.</p>
            <p className="mt-4 rounded-2xl bg-cream px-4 py-3 text-sm">Your reference: <b>{ref}</b></p>
            <button onClick={onClose} className="brand-bg mt-6 rounded-full px-8 py-3 font-display font-semibold text-white">Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl font-extrabold">{p.name}</h2>
                <p className="text-ink/70">{naira(p.fee!)} · {p.months} months · one-on-one</p>
              </div>
              <button type="button" aria-label="Close" onClick={onClose} className="h-10 w-10 shrink-0 rounded-full bg-cream">✕</button>
            </div>
            <label className="block font-medium">Full name<input name="name" required autoComplete="name" className={field} /></label>
            <label className="block font-medium">Email<input name="email" type="email" required autoComplete="email" className={field} /></label>
            <label className="block font-medium">Phone or WhatsApp<input name="phone" type="tel" required autoComplete="tel" className={field} /></label>
            {err && <p role="alert" className="font-medium text-brand-red">{err}</p>}
            <button disabled={busy} className="brand-bg w-full rounded-full py-4 font-display font-semibold text-white disabled:opacity-60">
              {busy ? "Opening payment…" : `Pay ${naira(p.fee!)} with Paystack`}
            </button>
            <p className="text-center text-sm text-ink/60">Pay by card or bank transfer.</p>
          </form>
        )}
      </div>
    </div>
  );
}
