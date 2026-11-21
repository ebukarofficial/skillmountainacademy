"use client";
// The instructor's faculty profile: completed during onboarding and submitted for verification, editable afterwards.
import { useState } from "react";
import type { Me } from "./page";
import { api, Avatar, Btn, Card, Field, inputCls, Msg, upload, useAction, useLoad, VerifiedBadge } from "./ui";

type Cert = { title: string; issuer: string; year: string; url: string };
type Checklist = { items: { key: string; label: string; done: boolean }[]; complete: boolean; verification: string; submittedAt: string | null };
const blankCert = (): Cert => ({ title: "", issuer: "", year: "", url: "" });
const SOCIAL: [string, string, string][] = [["linkedin", "LinkedIn", "https://www.linkedin.com/in/…"], ["x", "X (Twitter)", "https://x.com/…"], ["facebook", "Facebook", "https://www.facebook.com/…"], ["portfolio", "Portfolio or website", "https://…"]];

export function InstructorProfileForm({ me, onboarding }: { me: Me; onboarding: boolean }) {
  const list = useLoad<Checklist>(onboarding ? "/api/app/instructor/onboarding" : null);
  const { busy, msg, run } = useAction();
  const [certs, setCerts] = useState<Cert[]>(() => (me.certifications?.length ? me.certifications.map((c) => ({ title: c.title, issuer: c.issuer ?? "", year: c.year ?? "", url: c.url ?? "" })) : [blankCert()]));
  const [photo, setPhoto] = useState(me.photo);
  const reload = () => window.location.reload();

  function body(form: HTMLFormElement) {
    const f = new FormData(form);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const lines = (k: string) => s(k).split("\n").map((x) => x.trim()).filter(Boolean);
    return {
      fullName: s("fullName"), phone: s("phone"), headline: s("headline"), bio: s("bio"), specialization: s("specialization"),
      countryOrigin: s("countryOrigin"), countryResidence: s("countryResidence"),
      languages: s("languages").split(",").map((x) => x.trim()).filter(Boolean),
      achievements: lines("achievements"),
      links: { ...me.links, ...Object.fromEntries(SOCIAL.map(([k]) => [k, s(`link-${k}`)])) },
      certifications: certs.filter((c) => c.title || c.url),
    };
  }
  const submitted = !!me.profileSubmittedAt;

  return (
    <form className="space-y-5" onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const send = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "submit";
      run(async () => {
        await api("/api/me", { method: "PATCH", body: body(form) });
        if (send) await api("/api/app/instructor/onboarding/submit", { method: "POST" });
      }, send ? "Submitted. The Academy will review your profile and email you when it is verified." : "Saved.", () => { if (send) setTimeout(reload, 1200); else list.reload(); });
    }}>
      {onboarding && list.data && (
        <Card title="Your onboarding checklist">
          <ul className="grid gap-2 sm:grid-cols-2">
            {list.data.items.map((i) => (
              <li key={i.key} className="flex items-start gap-2 text-sm"><span aria-hidden="true" className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[0.7rem] font-bold ${i.done ? "bg-indigo text-white" : "border border-ink/20 text-transparent"}`}>✓</span><span className={i.done ? "text-ink/55 line-through decoration-ink/20" : ""}>{i.label}</span><span className="sr-only">{i.done ? "(done)" : "(to do)"}</span></li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.6fr]">
        <Card title="Profile photo">
          <div className="flex flex-col items-center text-center">
            <Avatar src={photo} name={me.fullName} size={132} />
            <p className="mt-3 text-xs text-ink/60">A clear, passport-style photo: face the camera, plain background, no hats or sunglasses. PNG, JPG or WebP, up to 3 MB.</p>
            <label className="mt-3 inline-flex cursor-pointer items-center rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-semibold hover:border-indigo/40">
              {photo ? "Replace photo" : "Upload photo"}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) run(async () => { await upload("/api/me/photo", file); setPhoto(`/api/app/files/photo/${me.id}?v=${Date.now()}`); list.reload(); }, "Photo uploaded."); }} />
            </label>
          </div>
        </Card>
        <Card title="About you">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name"><input name="fullName" required defaultValue={me.fullName} className={inputCls} /></Field>
            <Field label="Phone or WhatsApp"><input name="phone" defaultValue={me.phone ?? ""} className={inputCls} /></Field>
            <div className="sm:col-span-2"><Field label="Professional citation (one line shown under your name)"><input name="headline" maxLength={160} defaultValue={me.headline ?? ""} placeholder="e.g. Cloud architect, 12 years in banking and fintech" className={inputCls} /></Field></div>
            <div className="sm:col-span-2"><Field label="Biography (at least 80 characters)"><textarea name="bio" rows={5} maxLength={1500} defaultValue={me.bio ?? ""} className={inputCls} /></Field></div>
            <Field label="Discipline / specialisation"><input name="specialization" defaultValue={me.specialization ?? ""} className={inputCls} /></Field>
            <Field label="Languages you speak (comma-separated)"><input name="languages" defaultValue={(me.languages ?? []).join(", ")} placeholder="English, French" className={inputCls} /></Field>
            <Field label="Country of origin"><input name="countryOrigin" defaultValue={me.countryOrigin ?? ""} className={inputCls} /></Field>
            <Field label="Country of residence"><input name="countryResidence" defaultValue={me.countryResidence ?? ""} className={inputCls} /></Field>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Online presence">
          <div className="space-y-4">{SOCIAL.map(([k, label, ph]) => <Field key={k} label={label}><input name={`link-${k}`} type="url" defaultValue={me.links[k] ?? ""} placeholder={ph} className={inputCls} /></Field>)}</div>
        </Card>
        <Card title="Achievements">
          <Field label="One achievement per line"><textarea name="achievements" rows={8} defaultValue={(me.achievements ?? []).join("\n")} placeholder={"Led the redesign of a national banking app\nSpeaker, DevFest 2024"} className={inputCls} /></Field>
        </Card>
      </div>

      <Card title="Certifications" action={<Btn small kind="ghost" onClick={() => setCerts([...certs, blankCert()])}>+ Add another</Btn>}>
        <p className="mb-4 text-sm text-ink/60">Add the public verification link for each certificate (for example Credly, Coursera, Microsoft Learn, AWS or your institution&apos;s register), so the Academy can check it.</p>
        <div className="space-y-4">
          {certs.map((c, i) => (
            <div key={i} className="grid gap-3 rounded-xl border border-ink/[0.07] p-4 sm:grid-cols-[2fr_1.4fr_0.7fr]">
              <Field label="Certificate"><input value={c.title} onChange={(e) => setCerts(certs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className={inputCls} /></Field>
              <Field label="Issued by"><input value={c.issuer} onChange={(e) => setCerts(certs.map((x, j) => (j === i ? { ...x, issuer: e.target.value } : x)))} className={inputCls} /></Field>
              <Field label="Year"><input value={c.year} inputMode="numeric" maxLength={4} onChange={(e) => setCerts(certs.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)))} className={inputCls} /></Field>
              <div className="sm:col-span-3 flex items-end gap-3">
                <div className="flex-1"><Field label="Verification link (https://…)"><input type="url" value={c.url} onChange={(e) => setCerts(certs.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} className={inputCls} /></Field></div>
                {certs.length > 1 && <Btn small kind="ghost" onClick={() => setCerts(certs.filter((_, j) => j !== i))}>Remove</Btn>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-3 rounded-2xl border border-ink/[0.07] bg-white/95 p-4 shadow-lg shadow-ink/5 backdrop-blur">
        <Btn type="submit" kind="ghost" disabled={busy}>Save</Btn>
        {onboarding && <button type="submit" value="submit" disabled={busy} className="rounded-lg bg-indigo px-5 py-2.5 font-display text-sm font-semibold text-white shadow-lg shadow-indigo/20 transition hover:bg-navy disabled:opacity-60">{submitted ? "Save and resubmit for verification" : "Submit for verification"}</button>}
        {me.verified && <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo"><VerifiedBadge /> Verified by the Academy</span>}
        <div className="w-full"><Msg text={msg.text} kind={msg.kind} /></div>
      </div>
    </form>
  );
}
