import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import logo from "@/assets/sma-logo.png";

export const metadata: Metadata = { title: "Page not found | Skill Mountain Academy", robots: { index: false, follow: true } };

// Becomes out/404.html. Cloudflare serves it, with a real 404 status, for any unknown address.
export default function NotFound() {
  return (
    <main id="main" className="grid min-h-screen place-items-center px-5 py-16 text-center">
      <div className="max-w-md">
        <Image src={logo} alt="Skill Mountain Academy" unoptimized className="mx-auto h-12 w-auto" />
        <p className="mt-10 font-display text-5xl font-extrabold brand-text">404</p>
        <h1 className="mt-3 font-display text-2xl font-extrabold">We could not find that page</h1>
        <p className="mt-3 text-ink/75">The link may be old or mistyped. You can go back to the home page and choose your programme from there.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className="brand-bg rounded-full px-8 py-3.5 font-display font-semibold text-white">Back to home</Link>
          <Link href="/#programmes" className="rounded-full border-2 border-indigo px-8 py-3.5 font-display font-semibold text-indigo">See programmes</Link>
        </div>
      </div>
    </main>
  );
}
