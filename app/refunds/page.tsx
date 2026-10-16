import type { Metadata } from "next";
import { REFUNDS } from "@/lib/legal";
import { LegalShell } from "../legal-shell";

export const metadata: Metadata = { title: "Refund Policy | Skill Mountain Academy" };
export default function Page() {
  return <LegalShell title="Refund Policy" intro="Please read this before you pay." items={REFUNDS} />;
}
