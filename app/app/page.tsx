"use client";
// /app/: the signed-in dashboard. One page that shows the right dashboard for the user's role (the server enforces roles).
import Image from "next/image";
import logo from "@/assets/sma-logo.png";
import { useLoad } from "./ui";
import { StudentDashboard } from "./student";
import { InstructorDashboard } from "./instructor";
import { AdminDashboard } from "./admin";

export type Me = { id: string; email: string; role: "student" | "instructor" | "admin"; fullName: string; phone: string | null; bio: string | null; photo: string | null; studentNo: string | null;
  staffNo: string | null; emailPrefs: { reminders?: boolean; updates?: boolean }; specialization: string | null; qualifications: string[]; links: Record<string, string> };

export default function AppHome() {
  const { data, error } = useLoad<{ user: Me }>("/api/me");
  const me = data?.user;
  if (!me) return (
    <div className="grid min-h-screen place-items-center bg-paper px-6">
      <div className="text-center">
        <Image src={logo} alt="Skill Mountain Academy" unoptimized className="mx-auto h-10 w-auto" />
        {error ? <p role="alert" className="mt-6 text-sm text-brand-red">{error}</p> : <p className="mt-6 text-sm text-ink/55" role="status">Opening your workspace…</p>}
      </div>
    </div>
  );
  if (me.role === "student") return <StudentDashboard me={me} />;
  if (me.role === "instructor") return <InstructorDashboard me={me} />;
  return <AdminDashboard me={me} />;
}
