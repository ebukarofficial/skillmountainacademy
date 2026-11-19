// Shared helpers for the source-level tests.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const ROOT = new URL("..", import.meta.url).pathname;
export const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
export const exists = (p: string) => existsSync(join(ROOT, p));

export function files(dir: string, exts: string[]): string[] {
  if (!exists(dir)) return [];
  return readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(join(ROOT, p)).isDirectory()) return files(p, exts);
    return exts.some((e) => n.endsWith(e)) ? [p] : [];
  });
}

// Every file that ends up in the website or the Worker.
export const SITE_SOURCE = () => [...files("app", [".ts", ".tsx"]), ...files("lib", [".ts", ".json"]), ...files("src", [".ts"]), ...files("data", [".json"])];

// Built website (only present after `npm run build`).
export const built = (p: string) => (exists(join("out", p)) ? read(join("out", p)) : null);
