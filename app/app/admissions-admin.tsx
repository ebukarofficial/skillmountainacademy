"use client";
// Admin: admissions periods, programme capacity and instructor recruitment. Capacity figures appear only here.
import { useState } from "react";
import { PROGRAMMES } from "@/lib/config";
import { CHECKS, QUALIFICATION_LEVELS, REQUIRED_CHECKS, VERIFICATION, VERIFICATION_LABEL, type Verification } from "@/lib/admissions";
import { api, Badge, Btn, Card, Empty, Field, inputCls, Msg, useAction, useLoad, when } from "./ui";

type Cap = { total: number; enrolled: number; reserved: number; available: number; utilisation: number | null; full: boolean };
type Assign = { instructor_id: string; full_name: string; email: string; max_students: number | null; verification: string | null; status: string; students: number };
type Prog = { slug: string; name: string; setting: { mode: "open" | "scheduled" | "closed"; enforce_capacity: number; reserved: number; default_instructor_cap: number; listed: number }; status: { state: string; opensAt?: string; closesAt?: string }; capacity: Cap; assignments: Assign[] };
type Period = { id: string; programme_slug: string | null; label: string | null; opens_at: string; closes_at: string; cancelled_at: string | null };

const pname = (slug: string | null) => (slug ? PROGRAMMES.find((p) => p.slug === slug)?.name ?? slug : "All programmes");
const counts = (a: Assign) => a.status === "active" && (a.verification === null || a.verification === "approved");

export function AdmissionsAdmin() {
  const { data, error, reload } = useLoad<{ programmes: Prog[]; periods: Period[] }>("/api/app/admin/admissions");
  const approved = useLoad<{ candidates: { id: string; fullName: string; status: string }[] }>("/api/app/admin/recruitment?stage=approved");
  const { busy, msg, run } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const patch = (slug: string, body: Record<string, unknown>) => run(() => api(`/api/app/admin/admissions/${slug}`, { method: "PATCH", body }), "Saved.", reload);
  if (error) return <Card><Msg text={error} /></Card>;
  return (
    <div className="space-y-5">
      <Card title="Programme admissions and capacity">
        <p className="mb-4 text-sm text-ink/65">Visitors see only &ldquo;Admissions open&rdquo;, &ldquo;Opening soon&rdquo;, &ldquo;Applications closed&rdquo; or &ldquo;Fully subscribed&rdquo;. Capacity counts approved, active instructors assigned to a programme. With the limit on, a full programme stops taking new registrations and payments.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink/60"><th className="py-1">Programme</th><th>Public status</th><th>Mode</th><th className="pl-3 text-right">Capacity</th><th className="pl-3 text-right">Enrolled</th><th className="pl-3 text-right">Reserved</th><th className="text-right">Available</th><th className="pl-4">Use</th><th className="pl-3">Limit</th><th /></tr></thead>
            <tbody>
              {data?.programmes.map((p) => (
                <tr key={p.slug} className="border-t border-ink/10 align-top">
                  <td className="py-2.5"><b>{p.name}</b>{!p.setting.listed && <span className="block text-xs text-ink/55">Hidden from listings</span>}</td>
                  <td className="py-2.5"><Badge s={p.status.state} />{p.status.opensAt && <span className="block text-xs text-ink/55">opens {when(p.status.opensAt)}</span>}{p.status.closesAt && <span className="block text-xs text-ink/55">closes {when(p.status.closesAt)}</span>}</td>
                  <td className="py-2.5"><select aria-label={`Admissions mode for ${p.name}`} value={p.setting.mode} disabled={busy} onChange={(e) => patch(p.slug, { mode: e.target.value })} className="rounded-md border border-ink/15 px-2 py-1"><option value="open">Open</option><option value="scheduled">By admission period</option><option value="closed">Closed</option></select></td>
                  <td className="py-2.5 text-right">{p.capacity.total}</td>
                  <td className="py-2.5 text-right">{p.capacity.enrolled}</td>
                  <td className="py-2.5 text-right">{p.capacity.reserved}</td>
                  <td className={`py-2.5 text-right font-bold ${p.capacity.full ? "text-brand-red" : ""}`}>{p.capacity.available}</td>
                  <td className="py-2.5 pl-4">{p.capacity.utilisation === null ? "n/a" : `${Math.round(p.capacity.utilisation * 100)}%`}</td>
                  <td className="py-2.5 pl-3"><label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!p.setting.enforce_capacity} disabled={busy} onChange={(e) => patch(p.slug, { enforceCapacity: e.target.checked })} /><span className="text-xs">{p.setting.enforce_capacity ? "On" : "Off"}</span></label></td>
                  <td className="py-2.5 text-right"><Btn small kind="ghost" onClick={() => setOpen(open === p.slug ? null : p.slug)}>{open === p.slug ? "Close" : "Manage"}</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Msg text={msg.text} kind={msg.kind} />
      </Card>

      {data?.programmes.filter((p) => p.slug === open).map((p) => (
        <Card key={p.slug} title={`${p.name}: capacity`}>
          <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); patch(p.slug, { defaultInstructorCap: Number(f.get("cap")), reserved: Number(f.get("reserved")), listed: f.get("listed") === "on" }); }}>
              <Field label="Students per instructor (default for this programme)"><input name="cap" type="number" min={1} max={500} defaultValue={p.setting.default_instructor_cap} className={inputCls} /></Field>
              <Field label="Reserved places (held back, not offered publicly)"><input name="reserved" type="number" min={0} defaultValue={p.setting.reserved} className={inputCls} /></Field>
              <label className="flex items-center gap-2 text-sm"><input name="listed" type="checkbox" defaultChecked={!!p.setting.listed} /> Show in programme listings</label>
              <Btn type="submit" disabled={busy}>Save</Btn>
              {p.capacity.full && p.setting.enforce_capacity ? <p className="text-sm font-semibold text-brand-red">Fully subscribed: new registrations and payments are refused. Assign more approved instructors or raise their limits to reopen places.</p> : null}
            </form>
            <div>
              <h3 className="font-display text-sm font-bold">Instructors assigned</h3>
              {!p.assignments.length && <Empty>No instructors assigned to this programme yet.</Empty>}
              <ul className="mt-2 divide-y divide-ink/10 text-sm">
                {p.assignments.map((a) => (
                  <li key={a.instructor_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><b>{a.full_name}</b> <span className="text-xs text-ink/55">{a.students} student(s)</span>{!counts(a) && <span className="ml-2"><Badge s={a.verification ?? a.status} /></span>}</span>
                    <span className="flex items-center gap-2">
                      <input aria-label={`Maximum students for ${a.full_name}`} type="number" min={0} max={500} defaultValue={a.max_students ?? ""} placeholder={String(p.setting.default_instructor_cap)} className="w-20 rounded-md border border-ink/15 px-2 py-1"
                        onBlur={(e) => { const v = e.target.value; if (v !== String(a.max_students ?? "")) run(() => api(`/api/app/admin/instructors/${a.instructor_id}/programmes/${p.slug}`, { method: "PUT", body: { maxStudents: v === "" ? null : Number(v) } }), "Limit saved.", reload); }} />
                      <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api(`/api/app/admin/instructors/${a.instructor_id}/programmes/${p.slug}`, { method: "DELETE" }), "Removed.", reload)}>Remove</Btn>
                    </span>
                  </li>
                ))}
              </ul>
              <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const id = String(f.get("ins")); if (!id) return; const max = String(f.get("max") || ""); run(() => api(`/api/app/admin/instructors/${id}/programmes/${p.slug}`, { method: "PUT", body: { maxStudents: max === "" ? null : Number(max) } }), "Instructor assigned.", reload); }}>
                <select name="ins" aria-label="Approved instructor" className="min-w-0 flex-1 rounded-md border border-ink/15 px-2 py-1.5 text-sm"><option value="">Assign an approved instructor…</option>{approved.data?.candidates.filter((c) => c.status === "active" && !p.assignments.some((a) => a.instructor_id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}</select>
                <input name="max" type="number" min={0} max={500} placeholder={`max (${p.setting.default_instructor_cap})`} aria-label="Maximum students" className="w-28 rounded-md border border-ink/15 px-2 py-1.5 text-sm" />
                <Btn type="submit" small disabled={busy}>Assign</Btn>
              </form>
            </div>
          </div>
        </Card>
      ))}

      <Card title="Admission periods">
        <p className="mb-3 text-sm text-ink/65">Periods apply to programmes whose mode is &ldquo;By admission period&rdquo;. A period for all programmes applies to each of them. Times are in Lagos time.</p>
        <ul className="divide-y divide-ink/10 text-sm">
          {data?.periods.map((pe) => (
            <li key={pe.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><b>{pe.label || "Admission period"}</b> · {pname(pe.programme_slug)}<span className="block text-xs text-ink/60">{when(pe.opens_at)} to {when(pe.closes_at)}</span></span>
              {pe.cancelled_at ? <Badge s="cancelled" /> : <Btn small kind="ghost" disabled={busy} onClick={() => run(() => api(`/api/app/admin/admissions/periods/${pe.id}`, { method: "DELETE" }), "Period cancelled.", reload)}>Cancel</Btn>}
            </li>
          ))}
          {data && !data.periods.length && <li className="py-2"><Empty>No current or upcoming periods.</Empty></li>}
        </ul>
        <form className="mt-4 grid gap-3 sm:grid-cols-5" onSubmit={(e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget;
          const lagos = (v: FormDataEntryValue | null) => (v ? `${v}:00+01:00` : "");
          run(() => api("/api/app/admin/admissions/periods", { method: "POST", body: { label: f.get("label"), programme: f.get("programme") || null, opensAt: lagos(f.get("opens")), closesAt: lagos(f.get("closes")) } }), "Period added.", () => { form.reset(); reload(); });
        }}>
          <Field label="Label"><input name="label" placeholder="e.g. January intake" className={inputCls} /></Field>
          <Field label="Programme"><select name="programme" className={inputCls}><option value="">All programmes</option>{PROGRAMMES.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></Field>
          <Field label="Opens"><input name="opens" type="datetime-local" required className={inputCls} /></Field>
          <Field label="Closes"><input name="closes" type="datetime-local" required className={inputCls} /></Field>
          <div className="self-end"><Btn type="submit" disabled={busy}>Add period</Btn></div>
        </form>
      </Card>
    </div>
  );
}

type Check = { done: boolean; note: string | null; at: string | null };
type Cand = { id: string; email: string; fullName: string; phone: string | null; status: string; verification: Verification; checks: Partial<Record<string, Check>>; highestQualification: string | null; qualifications: string[]; experience: string | null; specialization: string | null; publicProfile: boolean; createdAt: string; programmes?: { slug: string; maxStudents: number | null }[] };

export function RecruitmentAdmin() {
  const [stage, setStage] = useState("");
  const { data, reload } = useLoad<{ candidates: Cand[] }>(`/api/app/admin/recruitment${stage ? `?stage=${stage}` : ""}`);
  const [sel, setSel] = useState<string | null>(null);
  const { busy, msg, run } = useAction();
  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_1.4fr]">
      <div className="space-y-5">
        <Card title="Instructor candidates" action={<select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)} className="rounded-md border border-ink/15 px-2 py-1 text-sm"><option value="">All stages</option>{VERIFICATION.map((v) => <option key={v} value={v}>{VERIFICATION_LABEL[v]}</option>)}</select>}>
          <ul className="divide-y divide-ink/10 text-sm">
            {data?.candidates.map((c) => (
              <li key={c.id}><button type="button" onClick={() => setSel(c.id)} className={`flex w-full items-center justify-between gap-2 py-2.5 text-left ${sel === c.id ? "text-brand-red" : ""}`}>
                <span><b>{c.fullName}</b><span className="block text-xs text-ink/55">{c.specialization || c.email}</span></span><Badge s={c.verification} />
              </button></li>
            ))}
            {data && !data.candidates.length && <li className="py-2"><Empty>No candidates at this stage.</Empty></li>}
          </ul>
        </Card>
        <Card title="Add a candidate">
          <p className="mb-3 text-sm text-ink/65">Candidates cannot sign in or teach until approved. Approval sends their sign-in invitation.</p>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); const form = e.currentTarget; run(() => api<{ user: { id: string } }>("/api/app/admin/users", { method: "POST", body: { ...f, role: "instructor", sendInvite: false } }).then((r) => setSel(r.user.id)), "Candidate added.", () => { form.reset(); reload(); }); }}>
            <Field label="Full name"><input name="fullName" required className={inputCls} /></Field>
            <Field label="Email"><input name="email" type="email" required className={inputCls} /></Field>
            <Field label="Phone (optional)"><input name="phone" className={inputCls} /></Field>
            <Field label="Discipline / specialisation"><input name="specialization" className={inputCls} /></Field>
            <Btn type="submit" disabled={busy}>Add candidate</Btn>
          </form>
          <Msg text={msg.text} kind={msg.kind} />
        </Card>
      </div>
      {sel ? <Candidate key={sel} id={sel} onChange={reload} /> : <Card><Empty>Select a candidate to review their verification.</Empty></Card>}
    </div>
  );
}

function Candidate({ id, onChange }: { id: string; onChange: () => void }) {
  const { data, reload } = useLoad<{ candidate: Cand }>(`/api/app/admin/recruitment/${id}`);
  const { busy, msg, run } = useAction();
  const c = data?.candidate;
  if (!c) return <Card><Empty>Loading…</Empty></Card>;
  const save = (body: Record<string, unknown>, ok = "Saved.") => run(() => api(`/api/app/admin/recruitment/${id}`, { method: "PATCH", body }), ok, () => { reload(); onChange(); });
  const missing = REQUIRED_CHECKS.filter((k) => !c.checks[k]?.done);
  return (
    <Card title={c.fullName} action={<Badge s={c.verification} />}>
      <p className="text-sm text-ink/65">{c.email}{c.phone ? ` · ${c.phone}` : ""} · added {when(c.createdAt)}</p>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); save({ highestQualification: f.get("hq") || null, experience: f.get("exp") }); }}>
        <Field label="Highest qualification or standing"><select name="hq" defaultValue={c.highestQualification ?? ""} className={inputCls}><option value="">Not recorded</option>{QUALIFICATION_LEVELS.map((q) => <option key={q}>{q}</option>)}</select></Field>
        <Field label="Professional experience (internal notes)"><textarea name="exp" rows={2} defaultValue={c.experience ?? ""} className={inputCls} /></Field>
        <div className="sm:col-span-2"><Btn type="submit" small disabled={busy}>Save details</Btn></div>
      </form>

      <h3 className="mt-6 font-display text-sm font-bold">Verification checks</h3>
      <p className="text-xs text-ink/55">Required before approval: {REQUIRED_CHECKS.map((k) => CHECKS.find(([x]) => x === k)![1].toLowerCase()).join("; ")}.</p>
      <ul className="mt-2 divide-y divide-ink/10 text-sm">
        {CHECKS.map(([k, label]) => {
          const ch = c.checks[k];
          return (
            <li key={k} className="flex flex-wrap items-center gap-3 py-2">
              <label className="flex flex-1 items-center gap-2"><input type="checkbox" checked={!!ch?.done} disabled={busy} onChange={(e) => save({ checks: { [k]: { done: e.target.checked, note: ch?.note ?? null } } })} />{label}{REQUIRED_CHECKS.includes(k) && <span className="text-xs text-brand-red">required</span>}</label>
              <input aria-label={`Note: ${label}`} defaultValue={ch?.note ?? ""} placeholder="Note (e.g. score, reference)" className="w-56 rounded-md border border-ink/15 px-2 py-1 text-xs" onBlur={(e) => { if ((ch?.note ?? "") !== e.target.value) save({ checks: { [k]: { done: !!ch?.done, note: e.target.value } } }, "Note saved."); }} />
              {ch?.done && ch.at && <span className="text-xs text-ink/50">{when(ch.at)}</span>}
            </li>
          );
        })}
      </ul>

      <h3 className="mt-6 font-display text-sm font-bold">Stage</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {VERIFICATION.filter((v) => v !== c.verification).map((v) => (
          <Btn key={v} small kind={v === "approved" ? "primary" : "ghost"} disabled={busy || (v === "approved" && missing.length > 0)} onClick={() => save({ stage: v }, v === "approved" ? "Approved. Their sign-in invitation is on its way." : `Moved to ${VERIFICATION_LABEL[v]}.`)}>{VERIFICATION_LABEL[v]}</Btn>
        ))}
      </div>
      {c.verification !== "approved" && missing.length > 0 && <p className="mt-2 text-xs text-ink/55">Approval unlocks once the required checks are recorded.</p>}

      {c.verification === "approved" && (
        <label className="mt-6 flex items-start gap-2 text-sm"><input type="checkbox" checked={c.publicProfile} disabled={busy} onChange={(e) => save({ publicProfile: e.target.checked })} className="mt-1" /><span>Show on the public Faculty page (name, photo, specialisation, biography, qualifications and links from their profile; never email or phone). Turn this on only with the instructor&apos;s agreement.</span></label>
      )}
      {c.programmes && c.programmes.length > 0 && <p className="mt-4 text-sm text-ink/65">Teaching: {c.programmes.map((p) => pname(p.slug)).join(", ")}. Manage limits in Admissions.</p>}
      <Msg text={msg.text} kind={msg.kind} />
    </Card>
  );
}
