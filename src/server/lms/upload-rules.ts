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

// Extensions that can run code. A name containing one anywhere (for example "cv.exe.pdf") is refused outright.
export const DANGEROUS_EXT = /\.(exe|com|bat|cmd|scr|pif|msi|msp|dll|cpl|jar|js|mjs|vbs|vbe|wsf|wsh|hta|ps1|psm1|sh|bash|zsh|apk|app|dmg|deb|rpm|html?|xhtml|svg|php|py|rb|pl|lnk|reg|iso)(\.|$)/i;

// Refuses names that try path tricks or carry control characters, before any cleaning.
export function unsafeName(raw: string): string | null {
  if (!raw || raw.length > 200) return "The file name is missing or too long.";
  if (/[\/\\]|\.\.|[\u0000-\u001f\u007f]/.test(raw)) return "The file name contains characters that are not allowed.";
  if (DANGEROUS_EXT.test(raw)) return "This kind of file cannot be uploaded.";
  return null;
}

export type UploadCheck = { ok: true; name: string; type: string } | { ok: false; status: number; code: string; message: string };
export function checkUpload(rawName: string, length: number, types: Record<string, string>, maxMb: number): UploadCheck {
  const bad = unsafeName(rawName || "");
  if (bad) return { ok: false, status: 400, code: "file_name", message: bad };
  const name = safeName(rawName || "");
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!name || !types[ext]) return { ok: false, status: 400, code: "file_type", message: `This file type is not allowed. Allowed: ${Object.keys(types).join(", ")}.` };
  if (!length) return { ok: false, status: 411, code: "length_required", message: "The upload size is missing." };
  if (length > maxMb * 1024 * 1024) return { ok: false, status: 413, code: "too_large", message: `Files can be up to ${maxMb} MB.` };
  return { ok: true, name, type: types[ext] };
}

// ---- content checks (Stage 2): the bytes must match the extension. Browser-supplied types are never trusted. ----
const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, s: string, at = 0) => starts(b, [...s].map((c) => c.charCodeAt(0)), at);
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

// Executable formats refused whatever the name says.
export function looksExecutable(b: Uint8Array): boolean {
  return ascii(b, "MZ") || starts(b, [0x7f, 0x45, 0x4c, 0x46]) /* ELF */ || starts(b, [0xcf, 0xfa, 0xed, 0xfe]) || starts(b, [0xfe, 0xed, 0xfa, 0xcf])
    || starts(b, [0xca, 0xfe, 0xba, 0xbe]) /* Mach-O / Java class */ || ascii(b, "#!");
}

// Names of the entries in a zip's central directory (used to refuse archives that carry programs, and to recognise Office files).
export function zipEntryNames(b: Uint8Array, max = 2000): string[] {
  const names: string[] = [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i + 46 <= b.length && names.length < max; i++) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x01 && b[i + 3] === 0x02) {
      const len = dv.getUint16(i + 28, true);
      if (i + 46 + len > b.length) break;
      names.push(new TextDecoder().decode(b.subarray(i + 46, i + 46 + len)));
      i += 45 + len;
    }
  }
  return names;
}

function textOk(b: Uint8Array): boolean {
  if (b.includes(0)) return false; // binary data
  let s: string;
  try { s = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(b.subarray(0, 4096)); } catch { return false; }
  return !/^\s*(<!doctype html|<html|<script|<svg|<\?php)/i.test(s);
}

export type ContentCheck = { ok: true } | { ok: false; message: string };
export function checkContent(ext: string, b: Uint8Array): ContentCheck {
  const no = (message: string): ContentCheck => ({ ok: false, message });
  if (!b.length) return no("The file is empty.");
  if (looksExecutable(b)) return no("This file is a program and cannot be uploaded.");
  switch (ext) {
    case "pdf": return ascii(b, "%PDF-") ? { ok: true } : no("This is not a valid PDF file.");
    case "png": return starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? { ok: true } : no("This is not a valid PNG image.");
    case "jpg": case "jpeg": return starts(b, [0xff, 0xd8, 0xff]) ? { ok: true } : no("This is not a valid JPEG image.");
    case "gif": return ascii(b, "GIF87a") || ascii(b, "GIF89a") ? { ok: true } : no("This is not a valid GIF image.");
    case "webp": return ascii(b, "RIFF") && ascii(b, "WEBP", 8) ? { ok: true } : no("This is not a valid WebP image.");
    case "doc": case "xls": case "ppt": return starts(b, OLE) ? { ok: true } : no(`This is not a valid .${ext} file.`);
    case "docx": case "xlsx": case "pptx": case "zip": {
      if (!starts(b, ZIP)) return no(`This is not a valid .${ext} file.`);
      const names = zipEntryNames(b);
      if (names.some((n) => DANGEROUS_EXT.test(n) || n.includes(".."))) return no("This archive contains programs or unsafe paths and cannot be uploaded.");
      if (ext !== "zip") {
        const want = ext === "docx" ? "word/" : ext === "xlsx" ? "xl/" : "ppt/";
        if (!names.includes("[Content_Types].xml") || !names.some((n) => n.startsWith(want))) return no(`This is not a valid .${ext} file.`);
      }
      return { ok: true };
    }
    case "txt": case "md": case "csv": return textOk(b) ? { ok: true } : no("This file is not plain text.");
    default: return no("This file type is not allowed.");
  }
}
