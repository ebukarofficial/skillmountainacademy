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

export const turnstileAvailable = () => !!CFG.turnstileSiteKey;

export function Turnstile({ onToken, action }: { onToken: (t: string) => void; action: string }) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  useEffect(() => { cb.current = onToken; }, [onToken]);
  useEffect(() => {
    if (!CFG.turnstileSiteKey) return;
    let id: string | undefined;
    let gone = false;
    load().then(() => {
      if (gone || !box.current || !window.turnstile) return;
      id = window.turnstile.render(box.current, {
        sitekey: CFG.turnstileSiteKey, action, theme: "light", size: "flexible",
        callback: (t: string) => cb.current(t), "expired-callback": () => cb.current(""), "error-callback": () => cb.current(""),
      });
    }).catch(() => cb.current(""));
    return () => { gone = true; if (id) window.turnstile?.remove(id); };
  }, [action]);
  if (!CFG.turnstileSiteKey) return null;
  return <div ref={box} className="min-h-[65px]" aria-label="Security check" />;
}
