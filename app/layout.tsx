import type { Metadata, Viewport } from "next";
import { Montserrat, Carlito } from "next/font/google";
import { SITE_URL } from "@/lib/config";
import "./globals.css";

const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat", weight: ["500", "600", "700", "800"] });
const carlito = Carlito({ subsets: ["latin"], variable: "--font-carlito", weight: ["400", "700"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Skill Mountain Academy | One-on-one skill training",
  description:
    "Learn Graphics Design or DevOps Engineering one-on-one with a mentor at Skill Mountain Academy. 6-month programmes. Pay securely with Paystack.",
  keywords: ["Skill Mountain Academy", "SMA", "graphics design training", "DevOps training", "one-on-one training", "Nigeria"],
  openGraph: { title: "Skill Mountain Academy", description: "One-on-one skill training.", type: "website", url: SITE_URL },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fcf9db" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${montserrat.variable} ${carlito.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
