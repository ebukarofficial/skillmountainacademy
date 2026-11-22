// Decrypts an encrypted backup for a deliberate remote restore (Stage 3A, runbook section 6.2). Verifies the ciphertext and
// the decrypted SQL against the manifest. The output is CONFIDENTIAL plaintext: import it, then delete it.
//   npm run db:decrypt -- backups/<file>.sql.enc --key owner-backup-private.pem --out <path>.sql
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { isMain, parseArgs } from "./args.mts";
import { decryptFile, sha256File, type Manifest } from "./dump.mts";

export function decryptBackup(encFile: string, key: string, out: string): string {
  const file = resolve(encFile);
  if (!file.endsWith(".enc")) throw new Error("Not an encrypted backup (.sql.enc).");
  if (existsSync(out)) throw new Error(`${out} already exists; choose a new path.`);
  const m = JSON.parse(readFileSync(`${file.slice(0, -4)}.manifest.json`, "utf8")) as Manifest;
  if (!m.encrypted || sha256File(file) !== m.encrypted.sha256) throw new Error("The encrypted file does not match its manifest.");
  decryptFile(file, key, out);
  if (sha256File(out) !== m.file.sha256) { rmSync(out, { force: true }); throw new Error("The decrypted SQL does not match the manifest."); }
  return out;
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  const [f] = a.positional;
  if (!f || !a.str("key") || !a.str("out")) { console.error("Usage: npm run db:decrypt -- <backup.sql.enc> --key <private.pem> --out <new-path.sql>"); process.exit(2); }
  try { console.log(`Decrypted and verified: ${decryptBackup(f, a.str("key")!, a.str("out")!)} (confidential: delete it after the import).`); }
  catch (e) { console.error(`FAIL: ${(e as Error).message}`); process.exit(1); }
}
