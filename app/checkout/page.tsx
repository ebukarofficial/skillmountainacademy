"use client";
import { Suspense, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { useSearchParams } from "next/navigation";
import logo from "@/assets/sma-logo.png";
import { CFG, DURATIONS, EDUCATION, ENGLISH, GFORM, PROGRAMMES, type Programme } from "@/lib/config";
import { TERMS_VERSION } from "@/lib/terms";
import { BankDetails, CurriculumModal, FOCUS, PHOTO, naira, postForm, postSheet, useRate, usd } from "../components";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { PaystackPop: any } }

type Data = Record<string, string>;
const stripped = (d: Data) => { const { website, ...rest } = d; void website; return rest; };
const newRef = (bank: boolean) => `SMA-${bank ? "BT-" : ""}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

const input = "mt-1 w-full rounded-2xl border border-ink/15 bg-white px-4 py-3.5 text-base outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/40";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block font-medium">{label}{children}</label>;
}
function Text({ label, name, d, type = "text", required = true, auto }: { label: string; name: string; d: Data; type?: string; required?: boolean; auto?: string }) {
  return <Field label={label}><input name={name} type={type} required={required} autoComplete={auto} maxLength={120} defaultValue={d[name] ?? ""} className={input} /></Field>;
}
function Choice({ label, name, options, d, onPick }: { label: string; name: string; options: string[]; d: Data; onPick?: (v: string) => void }) {
  return (
    <fieldset>
      <legend className="font-medium">{label}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map((o, i) => (
          <label key={o} className="cursor-pointer">
            <input type="radio" name={name} value={o} required={i === 0} defaultChecked={d[name] === o} onChange={() => onPick?.(o)} className="peer sr-only" />
            <span className="block rounded-full border border-ink/15 bg-white px-4 py-2.5 text-sm transition peer-checked:border-indigo peer-checked:bg-indigo peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand-orange">{o}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function Pick({ label, name, options, d }: { label: string; name: string; options: string[]; d: Data }) {
  return (
    <Field label={label}>
      <select name={name} required defaultValue={d[name] ?? ""} className={input}>
        <option value="" disabled>Select…</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </Field>
  );
}

function Checkout() {
  const id = useSearchParams().get("p");
  const p = PROGRAMMES.find((x) => x.id === id && x.live);
  const rate = useRate();
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Data>({});
  const [bg, setBg] = useState("");
  const [method, setMethod] = useState<"paystack" | "bank">("paystack");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ ref: string; kind: "paid" | "bank" } | null>(null);
  const [view, setView] = useState(false);

  const top = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const grab = (e: FormEvent<HTMLFormElement>) => ({ ...d, ...(Object.fromEntries(new FormData(e.currentTarget)) as Data) });

  function next1(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = grab(e);
    if (f.adult === "No" && !(f.guardianName?.trim() && f.guardianPhone?.trim())) {
      return setErr("Learners under 18 need a parent or guardian. Please fill in the parent or guardian details.");
    }
    setErr(""); setD(f); setStep(1); top();
  }
  function next2(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(""); setD(grab(e)); setStep(2); top();
  }

  async function submit(prog: Programme) {
    setErr("");
    if (!agreed) return setErr("Please read and accept the Terms and Conditions to continue.");
    const bank = method === "bank";
    if (!bank && (!window.PaystackPop || !CFG.paystackKey)) return setErr("Payment is not ready yet. Refresh the page and try again.");
    if (d.website) { setDone({ ref: newRef(bank), kind: bank ? "bank" : "paid" }); return; } // bot caught by the hidden field: pretend it worked, save nothing
    const reference = newRef(bank);
    const fullName = [d.firstName, d.middleName, d.surname].filter(Boolean).join(" ");
    const terms = `Accepted v${TERMS_VERSION} on ${new Date().toISOString()}`;
    setBusy(true);
    await postForm({ name: fullName, email: d.email, phone: d.phone, programme: prog.name, reference, terms });
    await postSheet({ action: "apply", reference, method: bank ? "Bank transfer" : "Paystack", programme: prog.name, fullName, terms, ...stripped(d) });
    if (bank) { setBusy(false); setDone({ ref: reference, kind: "bank" }); top(); return; }
    window.PaystackPop.setup({
      key: CFG.paystackKey, email: d.email, amount: prog.fee! * 100, currency: "NGN", ref: reference,
      channels: ["card", "bank_transfer"],
      metadata: { programme: prog.name, name: fullName, phone: d.phone },
      callback: () => { postSheet({ action: "verify", reference }); setBusy(false); setDone({ ref: reference, kind: "paid" }); top(); },
      onClose: () => setBusy(false),
    }).openIframe();
  }

  if (!p) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-3xl font-extrabold">Choose a programme to register for</h1>
        <div className="mt-6 grid gap-3">
          {PROGRAMMES.filter((x) => x.live).map((x) => (
            <Link key={x.id} href={`/checkout/?p=${x.id}`} className="flex items-center justify-between gap-4 rounded-2xl bg-paper px-5 py-4 transition hover:shadow-lg">
              <span className="font-display font-bold">{x.name}</span><span className="font-display font-extrabold">{naira(x.fee!)}</span>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const fullName = [d.firstName, d.middleName, d.surname].filter(Boolean).join(" ");

  if (done) {
    const msg = `Hello Skill Mountain Academy, I have paid ${naira(p.fee!)} for ${p.name}. Name: ${fullName}. Reference: ${done.ref}. I am sending my teller.`;
    return (
      <div className="mx-auto max-w-xl rounded-[2rem] bg-paper p-6 shadow-xl shadow-indigo/10 sm:p-8">
        <span className="brand-bg mx-auto grid h-16 w-16 place-items-center rounded-full text-3xl text-white">✓</span>
        {done.kind === "paid" ? (
          <>
            <h1 className="mt-5 text-center font-display text-3xl font-extrabold brand-text">Payment received</h1>
            <p className="mt-3 text-center text-ink/75">Thank you, {d.firstName}. We are confirming your payment for <b>{p.name}</b> with Paystack. Your welcome email is on its way to <b>{d.email}</b>. It has your curriculum link and a link to book your class days and times.</p>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-center font-display text-3xl font-extrabold brand-text">Application received</h1>
            <p className="mt-3 text-center text-ink/75">Thank you, {d.firstName}. Your place for <b>{p.name}</b> is reserved once we confirm your payment. Please pay the fee of <b>{naira(p.fee!)}</b> to the account below and send us your teller.</p>
            <div className="mt-5"><BankDetails /></div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <a href={`https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" className="brand-bg rounded-full py-3 text-center font-display font-semibold text-white">Send teller on WhatsApp</a>
              <a href={`mailto:admission@skillmountainacademy.com?subject=${encodeURIComponent(`Teller: ${done.ref}`)}&body=${encodeURIComponent(msg)}`} className="rounded-full border-2 border-indigo py-3 text-center font-display font-semibold text-indigo">Send teller by email</a>
            </div>
            <p className="mt-3 text-center text-sm text-ink/70">When we confirm your payment, we email your welcome message with your curriculum and your booking link.</p>
          </>
        )}
        <p className="mt-5 rounded-2xl bg-cream px-4 py-3 text-center text-sm">Your reference: <b>{done.ref}</b></p>
        <p className="mt-3 text-center text-sm text-ink/70">Check your spam folder if you do not see our email.</p>
        <div className="mt-5 text-center"><Link href="/" className="brand-bg inline-block rounded-full px-8 py-3 font-display font-semibold text-white">Back to home</Link></div>
      </div>
    );
  }

  const labels = ["Your details", "About your goals", "Payment"];
  return (
    <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1.15fr_.85fr]">
      <div className="rounded-[2rem] bg-paper p-6 shadow-xl shadow-indigo/10 sm:p-8">
        <ol className="mb-6 flex gap-2" aria-label="Progress">
          {labels.map((l, i) => (
            <li key={l} className={`flex-1 rounded-full px-3 py-2 text-center text-xs font-semibold sm:text-sm ${i === step ? "brand-bg text-white" : i < step ? "bg-indigo text-white" : "bg-cream text-ink/70"}`}>{i + 1}. {l}</li>
          ))}
        </ol>

        {step === 0 && (
          <form onSubmit={next1} className="space-y-4">
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Leave this empty<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
            <h1 className="font-display text-2xl font-extrabold">Application form</h1>
            <p className="text-sm text-ink/70">For: <b>{p.name}</b>. Please fill in the learner&apos;s details.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Text label="First name" name="firstName" d={d} auto="given-name" />
              <Text label="Middle name" name="middleName" d={d} required={false} />
              <Text label="Surname" name="surname" d={d} auto="family-name" />
            </div>
            <Choice label="Is the learner 18 years or older?" name="adult" options={["Yes", "No"]} d={d} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Text label="Country" name="country" d={d} auto="country-name" />
              <Text label="City or state" name="city" d={d} auto="address-level1" />
            </div>
            <Pick label="English proficiency" name="english" options={ENGLISH} d={d} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Text label="Phone or WhatsApp number" name="phone" type="tel" d={d} auto="tel" />
              <Text label="Email address" name="email" type="email" d={d} auto="email" />
            </div>
            <Choice label="Educational level" name="education" options={EDUCATION} d={d} />
            <Choice label="Preferred programme duration" name="duration" options={DURATIONS} d={d} />
            <div className="rounded-2xl bg-cream p-4">
              <p className="font-display font-bold">Parent or guardian</p>
              <p className="text-sm text-ink/70">Required only if the learner is under 18. Leave blank if the learner is 18 or older.</p>
              <div className="mt-3 space-y-4">
                <Text label="Full name" name="guardianName" d={d} required={false} />
                <Text label="Phone number(s)" name="guardianPhone" type="tel" d={d} required={false} />
              </div>
            </div>
            {err && <p role="alert" className="font-medium text-brand-red">{err}</p>}
            <button className="brand-bg w-full rounded-full py-4 font-display font-semibold text-white">Continue</button>
          </form>
        )}

        {step === 1 && (
          <form onSubmit={next2} className="space-y-4">
            <h1 className="font-display text-2xl font-extrabold">A few questions</h1>
            <p className="text-sm text-ink/70">This helps your mentor plan your learning from day one.</p>
            <Choice label="Are you computer literate?" name="computerLiterate" options={["Yes", "No"]} d={d} />
            <div className="rounded-2xl bg-cream px-4 py-3 text-sm">Skill of interest: <b>{p.name}</b></div>
            <Choice label="Any background knowledge on this skill?" name="background" options={["Yes", "No"]} d={d} onPick={setBg} />
            {(bg || d.background) === "Yes" && (
              <Field label="Where did you get the knowledge, and for how long?"><textarea name="backgroundDetail" required rows={2} maxLength={500} defaultValue={d.backgroundDetail ?? ""} className={input} /></Field>
            )}
            <Field label="Why choose this skill?"><textarea name="why" required rows={2} maxLength={500} defaultValue={d.why ?? ""} className={input} /></Field>
            <Field label="What are your goals and aspirations?"><textarea name="goals" required rows={3} maxLength={800} defaultValue={d.goals ?? ""} className={input} /></Field>
            <Text label="Which industry would you like to work in after acquiring the skill?" name="industry" d={d} />
            <div className="flex gap-3">
              <button type="button" onClick={() => { setStep(0); top(); }} className="rounded-full border-2 border-indigo px-6 py-3.5 font-display font-semibold text-indigo">Back</button>
              <button className="brand-bg flex-1 rounded-full py-3.5 font-display font-semibold text-white">Continue</button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h1 className="font-display text-2xl font-extrabold">Review and pay</h1>
            <div className="rounded-2xl bg-cream p-4 text-sm">
              <p><b>{fullName}</b> · {d.email} · {d.phone}</p>
              <p className="text-ink/70">{p.name} · {d.duration} · {d.education}</p>
              <button type="button" onClick={() => { setStep(0); top(); }} className="mt-1 font-semibold text-brand-red underline">Edit my details</button>
            </div>

            <fieldset>
              <legend className="font-display font-bold">How would you like to pay?</legend>
              <div className="mt-2 grid gap-3">
                {([["paystack", "Pay online with Paystack", "Card or bank transfer. Confirmed automatically."], ["bank", "Bank transfer", "Pay to our UBA account, then send us your teller."]] as const).map(([v, t, s]) => (
                  <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 px-4 py-3 transition ${method === v ? "border-indigo bg-white" : "border-transparent bg-cream"}`}>
                    <input type="radio" name="method" checked={method === v} onChange={() => setMethod(v)} className="mt-1 h-5 w-5 accent-[#1e0e6f]" />
                    <span><span className="block font-display font-bold">{t}</span><span className="text-sm text-ink/70">{s}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>

            {method === "bank" && <BankDetails />}

            <label className="flex items-start gap-3 rounded-2xl bg-cream px-4 py-3 text-sm">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#c8233a]" />
              <span>I have read and understood the <Link href="/terms/" target="_blank" className="font-semibold text-brand-red underline">Terms and Conditions</Link>, <Link href="/refunds/" target="_blank" className="font-semibold text-brand-red underline">Refund Policy</Link> and <Link href="/privacy/" target="_blank" className="font-semibold text-brand-red underline">Privacy Policy</Link>. I confirm the details are correct and I agree to SMA using them to process this registration. If the learner is under 18, I am their parent or guardian and I give this consent for them.</span>
            </label>
            {!GFORM.url && <p className="rounded-xl bg-brand-orange/20 px-4 py-2 text-sm">Setup note: the Google Form is not connected yet, so registrations will not be saved.</p>}
            {err && <p role="alert" className="font-medium text-brand-red">{err}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => { setStep(1); top(); }} className="rounded-full border-2 border-indigo px-6 py-4 font-display font-semibold text-indigo">Back</button>
              <button type="button" disabled={busy || !agreed} onClick={() => submit(p)} className="brand-bg flex-1 rounded-full py-4 font-display font-semibold text-white disabled:opacity-60">
                {busy ? "Please wait…" : method === "bank" ? "Submit application" : `Pay ${naira(p.fee!)} with Paystack`}
              </button>
            </div>
            {!agreed && <p className="text-center text-sm text-ink/70">Tick the box above to continue.</p>}
          </div>
        )}
      </div>

      <aside className="h-fit rounded-[2rem] bg-indigo p-6 text-white shadow-xl shadow-indigo/20 sm:p-8">
        <p className="text-sm font-medium text-white/60">Your order</p>
        <div className="mt-4 flex gap-4">
          <div className={`relative h-24 w-20 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br ${p.tone}`}>
            <Image src={PHOTO[p.id]} alt="" fill sizes="80px" className="object-cover" style={{ objectPosition: FOCUS[p.id] }} />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold">{p.name}</h2>
            <p className="text-white/70">{p.months ? `${p.months} months · ` : ""}one-on-one mentorship</p>
            <button type="button" onClick={() => setView(true)} className="mt-2 text-sm font-semibold text-brand-orange underline">View curriculum</button>
          </div>
        </div>
        <div className="mt-6 space-y-2 border-t border-white/15 pt-5">
          {p.was && <div className="flex justify-between text-white/70"><span>Original price</span><s>{naira(p.was)}</s></div>}
          {p.was && <div className="flex justify-between text-brand-orange"><span>You save</span><span>{naira(p.was - p.fee!)}</span></div>}
          <div className="flex items-end justify-between pt-2"><span className="text-white/80">Total</span><span className="font-display text-3xl font-extrabold">{naira(p.fee!)}</span></div>
          <p className="text-right text-sm text-white/70">≈ {usd(p.fee!, rate)} · discounted price for you</p>
          <p className="text-right text-xs text-white/60">Dollar amount is approximate. You pay in naira (₦).</p>
        </div>
        <ul className="mt-6 space-y-2 text-sm text-white/75">
          <li>✓ Pay with Paystack or by bank transfer</li>
          <li>✓ Welcome email with your curriculum</li>
          <li>✓ A link to book your class days and times</li>
        </ul>
        <Link href="/#programmes" className="mt-6 inline-block text-sm text-white/70 underline hover:text-white">Choose a different programme</Link>
      </aside>
      {view && <CurriculumModal p={p} onClose={() => setView(false)} />}
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <main className="min-h-screen overflow-x-clip pb-16">
      <Script src="https://js.paystack.co/v1/inline.js" strategy="lazyOnload" />
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Link href="/" aria-label="Skill Mountain Academy home"><Image src={logo} alt="Skill Mountain Academy" priority unoptimized className="h-10 w-auto sm:h-12" /></Link>
        <span className="rounded-full bg-paper px-4 py-1.5 text-sm font-medium">🔒 Secure checkout</span>
      </header>
      <div className="px-5 pt-4">
        <Suspense fallback={<p className="text-center text-ink/70">Loading checkout…</p>}><Checkout /></Suspense>
      </div>
    </main>
  );
}
