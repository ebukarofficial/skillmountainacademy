"use client";
// Admin > Security: retention settings and the server's security status (Stage 2). The server checks every change.
import { api, Btn, Card, Empty, inputCls, Msg, useAction, useLoad } from "./ui";

type Cat = { id: string; label: string; group: string; defaultDays: number; minDays: number; defaultOn: boolean; on: boolean; days: number };
type Data = { categories: Cat[]; notAutomated: { table: string; group: string; why: string }[]; lastRun: { at: string; deleted: Record<string, number>; backlog: string[] } | null;
  security: { ipHashKey: string; mfaConfigured: boolean; mfaEnforced: boolean; sessions: Record<string, { idleMinutes: number | null; absoluteHours: number }> } };

export function RetentionSettings() {
  const d = useLoad<Data>("/api/app/admin/settings/retention");
  const { busy, msg, run } = useAction();
  if (d.error) return null; // not permitted for this administrator group
  if (!d.data) return <Card title="Data retention"><Empty>Loading…</Empty></Card>;
  const { categories, notAutomated, security } = d.data;
  const s = security.sessions;
  const life = (h: number) => (h >= 48 ? `${Math.round(h / 24)} days` : `${h} hours`);
  return (
    <>
      <Card title="Security status">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <dt className="text-ink/65">IP address pseudonym key</dt><dd className="font-semibold">{security.ipHashKey === "secret" ? "IP_HASH_SALT secret (recommended)" : security.ipHashKey === "d1" ? "Random key stored once in the database (set IP_HASH_SALT)" : security.ipHashKey === "missing" ? "Missing: IP_HASH_SALT is required (strict mode)" : "WARNING: temporary per-isolate key; set IP_HASH_SALT"}</dd>
          <dt className="text-ink/65">Two-step sign-in</dt><dd className="font-semibold">{security.mfaConfigured ? (security.mfaEnforced ? "Available and required for administrators" : "Available, optional") : "Not configured (MFA_ENCRYPTION_KEY)"}</dd>
          {(["student", "instructor", "admin"] as const).map((r) => <div key={r} className="contents"><dt className="text-ink/65 capitalize">{r} sessions</dt>
            <dd className="font-semibold">{s[r].idleMinutes ? `Sign out after ${s[r].idleMinutes} min idle` : "No idle limit"}, at most {life(s[r].absoluteHours)}</dd></div>)}
        </dl>
      </Card>
      <Card title="Data retention">
        <p className="-mt-1 mb-4 text-sm text-ink/70">Records that may be deleted automatically, in batches of at most 500 a day, oldest first. Every deletion run is written to the audit log. Academic and financial records are never deleted automatically.</p>
        <form onSubmit={(e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget);
          const body = Object.fromEntries(categories.map((c) => [c.id, { on: f.get(`${c.id}-on`) === "on", days: Number(f.get(`${c.id}-days`)) }]));
          run(() => api("/api/app/admin/settings/retention", { method: "PUT", body }), "Retention settings saved.", d.reload);
        }}>
          <div className="relative -mx-2 overflow-x-auto"><table className="w-full min-w-[40rem] text-left text-sm">
            <thead><tr className="border-b border-ink/10 text-ink/70"><th className="px-2 py-2 font-semibold">Record</th><th className="px-2 py-2 font-semibold">Group</th><th className="px-2 py-2 font-semibold">Delete automatically</th><th className="px-2 py-2 font-semibold">After (days)</th></tr></thead>
            <tbody>{categories.map((c) => (
              <tr key={c.id} className="border-b border-ink/[0.06] last:border-0">
                <td className="px-2 py-2 font-semibold">{c.label}</td><td className="px-2 py-2 text-ink/70">{c.group}</td>
                <td className="px-2 py-2"><input type="checkbox" name={`${c.id}-on`} defaultChecked={c.on} aria-label={`Delete ${c.label} automatically`} className="h-4 w-4 accent-indigo" /></td>
                <td className="px-2 py-2"><input type="number" name={`${c.id}-days`} min={c.minDays} max={3650} defaultValue={c.days} aria-label={`${c.label}: days`} className={`${inputCls} mt-0 w-24 py-1`} /></td>
              </tr>))}</tbody>
          </table></div>
          <div className="mt-3"><Btn small type="submit" disabled={busy}>Save retention settings</Btn></div>
        </form>
        <Msg text={msg.text} kind={msg.kind} />
        <p className="mt-3 text-sm text-ink/70">{d.data.lastRun ? `Last run ${new Date(d.data.lastRun.at).toLocaleString("en-GB")}: ${Object.entries(d.data.lastRun.deleted).map(([k, n]) => `${k} ${n}`).join(", ") || "nothing due"}.` : "No retention run recorded yet."}
          {d.data.lastRun?.backlog.length ? <b className="ml-1 text-brand-red">Backlog: {d.data.lastRun.backlog.join(", ")} reached the daily limit; more rows are waiting.</b> : null}</p>
        <h3 className="mt-6 text-sm font-semibold">Kept, never deleted automatically</h3>
        <ul className="mt-2 space-y-1 text-sm text-ink/75">{notAutomated.map((n) => <li key={n.table}><b className="font-semibold">{n.group}</b> ({n.table}): {n.why}</li>)}</ul>
      </Card>
    </>
  );
}
