// Pins the owner-approved Cloudflare account ID, production D1 UUID and (optionally) the production KV namespace id in
// wrangler.jsonc (Stage 3B, owner action). Text-level edit that keeps every comment: adds "account_id" after the Worker
// "name", "database_id" to the DB binding and "id" to the KV binding. A binding without an id lets Wrangler 4 create a NEW
// resource during a deployment (automatic provisioning), which the deployment gate refuses.
// Dry run by default (prints what would change); --write applies it. Refuses to replace a DIFFERENT existing value.
//   npm run deploy:pin -- --account-id <id> --database-uuid <uuid> [--kv-id <id>] [--write]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMain, parseArgs } from "../db/args.mts";
import { identityProblems, PROD_DB, ROOT } from "../db/d1.mts";
import { configuredIdentity } from "../db/migrate-remote.mts";

export const KV_ID_RE = /^[0-9a-f]{32}$/;
export function pinText(text: string, accountId: string, databaseUuid: string, kvId?: string): { text: string; changes: string[]; failures: string[] } {
  const failures = identityProblems({ accountId, databaseUuid }, "approved identity"), changes: string[] = [];
  if (failures.length) return { text, changes, failures };
  let t = text;
  const acc = t.match(/"account_id"\s*:\s*"([^"]*)"/);
  if (acc) { if (acc[1].toLowerCase() !== accountId) failures.push("wrangler.jsonc already pins a DIFFERENT account_id; change it by hand only with the owner's approval."); }
  else {
    const nameLine = t.match(/^(\s*)"name"\s*:\s*"skillmountainacademy"\s*,\s*$/m);
    if (!nameLine) failures.push('could not find the line "name": "skillmountainacademy", in wrangler.jsonc.');
    else { t = t.replace(nameLine[0], `${nameLine[0]}\n${nameLine[1]}"account_id": "${accountId}",`); changes.push(`account_id = ${accountId}`); }
  }
  const binding = t.match(/\{[^{}]*"binding"\s*:\s*"DB"[^{}]*\}/);
  if (!binding) failures.push("could not find the DB binding in wrangler.jsonc.");
  else if (!new RegExp(`"database_name"\\s*:\\s*"${PROD_DB}"`).test(binding[0])) failures.push(`the DB binding is not for ${PROD_DB}.`);
  else {
    const id = binding[0].match(/"database_id"\s*:\s*"([^"]*)"/);
    if (id) { if (id[1].toLowerCase() !== databaseUuid) failures.push("the DB binding already pins a DIFFERENT database_id; change it by hand only with the owner's approval."); }
    else {
      const withId = binding[0].replace(/("database_name"\s*:\s*"skillmountainacademy-db"\s*,?)/, `$1 "database_id": "${databaseUuid}",`).replace(/,\s*,/g, ",").replace(/,(\s*\})$/, "$1");
      t = t.replace(binding[0], withId);
      changes.push(`DB database_id = ${databaseUuid}`);
    }
  }
  if (kvId !== undefined) {
    const kv = t.match(/\{[^{}]*"binding"\s*:\s*"KV"[^{}]*\}/);
    if (!KV_ID_RE.test(kvId)) failures.push("the KV namespace id must be 32 hexadecimal characters.");
    else if (!kv) failures.push("could not find the KV binding in wrangler.jsonc.");
    else {
      const id = kv[0].match(/"id"\s*:\s*"([^"]*)"/);
      if (id) { if (id[1].toLowerCase() !== kvId) failures.push("the KV binding already pins a DIFFERENT id; change it by hand only with the owner's approval."); }
      else { t = t.replace(kv[0], kv[0].replace(/("binding"\s*:\s*"KV")/, `$1, "id": "${kvId}"`)); changes.push(`KV id = ${kvId}`); }
    }
  }
  return { text: failures.length ? text : t, changes, failures };
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  const file = join(ROOT, "wrangler.jsonc");
  const r = pinText(readFileSync(file, "utf8"), (a.str("account-id") ?? "").toLowerCase(), (a.str("database-uuid") ?? "").toLowerCase(), a.str("kv-id")?.toLowerCase());
  for (const f of r.failures) console.log(`REFUSED  ${f}`);
  if (r.failures.length) process.exit(1);
  if (!r.changes.length) { console.log("Already pinned to these values; nothing to change."); process.exit(0); }
  for (const c of r.changes) console.log(`${a.has("write") ? "PINNED" : "WOULD PIN"}  ${c}`);
  if (a.has("write")) {
    writeFileSync(file, r.text);
    const c = configuredIdentity(file);
    console.log(`wrangler.jsonc now pins account ${c.accountId} and database ${c.databaseUuid}. Commit it through a reviewed pull request.`);
  } else console.log("Dry run. Add --write to apply.");
}
