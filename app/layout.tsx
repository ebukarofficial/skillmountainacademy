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
    "Learn in-demand skills one-on-one with a mentor at Skill Mountain Academy, at your time, space and pace. Graphics Design, DevOps, Cloud, Cybersecurity, Digital Marketing and IELTS.",
  keywords: ["Skill Mountain Academy", "SMA", "one-on-one training", "graphics design training", "DevOps training", "cloud engineering", "cybersecurity", "IELTS", "Nigeria"],
  alternates: { canonical: "/" },
  openGraph: {
    title: "Skill Mountain Academy | One-on-One Skill Academy for those made for more",
    description: "Learn in-demand skills with structure, depth, and guidance, at your time, space, and pace.",
    type: "website", url: SITE_URL, siteName: "Skill Mountain Academy",
    images: [{ url: "/og-share.jpg", width: 1200, height: 848, alt: "Skill Mountain Academy: One-on-One Skill University for those made for more" }],
  },
  twitter: { card: "summary_large_image", title: "Skill Mountain Academy", description: "Learn in-demand skills one-on-one, at your time, space, and pace.", images: ["/og-share.jpg"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fcf9db" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><meta httpEquiv="Content-Security-Policy" content="object-src 'none'; base-uri 'self'; form-action 'self'" /></head>
      <body className={`${montserrat.variable} ${carlito.variable} font-sans antialiased`}>
        <a href="#main" className="skip-link">Skip to main content</a>
        {children}
      </body>
    </html>
  );
}
