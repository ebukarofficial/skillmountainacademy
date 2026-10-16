import type { Metadata } from "next";
import { PRIVACY } from "@/lib/legal";
import { LegalShell } from "../legal-shell";

export const metadata: Metadata = { title: "Privacy Policy | Skill Mountain Academy" };
export default function Page() {
  return <LegalShell title="Privacy Policy" intro="This policy explains what personal data Skill Mountain Academy collects, why, who sees it, and the choices you have. We only ask for what we need." items={PRIVACY} />;
}
