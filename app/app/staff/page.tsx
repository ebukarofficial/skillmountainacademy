"use client";
// The old staff entrance moved: faculty sign in at /app/instructor/login/, administrators at /app/login/.
import { useEffect } from "react";
import Link from "next/link";

export default function Page() {
  useEffect(() => { window.location.replace("/app/instructor/login/"); }, []);
  return <main id="main" className="p-10 text-sm">This entrance has moved. <Link href="/app/instructor/login/" className="font-semibold text-indigo underline">Go to the faculty entrance</Link>.</main>;
}
