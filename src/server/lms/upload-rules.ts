// Upload rules (pure, no imports, so they can be tested directly).
export const DOC_TYPES: Record<string, string> = {
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", txt: "text/plain", md: "text/markdown", csv: "text/csv",
  zip: "application/zip", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};
export const PHOTO_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
export const MAX_FILE_MB = 25;
export const MAX_PHOTO_MB = 3;
export const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);

export type UploadCheck = { ok: true; name: string; type: string } | { ok: false; status: number; code: string; message: string };
export function checkUpload(rawName: string, length: number, types: Record<string, string>, maxMb: number): UploadCheck {
  const name = safeName(rawName || "");
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!name || !types[ext]) return { ok: false, status: 400, code: "file_type", message: `This file type is not allowed. Allowed: ${Object.keys(types).join(", ")}.` };
  if (!length) return { ok: false, status: 411, code: "length_required", message: "The upload size is missing." };
  if (length > maxMb * 1024 * 1024) return { ok: false, status: 413, code: "too_large", message: `Files can be up to ${maxMb} MB.` };
  return { ok: true, name, type: types[ext] };
}
