import type { Metadata } from "next";
import { EntryPage } from "../entry";

export const metadata: Metadata = { title: "Staff workspace", robots: { index: false, follow: false } };
export default function Page() { return <EntryPage kind="staff" />; }
