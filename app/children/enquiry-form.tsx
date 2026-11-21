"use client";
// Parent enquiry form for the children's package. Sends to POST /api/children-enquiry (saved to D1, emailed to SMA).
// Until the backend and Turnstile are set up, it shows WhatsApp and email instead, so the page never breaks.
import { useState, type FormEvent } from "react";
import { BUSINESS, CFG, CHILDREN, PROGRAMMES } from "@/lib/config";
import { Turnstile } from "../turnstile";
import { useBackend } from "../checkout/server-pay";

const input = "mt-1 w-full rounded-2xl border border-ink/15 bg-white px-4 py-3.5 text-base outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/40";

export function EnquiryForm() {
  const backend = useBackend();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const wa = `https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent("Hello Skill Mountain Academy, I would like to know more about the children's package.")}`;

  if (backend.mode === "checking") return <p className="py-8 text-center text-ink/70" role="status">Loading the enquiry form…</p>;
  if (backend.mode === "legacy") {
    return (
      <div className="rounded-2xl bg-paper p-5 text-center" data-enquiry-fallback>
        <p className="font-medium">Our online enquiry form is not available right now. Please contact us directly and we will reply quickly.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <a href={wa} target="_blank" rel="noopener noreferrer" className="brand-bg rounded-full px-6 py-3 font-display font-semibold text-white">Message us on WhatsApp</a>
          <a href={`mailto:${BUSINESS.email}?subject=${encodeURIComponent("Children's package enquiry")}`} className="rounded-full border-2 border-indigo px-6 py-3 font-display font-semibold text-indigo">Email us</a>
        </div>
      </div>
    );
  }
  if (sent) {
    return <div role="status" className="rounded-2xl bg-paper p-6 text-center"><p className="font-display text-xl font-bold">Thank you. We received your enquiry.</p><p className="mt-2 text-ink/75">We will contact you within two working days. A confirmation is on its way to your email.</p></div>;
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (!token) return setErr("Please complete the security check.");
    setBusy(true);
    try {
      const r = await fetch("/api/children-enquiry", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...f, childAge: Number(f.childAge), consent: f.consent === "on", turnstileToken: token }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { setErr(j.message || "Something went wrong. Please try again, or message us on WhatsApp."); setBusy(false); return; }
      setSent(true);
    } catch {
      setErr("We could not reach our server. Please try again, or message us on WhatsApp.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Leave this empty<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block font-medium">Your name (parent or guardian)<input name="parentName" required maxLength={120} autoComplete="name" className={input} /></label>
        <label className="block font-medium">Email address<input name="email" type="email" required maxLength={200} autoComplete="email" className={input} /></label>
        <label className="block font-medium">Phone or WhatsApp number<input name="phone" type="tel" required maxLength={30} autoComplete="tel" className={input} /></label>
        <label className="block font-medium">Your child&apos;s age<input name="childAge" type="number" required min={CHILDREN.minAge} max={CHILDREN.maxAge} inputMode="numeric" className={input} /></label>
      </div>
      <label className="block font-medium">Programme of interest
        <select name="programme" required defaultValue="" className={input}>
          <option value="" disabled>Select…</option>
          {PROGRAMMES.map((p) => <option key={p.slug}>{p.name}</option>)}
          <option>Not sure yet</option>
        </select>
      </label>
      <label className="block font-medium">Anything we should know? (optional)<textarea name="message" rows={3} maxLength={1000} className={input} placeholder="Your child's interests, experience or learning needs" /></label>
      <label className="flex items-start gap-3 rounded-2xl bg-paper px-4 py-3 text-sm">
        <input type="checkbox" name="consent" required className="mt-1 h-5 w-5 shrink-0 accent-brand-red" />
        <span>I am this child&apos;s parent or guardian, and I agree to Skill Mountain Academy using these details to contact me about the children&apos;s package (see our <a href="/privacy/" className="font-semibold text-brand-red underline">Privacy Policy</a>).</span>
      </label>
      <Turnstile action="children" onToken={setToken} />
      {err && <p role="alert" className="font-medium text-brand-red">{err}</p>}
      <button disabled={busy} className="brand-bg w-full rounded-full py-4 font-display font-semibold text-white disabled:opacity-60">{busy ? "Sending…" : "Send enquiry"}</button>
    </form>
  );
}
