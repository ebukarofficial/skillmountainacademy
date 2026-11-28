"use client";
// The administration home (Institutional Dashboard stage): one workspace per administrator group, and the Owner's
// executive command centre. Each panel loads ONLY the endpoints the person's group may read (the same areas the server
// enforces in permissions.ts), so nobody is shown, or even requests, figures outside their authority. Every number
// comes from a real API response; with no data, the panel says so.
import type { Me } from "./page";
import { api, Badge, Btn, naira, useLoad, when } from "./ui";
import { targetOf, useNotifications } from "./shell";
import { ActivityFeed, AttentionList, LinkBtn, Panel, ProgressRing, StatCard, StatGrid, Unavailable, WelcomeHero } from "./dash";

export type Access = { role: string | null; applied?: string | null; owner?: boolean; areas: { read: string[]; write: string[] } } | null;
export const GROUP_LABEL: Record<string, string> = {
  super: "Super Administrator", admissions: "Admissions", finance: "Finance", academic: "Academic Administration", faculty: "Faculty Management",
  support: "Student Support", reporting: "Read-only Reporting",
};
// The role shown in the sidebar: the owner, the group the server APPLIES (a restricted legacy administrator shows as
// Reporting), or an unassigned administrator.
export const roleLabelOf = (a: Access) => a?.owner ? "Owner" : a ? (GROUP_LABEL[a.applied ?? a.role ?? ""] ?? "Administrator (no group)") : "Administrator";
const reads = (a: Access, area: string) => !a || !!a.owner || a.areas.read.includes(area);

const WORKSPACE: Record<string, { eyebrow: string; sub: string }> = {
  owner: { eyebrow: "Executive command centre", sub: "What is happening across the Academy, what needs attention, and what requires your decision." },
  super: { eyebrow: "Institutional administration", sub: "Daily operations across the Academy, within the authority the owner has delegated." },
  admissions: { eyebrow: "Admissions workspace", sub: "Programme availability, admission periods, call requests and enquiries." },
  finance: { eyebrow: "Finance workspace", sub: "Payments received, balances outstanding, reconciliation and pricing records." },
  academic: { eyebrow: "Academic administration", sub: "Instructor allocation, class outcomes, coursework and academic quality." },
  faculty: { eyebrow: "Faculty management", sub: "Instructor recruitment, verification and teaching activity." },
  support: { eyebrow: "Student support workspace", sub: "Student monitoring, contact records and follow-up." },
  reporting: { eyebrow: "Reporting workspace (read only)", sub: "Institutional figures for review. Viewing reports does not allow any record to be changed." },
  none: { eyebrow: "Administration", sub: "Your day-to-day administration. The owner can assign you an administrator group." },
};

type Overview = Record<string, number>;
type Finance = { revenueNaira: number; outstandingNaira: number; overdueNaira: number; awaitingBankConfirmation: number };

export function AdminHome<T extends string>({ me, access, go, tabs }: { me: Me; access: Access; go: (t: T) => void; tabs: readonly T[] }) {
  const owner = !!access?.owner;
  const group = owner ? "owner" : access?.applied ?? access?.role ?? "none";
  const ws = WORKSPACE[group] ?? WORKSPACE.none;
  const can = (t: string) => (tabs as readonly string[]).includes(t);
  const to = (t: string) => () => { if (can(t)) go(t as T); };
  // Loads only what this person's group may read.
  const ov = useLoad<{ overview: Overview }>(reads(access, "overview") ? "/api/app/admin/overview" : null);
  const fin = useLoad<{ finance: Finance }>(reads(access, "finance") ? "/api/app/admin/finance" : null);
  const rec = useLoad<{ candidates: { verification: string; profileSubmittedAt?: string | null }[] }>(reads(access, "faculty") ? "/api/app/admin/recruitment" : null);
  const adm = useLoad<{ programmes: { slug: string; name: string; status: { state: string } }[] }>(reads(access, "admissions") ? "/api/app/admin/admissions" : null);
  const calls = useLoad<{ bookings: { status: string }[] }>(reads(access, "admissions") ? "/api/app/admin/bookings" : null);
  const enq = useLoad<{ enquiries: { needsFollowup: boolean; handledAt: string | null }[] }>(reads(access, "admissions") ? "/api/app/admin/enquiries?followup=1" : null);
  const attempts = useLoad<{ attempts: { state: string; stale: boolean }[] }>(reads(access, "finance") ? "/api/app/admin/payments/attempts" : null);
  const approvals = useLoad<{ approvals: { id: string; category: string; status: string; canDecide: boolean; execution_status: string; requesterName: string | null; created_at: string }[] }>("/api/app/admin/approvals");
  const ownerSt = useLoad<{ pendingRemovals?: number; unassignedAdmins?: number; state: string; bootstrapped: boolean }>(owner ? "/api/app/owner/status" : null);
  const audit = useLoad<{ entries: { id: string; at: string; action: string; actor_name: string | null }[] }>(owner ? "/api/app/owner/audit?limit=8" : null);
  const platform = useLoad<{ errors: unknown[]; schema: { status: string } }>(reads(access, "security") ? "/api/app/admin/platform" : null);
  const notes = useNotifications();

  const o = ov.data?.overview, f = fin.data?.finance;
  const toVerify = rec.data ? rec.data.candidates.filter((c) => c.profileSubmittedAt && !["approved", "rejected", "suspended"].includes(c.verification)).length : null;
  const openProgs = adm.data ? adm.data.programmes.filter((p) => p.status.state === "open").length : null;
  const newCalls = calls.data ? calls.data.bookings.filter((b) => b.status === "new").length : null;
  const followups = enq.data ? enq.data.enquiries.filter((e) => e.needsFollowup && !e.handledAt).length : null;
  const uncertain = attempts.data ? attempts.data.attempts.filter((a) => a.state === "uncertain" || a.stale).length : null;
  const myDecisions = approvals.data ? approvals.data.approvals.filter((a) => a.status === "pending" && a.canDecide) : [];
  const failedExec = approvals.data ? approvals.data.approvals.filter((a) => a.status === "approved" && a.execution_status === "failed").length : null;
  const completion = o && o.enrolments ? Math.round((o.completed / o.enrolments) * 100) : null;

  const attention = [
    ...(o ? [
      { label: "Students awaiting an instructor", count: o.awaiting_instructor, onOpen: to("allocation") },
      { label: "Enrolments awaiting a weekly class time", count: o.awaiting_timetable, onOpen: to("allocation") },
      { label: "Classes without a recorded outcome", count: o.pending_outcomes, onOpen: to("attendance") },
    ] : []),
    ...(f ? [{ label: "Bank transfers to confirm", count: f.awaitingBankConfirmation, onOpen: to("payments") }] : []),
    ...(uncertain !== null ? [{ label: "Uncertain Paystack checkouts to check", count: uncertain, onOpen: to("payments"), tone: "red" as const }] : []),
    ...(toVerify !== null ? [{ label: "Instructor profiles submitted for verification", count: toVerify, onOpen: to("instructors") }] : []),
    ...(newCalls !== null ? [{ label: "New call requests", count: newCalls, onOpen: to("admissions") }] : []),
    ...(followups !== null ? [{ label: "Assistant enquiries needing follow-up", count: followups, onOpen: to("admissions") }] : []),
    ...(failedExec ? [{ label: "Approved requests whose action failed", count: failedExec, onOpen: to("institution"), tone: "red" as const }] : []),
  ];

  const feed = (notes.data?.notifications ?? []).slice(0, 6).map((n) => ({
    id: n.id, title: n.title, body: n.body ?? undefined, at: n.created_at, unread: !n.read_at,
    onOpen: async () => { if (!n.read_at) await api("/api/app/notifications/read", { method: "POST", body: { ids: [n.id] } }).catch(() => undefined); notes.reload(); const t = targetOf(n.kind, tabs as unknown as string[]); if (t) go(t as T); },
  }));

  return (
    <div data-workspace={group}>
      <WelcomeHero name={me.fullName} eyebrow={ws.eyebrow} sub={ws.sub}
        actions={owner ? <><Btn onClick={to("institution")}>Institution and approvals</Btn><Btn kind="ghost" onClick={to("owner")}>Owner console</Btn></>
          : group === "finance" ? <Btn onClick={to("payments")}>Payments and balances</Btn>
          : group === "admissions" ? <Btn onClick={to("admissions")}>Admissions</Btn>
          : group === "academic" ? <Btn onClick={to("allocation")}>Instructor allocation</Btn>
          : group === "faculty" ? <Btn onClick={to("instructors")}>Instructor verification</Btn>
          : group === "reporting" ? <Btn onClick={to("reports")}>Reports</Btn>
          : can("students") ? <Btn onClick={to("students")}>Students</Btn> : undefined}
        aside={o ? <div className="rounded-2xl bg-ink/[0.03] p-4"><ProgressRing pct={completion} label="Programme completion" sub={`${o.completed} of ${o.enrolments} enrolments completed`} size={112} /></div> : undefined} />

      {o && <StatGrid>
        <StatCard icon="users" label="Students" value={o.students} note={`${o.active_students} active`} tone="indigo" onClick={can("students") ? to("students") : undefined} />
        <StatCard icon="check" label="Instructors" value={o.instructors} note={`${o.active_instructors} active`} onClick={can("instructors") ? to("instructors") : undefined} />
        <StatCard icon="school" label="Programmes" value={o.programmes} note={openProgs !== null ? `${openProgs} open for admission` : `${o.courses} courses published`} onClick={can("programmes") ? to("programmes") : undefined} />
        <StatCard icon="book" label="Enrolments" value={o.enrolments} note={`${o.ongoing} ongoing · ${o.completed} completed`} onClick={can("records") ? to("records") : undefined} />
      </StatGrid>}

      {f && <StatGrid>
        <StatCard icon="cash" label="Revenue to date" value={naira(f.revenueNaira)} tone="indigo" onClick={can("payments") ? to("payments") : undefined} />
        <StatCard icon="cash" label="Outstanding balances" value={naira(f.outstandingNaira)} note={`${naira(f.overdueNaira)} overdue`} tone={f.overdueNaira ? "orange" : "plain"} onClick={can("payments") ? to("payments") : undefined} />
        <StatCard icon="clipboard" label="Paid registrations (30 days)" value={o ? o.paid_registrations_30d : null} note={o ? `${o.unpaid_registrations_30d} unpaid` : undefined} />
        <StatCard icon="shield" label="Checkouts to reconcile" value={uncertain} note="uncertain Paystack attempts" tone={uncertain ? "alert" : "plain"} onClick={can("payments") ? to("payments") : undefined} />
      </StatGrid>}

      <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Panel title={group === "reporting" ? "Items others are handling" : "Needs attention"}>
            <AttentionList items={group === "reporting" ? attention.map((i) => ({ ...i, onOpen: undefined })) : attention} empty={o || f ? "Nothing needs attention right now." : "Nothing in your areas needs attention right now."} />
          </Panel>
          {owner && <Panel title="Requires your decision" action={<LinkBtn onClick={to("institution")}>All requests</LinkBtn>}>
            {myDecisions.length || ownerSt.data?.pendingRemovals ? <ul className="divide-y divide-ink/[0.06]">
              {myDecisions.slice(0, 6).map((a) => <li key={a.id} className="flex items-center justify-between gap-3 py-3"><span className="min-w-0"><b className="block truncate font-semibold">{a.category.replace(/_/g, " ")}</b><span className="text-sm text-ink/65">Asked by {a.requesterName ?? "unknown"} · {when(a.created_at)}</span></span><Badge s="pending" /></li>)}
              {!!ownerSt.data?.pendingRemovals && <li className="flex items-center justify-between gap-3 py-3"><span>Permanent access removals awaiting you</span><button onClick={to("owner")} className="min-h-8 rounded-lg border border-ink/15 px-3 text-sm font-semibold hover:border-indigo hover:text-indigo">Open ({ownerSt.data.pendingRemovals})</button></li>}
            </ul> : <p className="text-[0.95rem] text-ink/70">No requests are waiting for your decision.</p>}
            {!!ownerSt.data?.unassignedAdmins && <p className="mt-3 text-sm text-ink/70">{ownerSt.data.unassignedAdmins} administrator{ownerSt.data.unassignedAdmins === 1 ? " has" : "s have"} no group yet (Owner console).</p>}
          </Panel>}
          {owner && <Panel title="Recent audit events" action={<LinkBtn onClick={to("owner")}>Full audit log</LinkBtn>}>
            <ActivityFeed items={(audit.data?.entries ?? []).map((e) => ({ id: e.id, title: e.action, body: e.actor_name ?? "System", at: e.at }))} empty={audit.data ? "No audit events yet." : "Loading…"} />
          </Panel>}
          {owner && <PlannedWorkspaces go={to} />}
        </div>
        <div className="space-y-6">
          <Panel title="Recent activity" action={can("notifications") ? <LinkBtn onClick={to("notifications")}>All</LinkBtn> : undefined}>
            <ActivityFeed items={feed} empty="No recent notifications." />
          </Panel>
          {platform.data && <Panel title="System health" action={can("security") ? <LinkBtn onClick={to("security")}>Details</LinkBtn> : undefined}>
            <dl className="space-y-2.5 text-[0.95rem]">
              <div className="flex justify-between gap-3"><dt className="text-ink/70">Database schema</dt><dd><Badge s={platform.data.schema.status === "compatible" ? "active" : "pending"} /> <span className="text-sm text-ink/65">{platform.data.schema.status.replace(/_/g, " ")}</span></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink/70">Recent errors logged</dt><dd className="font-semibold tabular-nums">{platform.data.errors.length}</dd></div>
              {owner && ownerSt.data && <div className="flex justify-between gap-3"><dt className="text-ink/70">Owner identity</dt><dd className="text-sm font-semibold">{ownerSt.data.state.replace(/_/g, " ")}</dd></div>}
            </dl>
          </Panel>}
          {adm.data && <Panel title="Programme availability" action={can("admissions") ? <LinkBtn onClick={to("admissions")}>Manage</LinkBtn> : undefined}>
            <ul className="divide-y divide-ink/[0.06]">{adm.data.programmes.slice(0, 8).map((p) => <li key={p.slug} className="flex items-center justify-between gap-3 py-2.5 text-[0.95rem]"><span className="min-w-0 truncate">{p.name}</span><Badge s={p.status.state === "open" ? "active" : p.status.state} /></li>)}</ul>
          </Panel>}
        </div>
      </div>
    </div>
  );
}

// Workspaces the Owner asked for that have no permission group yet. Shown to the Owner only, as plain status: no figures,
// no controls that would pretend the workflow exists. Links go only to sections that already work.
function PlannedWorkspaces({ go }: { go: (t: string) => () => void }) {
  return (
    <Panel title="Planned workspaces (owner decision required)">
      <div className="space-y-3">
        <Unavailable title="Human Resources">
          There is no HR administrator group yet. Today, instructor recruitment and verification belong to the Faculty Management group (<button className="font-semibold text-indigo hover:underline" onClick={go("instructors")}>Instructors</button>); staff invitations and assignments are in <button className="font-semibold text-indigo hover:underline" onClick={go("institution")}>Institution</button>. Leave, performance reviews and HR documents do not exist.
        </Unavailable>
        <Unavailable title="Content Manager / Publisher">
          There is no content group yet. Website content and the programme catalogue are managed today by the Academic and Admissions groups (<button className="font-semibold text-indigo hover:underline" onClick={go("content")}>Website content</button>); publishing a programme still needs you or an authorised Super Administrator.
        </Unavailable>
        <Unavailable title="Advertising Manager / Publisher">
          No advertising campaigns, creatives, tracking or spending records exist in the platform, and no advertising account is connected. Nothing is shown here until those exist and you approve the role.
        </Unavailable>
      </div>
    </Panel>
  );
}
