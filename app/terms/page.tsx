import type { Metadata } from "next";
import { TERMS, TERMS_UPDATED } from "@/lib/terms";
import { LegalShell } from "../legal-shell";

export const metadata: Metadata = { title: "Terms and Conditions | Skill Mountain Academy" };
export default function Page() {
  return <LegalShell title="Terms and Conditions" updated={TERMS_UPDATED} intro="Please read these terms carefully before you register and pay. You will be asked to confirm that you have read and understood them." items={TERMS} />;
}
