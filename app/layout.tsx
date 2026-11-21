import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { BUSINESS, SITE_URL, SOCIAL } from "@/lib/config";
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
// Editorial serif for institutional headlines only (body text and the dashboards stay sans-serif).
const serif = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/cormorant-garamond/files/cormorant-garamond-latin-wght-normal.woff2", weight: "300 700", style: "normal" },
    { path: "../node_modules/@fontsource-variable/cormorant-garamond/files/cormorant-garamond-latin-wght-italic.woff2", weight: "300 700", style: "italic" },
  ],
  variable: "--font-serif", display: "swap", adjustFontFallback: "Times New Roman",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Skill Mountain Academy | For those made for more",
  description:
    "For those made for more. Skill Mountain Academy, open to learners worldwide, teaches advanced digital skills through one-on-one instruction from an assigned instructor, AI-assisted learning and intensive practical training: design, web development, digital marketing, cybersecurity, cloud and DevOps.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Skill Mountain Academy | For those made for more",
    description: "Human mentorship. Intelligent learning. Practical mastery. Advanced digital skills taught one-on-one by an assigned instructor.",
    type: "website", url: SITE_URL, siteName: "Skill Mountain Academy",
    images: [{ url: "/og-share.jpg", width: 1200, height: 848, alt: "Skill Mountain Academy: One-on-One Skill Academy for those made for more" }],
  },
  twitter: { card: "summary_large_image", title: "Skill Mountain Academy", description: "For those made for more. Human mentorship. Intelligent learning. Practical mastery.", images: ["/og-share.jpg"] },
};

// Organization structured data (https://schema.org/EducationalOrganization), on every page.
const ORG_LD = {
  "@context": "https://schema.org", "@type": "EducationalOrganization", name: "Skill Mountain Academy", legalName: BUSINESS.name,
  url: SITE_URL, logo: `${SITE_URL}/icon.png`, email: BUSINESS.email, telephone: "+234 706 100 0472",
  slogan: "For those made for more.",
  sameAs: SOCIAL.map((s) => s.url),
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fcf9db" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><meta httpEquiv="Content-Security-Policy" content="object-src 'none'; base-uri 'self'; form-action 'self'" /></head>
      <body className={`${montserrat.variable} ${carlito.variable} ${serif.variable} bg-paper font-sans antialiased`}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_LD).replace(/</g, "\\u003c") }} />
        <a href="#main" className="skip-link">Skip to main content</a>
        {children}
      </body>
    </html>
  );
}
