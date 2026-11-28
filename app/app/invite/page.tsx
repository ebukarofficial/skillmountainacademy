"use client";
// A staff invitation link opens this page (Expansion Stage E). Nothing happens on opening it: the invited person reviews
// the invitation and presses Accept or Decline (a POST), so email scanners that open links cannot use it. The role,
// group and department come from the invitation on the server; nothing sent from this page can change them.
import Image from "next/image";
import logo from "@/assets/sma-logo.png";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, goTo, Msg } from "../ui";

type Preview = { fullName: string; email: string; role: string; department: string | null; position: string | null; expiresAt: string };

function Invite() {
  const t = useSearchParams().get("t") || "";
  const [inv, setInv] = useState<Preview | null>(null);
  const [err, setErr] = useState(t ? "" : "This invitation link is not complete.");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  useEffect(() => {
    if (!t) return;
    api<{ invitation: Preview }>("/api/auth/invitations/preview", { method: "POST", body: { token: t } }).then((r) => setInv(r.invitation)).catch((e: Error) => setErr(e.message));
  }, [t]);
  async function act(kind: "accept" | "decline") {
    setBusy(true); setErr("");
    try {
      const r = await api<{ signedIn?: boolean; mfaRequired?: boolean }>(`/api/auth/invitations/${kind}`, { method: "POST", body: { token: t } });
      if (kind === "decline") { setDone("You declined the invitation. Nothing else is needed."); setInv(null); }
      else if (r.signedIn) goTo("/app/");
      else { setDone("Invitation accepted. Sign in from your staff entrance with this email address."); setInv(null); }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <main id="main" className="grid min-h-screen place-items-center bg-paper px-5 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-ink/[0.07] bg-white p-8 text-center shadow-xl shadow-ink/5">
        <Image src={logo} alt="Skill Mountain Academy" unoptimized className="mx-auto h-10 w-auto" />
        <p className="mt-6 text-sm font-semibold text-brand-red">Staff invitation</p>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">{inv ? `Welcome, ${inv.fullName.split(" ")[0]}` : "Your invitation"}</h1>
        {inv && <div className="mt-3 space-y-1 text-sm text-ink/70" data-invitation>
          <p>You are invited to join Skill Mountain Academy as <b>{inv.role}</b>{inv.department ? <>, {inv.position === "head" ? "as head of " : "in "}<b>{inv.department}</b></> : null}.</p>
          <p>For {inv.email}. This link works once and expires {new Date(inv.expiresAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.</p>
        </div>}
        {inv && <div className="mt-6 space-y-2">
          <button onClick={() => act("accept")} disabled={busy} className="w-full rounded-xl bg-indigo py-3 font-display text-sm font-semibold text-white shadow-lg shadow-indigo/20 transition hover:bg-navy disabled:opacity-60">{busy ? "Please wait…" : "Accept and continue"}</button>
          <button onClick={() => act("decline")} disabled={busy} className="w-full rounded-xl border border-ink/15 py-3 font-display text-sm font-semibold text-ink/80 transition hover:border-ink/30 disabled:opacity-60">Decline</button>
        </div>}
        {done && <p className="mt-4 text-sm text-ink/75">{done}</p>}
        <Msg text={err} />
      </div>
    </main>
  );
}
export default function Page() { return <Suspense><Invite /></Suspense>; }
