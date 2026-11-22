// Tiny argument parser shared by the scripts/db command-line tools.
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { positional.push(a); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags.set(a.slice(2), next); i++; } else flags.set(a.slice(2), true);
  }
  const str = (k: string) => { const v = flags.get(k); return typeof v === "string" ? v : undefined; };
  return { flags, positional, str, has: (k: string) => flags.has(k) };
}

// True when the module at `url` is the script being run (the same check scripts/seed.mts uses).
import { fileURLToPath } from "node:url";
export const isMain = (url: string) => !!process.argv[1] && fileURLToPath(url) === process.argv[1];
