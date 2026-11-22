"use client";
// /app/: the signed-in dashboard. One page that shows the right dashboard for the user's role (the server enforces roles).
import Image from "next/image";
import logo from "@/assets/sma-logo.png";
import { useLoad } from "./ui";
import { StudentDashboard } from "./student";
import { InstructorDashboard } from "./instructor";
import { AdminDashboard } from "./admin";
import { IdleGuard, type SessionInfo } from "./idle";
import { MfaChallenge, MfaSettings } from "./mfa";

export type Me = { id: string; email: string; role: "student" | "instructor" | "admin"; fullName: string; phone: string | null; bio: string | null; photo: string | null; studentNo: string | null;
  staffNo: string | null; emailPrefs: { reminders?: boolean; updates?: boolean }; specialization: string | null; qualifications: string[]; links: Record<string, string>;
  verification?: string | null; verified?: boolean; profileSubmittedAt?: string | null; headline?: string | null; achievements?: string[];
  certifications?: { title: string; issuer: string | null; year: string | null; url: string | null }[]; languages?: string[]; countryOrigin?: string | null; countryResidence?: string | null };

type MeResponse = { user: Me; session?: SessionInfo | null; mfa?: { enabled: boolean; pending: boolean; enforced: boolean; setupRequired: boolean } | null;
  admin?: { role: string | null; areas: { read: string[]; write: string[] } } | null };

export default function AppHome() {
  const { data, error } = useLoad<MeResponse>("/api/me");
  const me = data?.user;
  if (!me) return (
    <div className="grid min-h-screen place-items-center bg-paper px-6">
      <div className="text-center">
        <Image src={logo} alt="Skill Mountain Academy" unoptimized className="mx-auto h-10 w-auto" />
        {error ? <p role="alert" className="mt-6 text-sm text-brand-red">{error}</p> : <p className="mt-6 text-sm text-ink/65" role="status">Opening your workspace…</p>}
      </div>
    </div>
  );
  // The server allows a session waiting for the authenticator code nothing but this step.
  if (data?.mfa?.pending) return <MfaChallenge />;
  if (data?.mfa?.setupRequired) return <MfaSettings forced />;
  const guard = <IdleGuard session={data?.session} />;
  if (me.role === "student") return <>{guard}<StudentDashboard me={me} /></>;
  if (me.role === "instructor") return <>{guard}<InstructorDashboard me={me} /></>;
  return <>{guard}<AdminDashboard me={me} access={data?.admin ?? null} /></>;
}
