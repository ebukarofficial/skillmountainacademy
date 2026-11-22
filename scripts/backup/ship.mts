// Backup shipping checks for the scheduled backup workflow (Stage 3B). Nothing is uploaded by this script: the workflow
// uploads with the storage provider's CLI, using the keys and checks produced here.
//
//   inspect   before upload: exactly one ENCRYPTED backup (.sql.enc) and its manifest; NO plaintext .sql anywhere in the
//             folder; ciphertext SHA-256 = manifest; manifest identity = the approved account ID and D1 UUID; taken in the
//             last 2 hours; holds institutional records; compared with the previous manifest (if any): institutional rows
//             must not fall by more than 5%, and a migration change is reported. Produces write-once object keys
//             (prefix/YYYY/MM/<timestamped name>): a key is never reused, so nothing is overwritten.
//   verify    after upload: the stored object's size and SHA-256 checksum (head-object with checksum mode) equal the local
//             encrypted file.
//   npm run backup:ship -- inspect --dir backups --account-id <id> --database-uuid <uuid> [--previous prev.manifest.json] [--prefix sma-d1] [--github-output]
//   npm run backup:ship -- verify --file <file.sql.enc> --head head.json
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { isMain, parseArgs } from "../db/args.mts";
import { identityProblems, sameIdentity, type Identity } from "../db/d1.mts";
import type { Manifest } from "../db/dump.mts";

export type Inspection = { ok: boolean; failures: string[]; warnings: string[]; encFile: string | null; manifestFile: string | null;
  keys: { enc: string; manifest: string } | null; sha256: string | null; bytes: number | null };

export function inspectBackup(o: { dir: string; approved: Identity; previous?: Manifest | null; prefix?: string; now?: Date; maxAgeHours?: number; maxDropPercent?: number }): Inspection {
  const failures: string[] = [], warnings: string[] = [];
  const out: Inspection = { ok: false, failures, warnings, encFile: null, manifestFile: null, keys: null, sha256: null, bytes: null };
  failures.push(...identityProblems(o.approved, "approved identity"));
  if (!existsSync(o.dir)) { failures.push(`${o.dir} does not exist.`); return out; }
  const names = readdirSync(o.dir);
  const plain = names.filter((n) => n.endsWith(".sql"));
  if (plain.length) failures.push(`plaintext backup present (${plain.length} file(s)): only encrypted backups may be stored. Use --encrypt-for.`);
  const enc = names.filter((n) => n.endsWith(".sql.enc"));
  if (enc.length !== 1) { failures.push(`expected exactly one encrypted backup (.sql.enc), found ${enc.length}.`); return out; }
  const encFile = join(o.dir, enc[0]);
  const manifestFile = join(o.dir, `${enc[0].slice(0, -4)}.manifest.json`);
  out.encFile = encFile;
  if (!existsSync(manifestFile)) { failures.push("the manifest is missing."); return out; }
  out.manifestFile = manifestFile;
  const m = JSON.parse(readFileSync(manifestFile, "utf8")) as Manifest;
  const bytes = readFileSync(encFile);
  out.sha256 = createHash("sha256").update(bytes).digest("hex");
  out.bytes = statSync(encFile).size;
  if (!m.encrypted) failures.push("the manifest does not describe an encrypted backup.");
  else if (m.encrypted.sha256 !== out.sha256) failures.push("the encrypted file does not match its manifest (SHA-256).");
  if (m.source.kind !== "remote") failures.push(`the backup was taken from a ${m.source.kind} database, not production.`);
  if (!sameIdentity(m.source.identity, o.approved)) failures.push("the backup is not of the approved account ID and D1 UUID.");
  const age = ((o.now ?? new Date()).getTime() - Date.parse(m.createdAt)) / 3_600_000;
  if (!(Number.isFinite(age) && age >= -5 / 60 && age <= (o.maxAgeHours ?? 2))) failures.push(`the backup is ${Number.isFinite(age) ? age.toFixed(1) : "?"} hours old.`);
  const rows = m.totals.institutionalRows ?? 0;
  if (rows === 0) failures.push("the backup holds no institutional records (wrong database or failed export).");
  if (o.previous) {
    const prev = o.previous.totals.institutionalRows ?? 0;
    if (prev > 0 && rows < prev * (1 - (o.maxDropPercent ?? 5) / 100)) failures.push(`institutional records fell from ${prev} to ${rows} since the previous backup (more than ${o.maxDropPercent ?? 5}%): investigate before trusting this database.`);
    if (o.previous.migration.latest !== m.migration.latest) warnings.push(`migration changed since the previous backup: ${o.previous.migration.latest ?? "none"} -> ${m.migration.latest ?? "none"}.`);
  } else warnings.push("no previous manifest to compare with (first backup, or storage not readable).");
  const d = new Date(m.createdAt);
  const prefix = (o.prefix ?? "sma-d1").replace(/\/+$/, "");
  const folder = `${prefix}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  out.keys = { enc: `${folder}/${basename(encFile)}`, manifest: `${folder}/${basename(manifestFile)}` };
  out.ok = failures.length === 0;
  return out;
}

// head-object output (with --checksum-mode ENABLED): { ContentLength, ChecksumSHA256 (base64) }.
export function verifyUploaded(head: { ContentLength?: number; ChecksumSHA256?: string }, file: string): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const bytes = readFileSync(file);
  if (head.ContentLength !== bytes.length) failures.push(`stored size ${head.ContentLength ?? "?"} differs from local ${bytes.length}.`);
  const b64 = createHash("sha256").update(bytes).digest("base64");
  if (!head.ChecksumSHA256) failures.push("the storage did not return a SHA-256 checksum (upload with --checksum-algorithm SHA256).");
  else if (head.ChecksumSHA256 !== b64) failures.push("the stored SHA-256 differs from the local encrypted file.");
  return { ok: failures.length === 0, failures };
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  const [mode] = a.positional;
  if (mode === "inspect") {
    const prev = a.str("previous") && existsSync(a.str("previous")!) ? JSON.parse(readFileSync(a.str("previous")!, "utf8")) as Manifest : null;
    const r = inspectBackup({ dir: a.str("dir") ?? "backups", approved: { accountId: (a.str("account-id") ?? "").toLowerCase(), databaseUuid: (a.str("database-uuid") ?? "").toLowerCase() }, previous: prev, prefix: a.str("prefix") });
    for (const w of r.warnings) console.log(`NOTE  ${w}`);
    for (const f of r.failures) console.log(`FAIL  ${f}`);
    if (r.ok && a.has("github-output") && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `enc_file=${r.encFile}\nmanifest_file=${r.manifestFile}\nenc_key=${r.keys!.enc}\nmanifest_key=${r.keys!.manifest}\n`);
    console.log(r.ok ? `BACKUP READY TO SHIP: ${r.keys!.enc} (${r.bytes} bytes)` : "BACKUP NOT SHIPPED.");
    process.exit(r.ok ? 0 : 1);
  } else if (mode === "verify") {
    const r = verifyUploaded(JSON.parse(readFileSync(a.str("head") ?? "", "utf8")), a.str("file") ?? "");
    for (const f of r.failures) console.log(`FAIL  ${f}`);
    console.log(r.ok ? "STORED COPY VERIFIED (size and SHA-256)." : "STORED COPY NOT VERIFIED.");
    process.exit(r.ok ? 0 : 1);
  } else { console.error("Usage: npm run backup:ship -- inspect|verify ..."); process.exit(2); }
}
