"use client";
// Cloudflare Turnstile widget (https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/).
// The token it produces is checked by the Worker; a form without a valid token is refused there.
import { useEffect, useRef } from "react";
import { CFG } from "@/lib/config";

type TS = { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void; reset: (id: string) => void };
declare global { interface Window { turnstile?: TS } }

let loader: Promise<void> | null = null;
function load(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loader ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loader = null; reject(new Error("turnstile failed to load")); };
    document.head.appendChild(s);
  });
  return loader;
}

// Stage 3C: a STAGING build may supply its own Turnstile site key through the build variable
// NEXT_PUBLIC_SMA_TURNSTILE_SITE_KEY (the production key only allows the production hostname). Production does not set
// this variable, so production keeps CFG.turnstileSiteKey exactly as before. This file is browser-only (never in the Worker).
const SITE_KEY: string = process.env.NEXT_PUBLIC_SMA_TURNSTILE_SITE_KEY || CFG.turnstileSiteKey;

export const turnstileAvailable = () => !!SITE_KEY;

export function Turnstile({ onToken, action }: { onToken: (t: string) => void; action: string }) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  useEffect(() => { cb.current = onToken; }, [onToken]);
  useEffect(() => {
    if (!SITE_KEY) return;
    let id: string | undefined;
    let gone = false;
    load().then(() => {
      if (gone || !box.current || !window.turnstile) return;
      id = window.turnstile.render(box.current, {
        sitekey: SITE_KEY, action, theme: "light", size: "flexible",
        callback: (t: string) => cb.current(t), "expired-callback": () => cb.current(""), "error-callback": () => cb.current(""),
      });
    }).catch(() => cb.current(""));
    return () => { gone = true; if (id) window.turnstile?.remove(id); };
  }, [action]);
  if (!SITE_KEY) return null;
  return <div ref={box} className="min-h-[65px]" aria-label="Security check" />;
}
