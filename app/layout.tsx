import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SITE_URL } from "@/lib/config";
import "./globals.css";

// Fonts are bundled from npm packages (@fontsource), so the build needs no internet access.
const montserrat = localFont({
  src: "../node_modules/@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2",
  variable: "--font-montserrat", weight: "100 900", display: "swap", adjustFontFallback: "Arial",
});
const carlito = localFont({
  src: [
    { path: "../node_modules/@fontsource/carlito/files/carlito-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/carlito/files/carlito-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-carlito", display: "swap", adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Skill Mountain Academy | Flexible, one-on-one learning",
  description:
    "Flexible, one-on-one learning: one teacher, one student, online from Skill Mountain Academy in Abuja, Nigeria. Pick your day and time and pay in 3 parts. Graphics, UI/UX, Web Development, Digital Marketing, Cybersecurity, Cloud and DevOps.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Skill Mountain Academy | One-on-One Skill Academy for those made for more",
    description: "Flexible, one-on-one learning. Learn in-demand skills with structure, depth, and guidance, at your time, space, and pace.",
    type: "website", url: SITE_URL, siteName: "Skill Mountain Academy",
    images: [{ url: "/og-share.jpg", width: 1200, height: 848, alt: "Skill Mountain Academy: One-on-One Skill Academy for those made for more" }],
  },
  twitter: { card: "summary_large_image", title: "Skill Mountain Academy", description: "Flexible, one-on-one learning. Learn in-demand skills at your time, space, and pace.", images: ["/og-share.jpg"] },
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
