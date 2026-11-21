import type { Metadata } from "next";
import { EntryPage } from "../entry";

export const metadata: Metadata = { title: "Administration", robots: { index: false, follow: false } };
export default function Page() { return <EntryPage kind="admin" />; }
