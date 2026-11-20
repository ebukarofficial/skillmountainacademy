"use client";
// /checkout/: old "Register" links (/checkout/?p=<slug>) and the page Paystack returns to (?ref=...).
// New enrolments start on each programme page, where the same enrolment flow is built in.
import { Suspense, useEffect } from "react";
import Link from "next/link";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import { PROGRAMMES, REMOVED_SLUGS, duration, findProgramme } from "@/lib/config";
import { MessageStrip, SiteFooter, SiteHeader } from "../site-parts";
import { Confirming } from "./server-pay";
import { EnrolmentFlow } from "./flow";

function Checkout() {
  const params = useSearchParams();
  const id = params.get("p");
  const p = findProgramme(id);
  const returnRef = params.get("ref");
  const returnTrx = params.get("trxref") || params.get("reference") || "";
  const removed = !!id && REMOVED_SLUGS.includes(id);
  const router = useRouter();
  // Links to programmes that are no longer offered (see REMOVED_SLUGS) go to the home page with a short notice.
  useEffect(() => { if (removed) router.replace("/?notice=removed"); }, [removed, router]);

  if (removed) return <p className="text-center text-ink/70">This programme is no longer offered. Taking you to our current programmes…</p>;

  if (!p) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="font-(family-name:--font-serif) text-4xl font-medium">Choose a programme</h1>
        <p className="mt-2 text-ink/70">Enrolment begins on each programme&apos;s page, after you have read about the experience and the curriculum.</p>
        <ul className="mt-6">
          {PROGRAMMES.map((x) => (
            <li key={x.slug}><Link href={`/programmes/${x.slug}/`} className="flex items-center justify-between gap-4 border-t border-ink/10 py-4 transition hover:text-brand-red">
              <span><span className="block font-display font-semibold">{x.name}</span><span className="text-sm text-ink/65">{duration(x)}</span></span><span aria-hidden="true">→</span>
            </Link></li>
          ))}
        </ul>
      </div>
    );
  }

  // Back from Paystack: show the confirmation for this order.
  if (returnRef && /^SMA-(BT-)?[A-Z0-9]{12}$/.test(returnRef)) return <Confirming reference={returnRef} trx={returnTrx} p={p} />;

  return <EnrolmentFlow p={p} />;
}

export default function CheckoutPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="min-h-screen overflow-x-clip pb-20">
        <MessageStrip />
        <Script src="https://js.paystack.co/v1/inline.js" strategy="lazyOnload" />
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-6">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-brand-red">Enrolment</p>
          <span className="rounded-full border border-ink/15 px-4 py-1.5 text-sm">🔒 Secure checkout</span>
        </div>
        <div className="px-5">
          <Suspense fallback={<p className="text-center text-ink/70">Loading…</p>}><Checkout /></Suspense>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
