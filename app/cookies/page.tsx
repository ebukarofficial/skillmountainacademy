import type { Metadata } from "next";
import { COOKIES } from "@/lib/legal";
import { LegalShell } from "../legal-shell";

export const metadata: Metadata = { title: "Cookie Policy | Skill Mountain Academy" };
export default function Page() {
  return <LegalShell title="Cookie Policy" intro="Short version: we do not use advertising or analytics cookies on this website." items={COOKIES} />;
}
