"use client";
// Section 9 of a programme page: the enrolment flow, built into the page. It opens from any "Proceed to
// enrolment" link (href="#enrol") or its own button, so a visitor never leaves the programme page to enrol.
import { useEffect, useState } from "react";
import Script from "next/script";
import type { Programme } from "@/lib/config";
import { EnrolmentFlow } from "../../checkout/flow";
import { useAdmission } from "../../admissions-status";

export function EnrolSection({ p }: { p: Programme }) {
  const [open, setOpen] = useState(false);
  const adm = useAdmission(p.slug);
  useEffect(() => {
    const check = () => { if (window.location.hash === "#enrol") setOpen(true); };
    const t = setTimeout(check, 0);
    window.addEventListener("hashchange", check);
    return () => { clearTimeout(t); window.removeEventListener("hashchange", check); };
  }, []);
  return (
    <div>
      {open && <Script src="https://js.paystack.co/v1/inline.js" strategy="afterInteractive" />}
      {open ? <EnrolmentFlow p={p} embedded /> : (
        <div className="rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
          <p className="text-lg text-ink/75">{adm.canEnrol ? "The enrolment form takes about five minutes: your details, a few questions about your goals, then payment." : adm.detail}</p>
          {adm.canEnrol && (
            <button type="button" onClick={() => { setOpen(true); history.replaceState(null, "", "#enrol"); }} className="mt-5 inline-flex items-center gap-2 rounded-full bg-indigo px-8 py-4 font-display text-sm font-semibold tracking-wide text-cream transition hover:bg-navy">Proceed to enrolment</button>
          )}
        </div>
      )}
    </div>
  );
}
