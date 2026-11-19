// Curriculum PDFs: what the prebuild step (scripts/curricula.mts) found in public/curricula/.
import data from "./curricula.generated.json";
import type { Programme } from "./config";

type Info = { pdf: boolean; headings: string[] };
const CURRICULA = data as Record<string, Info>;

export const curriculumInfo = (slug: string): Info => CURRICULA[slug] ?? { pdf: false, headings: [] };
export const hasPdf = (p: Programme) => curriculumInfo(p.slug).pdf;
// "What you'll learn": the PDF's headings when it has bookmarks, otherwise the list in lib/config.ts.
export const learnList = (p: Programme) => {
  const h = curriculumInfo(p.slug).headings;
  return h.length ? h : p.learn;
};
