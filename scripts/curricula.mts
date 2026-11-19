// Runs before every build (npm "prebuild"). For each programme it checks public/curricula/<slug>.pdf:
//  - PDF present: the programme page's "View curriculum" button opens it, and "What you'll learn" uses the PDF's
//    top-level headings (its bookmarks/outline). A PDF without bookmarks keeps the list in lib/config.ts.
//  - PDF missing: the button is disabled and a build warning is printed.
// The result is written to lib/curricula.generated.json, which the site reads. It never fails the build.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROGRAMMES } from "../lib/config.ts";

export type CurriculumInfo = { pdf: boolean; headings: string[] };

export async function readHeadings(file: string): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 });
  const doc = await task.promise;
  try {
    const outline = (await doc.getOutline()) ?? [];
    return outline.map((o: { title: string }) => String(o.title).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 12);
  } finally {
    await task.destroy();
  }
}

export async function scan(root: string, log: (m: string) => void = console.warn): Promise<Record<string, CurriculumInfo>> {
  const out: Record<string, CurriculumInfo> = {};
  for (const p of PROGRAMMES) {
    const file = join(root, "public", p.curriculum);
    if (!existsSync(file)) {
      log(`⚠ Curriculum PDF missing: public${p.curriculum} (${p.name}). Its "View curriculum" button is disabled until you add it.`);
      out[p.slug] = { pdf: false, headings: [] };
      continue;
    }
    let headings: string[] = [];
    try { headings = await readHeadings(file); } catch (e) { log(`⚠ Could not read headings from public${p.curriculum}: ${(e as Error).message}. Using the list in lib/config.ts.`); }
    if (!headings.length) log(`ℹ public${p.curriculum} has no bookmarks. "What you'll learn" uses the list in lib/config.ts.`);
    out[p.slug] = { pdf: true, headings };
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const target = join(root, "lib", "curricula.generated.json");
  const json = JSON.stringify(await scan(root), null, 2) + "\n";
  if (!existsSync(target) || readFileSync(target, "utf8") !== json) writeFileSync(target, json);
}
