// Keeps the AI assistant's search index in step with APPROVED materials that have text.
import type { Resource } from "./data/coursework";
import { deleteChunks, insertChunks } from "./data/ai";

export const CHUNK_CHARS = 1200;
export function chunk(text: string, size = CHUNK_CHARS): string[] {
  const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const out: string[] = [];
  let buf = "";
  for (const para of clean.split(/\n\n/)) {
    if ((buf + "\n\n" + para).length > size && buf) { out.push(buf); buf = ""; }
    if (para.length > size) { for (let i = 0; i < para.length; i += size) out.push(para.slice(i, i + size)); continue; }
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  if (buf) out.push(buf);
  return out.slice(0, 40); // at most ~48,000 characters per resource (stays under 50 D1 queries per request)
}
export async function indexResource(db: D1Database, r: Resource) {
  if (!r.approved || !r.text_content) return deleteChunks(db, r.id);
  await insertChunks(db, r.id, r.programme_slug, r.title, chunk(r.text_content));
}
export const removeResourceIndex = (db: D1Database, id: string) => deleteChunks(db, id);
