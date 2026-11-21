import type { Metadata } from "next";

// The learning platform: private pages, never indexed.
export const metadata: Metadata = { title: "My learning | Skill Mountain Academy", robots: { index: false, follow: false } };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-paper">{children}</div>;
}
