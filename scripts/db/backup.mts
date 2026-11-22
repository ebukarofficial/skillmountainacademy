// Backup command (Stage 3A). Writes a logical backup and its manifest (see scripts/db/dump.mts for the format).
//   npm run db:backup -- --local-dir <isolated-dir> [--out backups/] [--encrypt-for owner-backup-public.pem]
//   npm run db:backup -- --remote --owner-approved --account-id <id> --database-uuid <uuid> --encrypt-for <public.pem> [--out backups/]   (owner only; read-only)
// Prints only the file name, size, counts and checksum. Never prints data or credentials.
import { resolve } from "node:path";
import { isMain, parseArgs } from "./args.mts";
import { D1Error, localTarget, verifiedRemote, type Target } from "./d1.mts";
import { backup } from "./dump.mts";

if (isMain(import.meta.url)) {
  const a = parseArgs();
  try {
    if (!a.has("remote") && !a.str("local-dir")) throw new D1Error("Give --local-dir <isolated-dir> or --remote --owner-approved --account-id <id> --database-uuid <uuid>.");
    const t: Target = a.has("remote")
      ? verifiedRemote({ ownerApproved: a.has("owner-approved"), accountId: a.str("account-id"), databaseUuid: a.str("database-uuid"), database: a.str("database") }).target
      : localTarget(resolve(a.str("local-dir")!), { reuse: true });
    const r = backup(t, a.str("out") ?? "backups", { encryptFor: a.str("encrypt-for"), label: a.str("label") });
    const m = r.manifest;
    console.log(`Backup: ${r.file}`);
    console.log(`Manifest: ${r.manifestFile}`);
    console.log(`Migration ${m.migration.latest ?? "none"} | ${m.totals.tables} tables | ${m.totals.rows} rows (${m.totals.institutionalRows} institutional) | ${m.triggers.length} triggers | ${m.indexes} indexes`);
    console.log(`SHA-256 ${m.encrypted ? m.encrypted.sha256 : m.file.sha256} (${m.encrypted ? m.encrypted.bytes : m.file.bytes} bytes${m.encrypted ? ", encrypted; plaintext removed" : ""})`);
    for (const w of m.warnings) console.log(`WARNING: ${w}`);
    console.log("Next: npm run db:restore:verify -- <the backup file>   (a backup is not trusted until its restore is verified)");
  } catch (e) { console.error(`FAIL: ${(e as Error).message}`); process.exit(1); }
}
