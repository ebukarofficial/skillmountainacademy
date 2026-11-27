"use client";
// Admin > Programmes > Catalogue (Expansion Stage B). Schools and every programme (live and draft), missing-price flags,
// editing drafts (text, durations, international USD and local NGN tuition), order, preview, status and who last
// changed it. Publishing, pausing and retiring are shown only to the owner or a delegated Super Administrator, and the
// server checks every request again (routes/catalogue.ts). Amounts are typed in whole dollars / naira and sent to the
// server as integer minor units; nothing is converted between USD and NGN.
import { useMemo, useState } from "react";
import { api, Badge, Btn, Card, Empty, Field, inputCls, Msg, useAction, useLoad, when } from "./ui";
import { duration, safeTone, type Programme } from "@/lib/config";
import { approx } from "@/lib/pricing";

type Fields = {
  name: string; schoolSlug: string | null; blurb: string | null; description: string | null; learn: string[]; curriculum: string[]; finalProject: string | null;
  trainingMonths: number; internshipMonths: number; priceUsdCents: number | null; priceNgnKobo: number | null; level: string | null; audience: string | null;
  fullPaymentOnly: boolean; position: number;
};
type Item = {
  slug: string; status: "draft" | "published" | "paused" | "retired"; hasDraft: boolean; name: string; schoolSlug: string | null; position: number;
  live: (Fields & { publishedAt: string | null; retiredAt: string | null; retiredReason: string | null }) | null; draft: Fields | null;
  problems: string[]; missingNgn: boolean; missingUsd: boolean; international: { USD: number | null; GBP: number | null; EUR: number | null };
  updatedAt: string; updatedBy: string | null;
};
type School = { slug: string; code: string; name: string; tab: string; tone: string };
type Data = { schools: School[]; programmes: Item[]; policy: { superMayPublish: boolean }; canPublish: boolean; isOwner: boolean;
  counts: { total: number; published: number; drafts: number; newDrafts: number; changesToLive: number; missingNgn: number } };

const usd = (cents: number | null) => (cents == null ? "not set" : `USD ${(cents / 100).toLocaleString("en-US")}`);
const ngn = (kobo: number | null) => (kobo == null ? "not set" : `₦${Math.round(kobo / 100).toLocaleString("en-NG")}`);
const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
// Whole units typed by staff → integer minor units for the server. Empty means "not set".
const toMinor = (t: string): number | null | "bad" => { const s = t.replace(/[,\s]/g, ""); if (!s) return null; return /^\d{1,9}$/.test(s) ? Number(s) * 100 : "bad"; };

export function CatalogueAdmin() {
  const { data, error, reload } = useLoad<Data>("/api/app/admin/catalogue");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const act = useAction();
  const bySchool = useMemo(() => {
    if (!data) return [];
    const groups = data.schools.map((s) => ({ school: s, items: data.programmes.filter((p) => p.schoolSlug === s.slug) }));
    const none = data.programmes.filter((p) => !p.schoolSlug || !data.schools.some((s) => s.slug === p.schoolSlug));
    return none.length ? [...groups, { school: { slug: "", code: "—", name: "Current programmes without a school", tab: "", tone: "" }, items: none }] : groups;
  }, [data]);

  if (error) return <Card title="Catalogue"><Msg text={error} /></Card>;
  if (!data) return <Card title="Catalogue"><Empty>Loading…</Empty></Card>;
  const move = (slug: string, dir: -1 | 1) => {
    const order = data.programmes.map((p) => p.slug);
    const i = order.indexOf(slug), j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    act.run(() => api("/api/app/admin/catalogue/order", { method: "PUT", body: { slugs: order } }), "Order saved.", reload);
  };

  return (
    <div className="space-y-6">
      <Card title="Programme catalogue" action={<Btn small onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "New draft programme"}</Btn>}>
        <p className="text-[0.95rem] text-ink/75">
          {data.counts.total} programmes: {data.counts.published} published ({data.counts.changesToLive} with unpublished changes) and {data.counts.newDrafts} new drafts.
          {data.counts.missingNgn > 0 && <> <strong className="text-brand-red">{data.counts.missingNgn} have no local NGN tuition</strong> and cannot be published until the owner sets it.</>}
        </p>
        <p className="mt-2 text-sm text-ink/65">Drafts are never shown on the website, in registration or at checkout. Publishing {data.canPublish ? "is available to you" : "is reserved for the owner"}
          {data.policy.superMayPublish ? " and Super Administrators the owner has authorised" : ""}. A published change appears on the website after the next build; registration and prices use it at once.</p>
        {data.isOwner && <OwnerPolicy policy={data.policy} reload={reload} />}
        <Msg text={act.msg.text} kind={act.msg.kind} />
        {creating && <Editor schools={data.schools} item={null} onDone={() => { setCreating(false); reload(); }} />}
      </Card>
      {bySchool.map(({ school, items }) => (
        <Card key={school.slug || "none"} title={<>{school.code !== "—" && <span className="mr-2 text-ink/50">{school.code}</span>}{school.name}</>}>
          {!items.length ? <Empty>No programmes in this school yet.</Empty> : (
            <ul className="divide-y divide-ink/10">
              {items.map((p) => (
                <li key={p.slug} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setOpen(open === p.slug ? null : p.slug)} className="text-left font-semibold text-ink hover:underline">{p.name}</button>
                    <Badge s={p.status} />
                    {p.hasDraft && p.status !== "draft" && <Badge s="unpublished changes" />}
                    {p.missingNgn && <span className="rounded-md bg-brand-red/10 px-2 py-0.5 text-xs font-semibold text-brand-red">NGN price missing</span>}
                    {p.missingUsd && <span className="rounded-md bg-brand-orange/15 px-2 py-0.5 text-xs font-semibold text-ink">USD price missing</span>}
                    <span className="ml-auto flex gap-1">
                      <Btn small kind="ghost" onClick={() => move(p.slug, -1)} disabled={act.busy}>↑</Btn>
                      <Btn small kind="ghost" onClick={() => move(p.slug, 1)} disabled={act.busy}>↓</Btn>
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink/65">/{p.slug} · {usd((p.draft ?? p.live)?.priceUsdCents ?? null)} international · {ngn((p.draft ?? p.live)?.priceNgnKobo ?? null)} local ·
                    {" "}{(p.draft ?? p.live)!.trainingMonths} + {(p.draft ?? p.live)!.internshipMonths} months · last changed {when(p.updatedAt)}{p.updatedBy ? ` by ${p.updatedBy}` : ""}</p>
                  {open === p.slug && <Detail item={p} data={data} reload={reload} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

function OwnerPolicy({ policy, reload }: { policy: Data["policy"]; reload: () => void }) {
  const act = useAction();
  return (
    <div className="mt-3 rounded-lg border border-ink/10 p-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={policy.superMayPublish} disabled={act.busy}
          onChange={(e) => act.run(() => api("/api/app/owner/catalogue-policy", { method: "PUT", body: { superMayPublish: e.target.checked } }), "Saved.", reload)} />
        Allow Super Administrators to publish, pause and retire programmes (owner setting)
      </label>
      <Msg text={act.msg.text} kind={act.msg.kind} />
    </div>
  );
}

function Detail({ item, data, reload }: { item: Item; data: Data; reload: () => void }) {
  const [edit, setEdit] = useState(false);
  const [reason, setReason] = useState("");
  const act = useAction();
  const f = item.draft ?? item.live!;
  const school = data.schools.find((s) => s.slug === f.schoolSlug);
  const post = (path: string, body: unknown, okText: string) => act.run(() => api(`/api/app/admin/catalogue/programmes/${item.slug}/${path}`, { method: "POST", body }), okText, reload);
  return (
    <div className="mt-3 space-y-4 rounded-xl bg-ink/[0.03] p-4">
      {item.problems.length > 0 && <p className="text-sm text-brand-red">Cannot be published yet. Missing: {item.problems.join(", ")}.</p>}
      {item.live?.retiredAt && <p className="text-sm text-ink/70">Retired {when(item.live.retiredAt)}: {item.live.retiredReason}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="text-sm text-ink/80">
          <p><strong>School:</strong> {school?.name ?? "none (current catalogue)"}</p>
          <p><strong>International tuition:</strong> {usd(f.priceUsdCents)}{item.international.GBP != null && item.international.EUR != null && ` (${approx(item.international.GBP, "GBP")}, ${approx(item.international.EUR, "EUR")} at current rates)`}</p>
          <p><strong>Local NGN tuition:</strong> {ngn(f.priceNgnKobo)}{item.hasDraft && item.live && item.live.priceNgnKobo !== f.priceNgnKobo && ` (published: ${ngn(item.live.priceNgnKobo)})`}</p>
          <p><strong>Level:</strong> {f.level || "not set"}</p>
          {f.finalProject && <p><strong>Final project:</strong> {f.finalProject}</p>}
          {f.curriculum.length > 0 && <><p className="mt-2 font-semibold">Curriculum</p><ul className="list-disc pl-5">{f.curriculum.map((c) => <li key={c}>{c}</li>)}</ul></>}
        </div>
        <Preview f={f} item={item} tone={safeTone(school?.tone)} tab={school?.tab ?? "Programmes"} />
      </div>
      <div className="flex flex-wrap gap-2">
        {item.status !== "retired" && <Btn small kind="ghost" onClick={() => setEdit((v) => !v)}>{edit ? "Close editor" : "Edit draft"}</Btn>}
        {data.canPublish && (item.hasDraft || item.status === "paused") && <Btn small disabled={act.busy || (item.hasDraft && item.problems.length > 0)} onClick={() => post("publish", {}, "Published.")}>{item.hasDraft ? "Publish" : "Resume"}</Btn>}
        {data.canPublish && item.status === "published" && <Btn small kind="ghost" disabled={act.busy} onClick={() => post("pause", {}, "Paused: hidden and closed to registration.")}>Pause</Btn>}
        {data.canPublish && item.live && item.status !== "retired" && (
          <span className="flex items-center gap-2">
            <input aria-label="Reason for retiring" placeholder="Reason for retiring" value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputCls} mt-0 w-56`} />
            <Btn small kind="dark" disabled={act.busy || !reason.trim()} onClick={() => post("retire", { reason }, "Retired. Records and old links are kept.")}>Retire</Btn>
          </span>
        )}
      </div>
      <Msg text={act.msg.text} kind={act.msg.kind} />
      {edit && <Editor schools={data.schools} item={item} onDone={() => { setEdit(false); reload(); }} />}
    </div>
  );
}

// A card in the style of the public catalogue, built from the draft (staff only; never public).
function Preview({ f, item, tone, tab }: { f: Fields; item: Item; tone: string; tab: string }) {
  const p: Pick<Programme, "trainingMonths" | "internshipMonths"> = { trainingMonths: f.trainingMonths, internshipMonths: f.internshipMonths };
  return (
    <div aria-label="Preview" className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
      <div className={`bg-gradient-to-br ${tone} px-4 py-3 text-white`}>
        <p className="text-xs uppercase tracking-[0.18em] opacity-90">{tab} · Preview</p>
        <p className="font-display text-lg font-semibold">{f.name || item.slug}</p>
      </div>
      <div className="space-y-2 p-4 text-sm text-ink/80">
        <p>{f.blurb || <em className="text-ink/50">No short description yet.</em>}</p>
        <p className="text-ink/60">{duration(p as Programme)} · {f.level || "level not set"}</p>
        {f.learn.length > 0 && <ul className="list-disc pl-5">{f.learn.map((l) => <li key={l}>{l}</li>)}</ul>}
      </div>
    </div>
  );
}

function Editor({ schools, item, onDone }: { schools: School[]; item: Item | null; onDone: () => void }) {
  const f = item ? item.draft ?? item.live! : null;
  const [v, setV] = useState({
    slug: "", name: f?.name ?? "", schoolSlug: f?.schoolSlug ?? "", blurb: f?.blurb ?? "", description: f?.description ?? "", learn: (f?.learn ?? []).join("\n"),
    curriculum: (f?.curriculum ?? []).join("\n"), finalProject: f?.finalProject ?? "", trainingMonths: String(f?.trainingMonths ?? 1), internshipMonths: String(f?.internshipMonths ?? 0),
    usd: f?.priceUsdCents != null ? String(f.priceUsdCents / 100) : "", ngn: f?.priceNgnKobo != null ? String(Math.round(f.priceNgnKobo / 100)) : "",
    level: f?.level ?? "", audience: f?.audience ?? "", fullPaymentOnly: f?.fullPaymentOnly ?? false,
  });
  const act = useAction();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const save = () => {
    const usdMinor = toMinor(v.usd), ngnMinor = toMinor(v.ngn);
    if (usdMinor === "bad" || ngnMinor === "bad") return act.run(async () => { throw new Error("Tuition must be a whole number (no decimals or currency symbols)."); });
    const body = { name: v.name, schoolSlug: v.schoolSlug, blurb: v.blurb, description: v.description, learn: lines(v.learn), curriculum: lines(v.curriculum), finalProject: v.finalProject,
      trainingMonths: Number(v.trainingMonths), internshipMonths: Number(v.internshipMonths), priceUsdCents: usdMinor, priceNgnKobo: ngnMinor, level: v.level, audience: v.audience,
      fullPaymentOnly: v.fullPaymentOnly };
    return act.run(() => item
      ? api(`/api/app/admin/catalogue/programmes/${item.slug}`, { method: "PATCH", body })
      : api("/api/app/admin/catalogue/programmes", { method: "POST", body: { ...body, slug: v.slug } }), "Draft saved. It is not public.", onDone);
  };
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {!item && <Field label="Web address (lowercase, hyphens)"><input className={inputCls} value={v.slug} onChange={set("slug")} placeholder="e.g. data-science-ml" /></Field>}
      <Field label="Title"><input className={inputCls} value={v.name} onChange={set("name")} /></Field>
      <Field label="School"><select className={inputCls} value={v.schoolSlug} onChange={set("schoolSlug")}><option value="">Choose…</option>{schools.map((s) => <option key={s.slug} value={s.slug}>{s.code} {s.name}</option>)}</select></Field>
      <Field label="Level"><input className={inputCls} value={v.level} onChange={set("level")} placeholder="e.g. Beginner to advanced" /></Field>
      <Field label="Training months"><input type="number" min={1} max={24} className={inputCls} value={v.trainingMonths} onChange={set("trainingMonths")} /></Field>
      <Field label="Internship months"><input type="number" min={0} max={12} className={inputCls} value={v.internshipMonths} onChange={set("internshipMonths")} /></Field>
      <Field label="International tuition (USD, whole dollars)"><input inputMode="numeric" className={inputCls} value={v.usd} onChange={set("usd")} /></Field>
      <Field label="local NGN tuition (₦, whole naira; set by the owner, never converted)"><input inputMode="numeric" className={inputCls} value={v.ngn} onChange={set("ngn")} /></Field>
      <div className="sm:col-span-2"><Field label="Short description (card)"><textarea rows={2} className={inputCls} value={v.blurb} onChange={set("blurb")} /></Field></div>
      <div className="sm:col-span-2"><Field label="Full description"><textarea rows={4} className={inputCls} value={v.description} onChange={set("description")} /></Field></div>
      <Field label="Learning outcomes (one per line, at least 3)"><textarea rows={6} className={inputCls} value={v.learn} onChange={set("learn")} /></Field>
      <Field label="Curriculum (one module per line)"><textarea rows={6} className={inputCls} value={v.curriculum} onChange={set("curriculum")} /></Field>
      <div className="sm:col-span-2"><Field label="Final project"><textarea rows={2} className={inputCls} value={v.finalProject} onChange={set("finalProject")} /></Field></div>
      <div className="sm:col-span-2"><Field label="Who it is for (optional)"><input className={inputCls} value={v.audience} onChange={set("audience")} /></Field></div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={v.fullPaymentOnly} onChange={(e) => setV((x) => ({ ...x, fullPaymentOnly: e.target.checked }))} /> Full payment only (no instalments)</label>
      <div className="sm:col-span-2 flex items-center gap-3"><Btn onClick={save} disabled={act.busy}>Save draft</Btn><Msg text={act.msg.text} kind={act.msg.kind} /></div>
    </div>
  );
}
