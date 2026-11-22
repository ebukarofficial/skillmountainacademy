// Stage 3B: proves the staging configuration cannot reach production before anyone deploys it.
//   npm run staging:check -- [--production-uuid <prod D1 UUID>] [--production-kv <prod KV id>]
// Exit 0 only when staging has its own Worker, database (by exact UUID), cache, no routes or custom domains, no cron,
// no Paystack key, no production URL or owner address, and every id is filled in.
import { readFileSync } from "node:fs";
import { stripJsonc } from "../db/migrate-remote.mts";
import { UUID_RE, ACCOUNT_RE } from "../db/d1.mts";
import { isMain, parseArgs } from "../db/args.mts";
import { PROD_WORKER } from "../cf.mts";

type Cfg = { name?: string; account_id?: string; routes?: unknown; route?: unknown; workers_dev?: boolean; triggers?: { crons?: string[] };
  d1_databases?: { binding: string; database_name?: string; database_id?: string }[]; kv_namespaces?: { binding: string; id?: string }[]; r2_buckets?: unknown[];
  vars?: Record<string, string>; define?: Record<string, string> };

export function checkStaging(staging: Cfg, production: Cfg, o: { productionUuid?: string; productionKv?: string } = {}): string[] {
  const f: string[] = [];
  if (!staging.name || staging.name === PROD_WORKER || staging.name === production.name || !/staging/.test(staging.name)) f.push(`Worker name ${staging.name} is not a separate staging Worker`);
  if (staging.routes || staging.route) f.push("staging must not have routes or custom domains");
  if (staging.workers_dev !== true) f.push("staging must be reachable only on workers.dev (workers_dev: true)");
  if (staging.triggers?.crons?.length) f.push("staging must not run the production schedule (crons) unless the owner approves");
  if (staging.r2_buckets?.length) f.push("staging must not bind R2 (not approved)");
  if (staging.account_id !== undefined && !ACCOUNT_RE.test(staging.account_id)) f.push("staging account_id is not a valid account ID");
  if (staging.account_id === undefined) f.push("staging account_id is not pinned");
  const db = staging.d1_databases ?? [];
  const prodDb = production.d1_databases?.find((d) => d.binding === "DB");
  if (db.length !== 1 || db[0].binding !== "DB") f.push("staging must have exactly one D1 binding DB");
  else {
    if (!db[0].database_name || db[0].database_name === prodDb?.database_name || !/staging/.test(db[0].database_name)) f.push(`database ${db[0].database_name} is not a separate staging database`);
    if (!db[0].database_id || !UUID_RE.test(db[0].database_id)) f.push("staging database_id (exact UUID) is not filled in");
    else if (db[0].database_id === prodDb?.database_id || db[0].database_id === o.productionUuid) f.push("staging database_id IS THE PRODUCTION DATABASE");
    if (!o.productionUuid && !prodDb?.database_id) f.push("the production D1 UUID was not supplied (--production-uuid), so separation by UUID cannot be proven");
  }
  const kv = staging.kv_namespaces?.find((k) => k.binding === "KV");
  if (!kv?.id) f.push("staging KV namespace id is not filled in");
  else if (kv.id === production.kv_namespaces?.find((k) => k.binding === "KV")?.id || kv.id === o.productionKv) f.push("staging KV IS THE PRODUCTION NAMESPACE");
  if (!o.productionKv && !production.kv_namespaces?.find((k) => k.binding === "KV")?.id) f.push("the production KV namespace id was not supplied (--production-kv), so separation of the cache cannot be proven");
  const v = staging.vars ?? {}, pv = production.vars ?? {};
  if (v.SITE_URL && v.SITE_URL === pv.SITE_URL) f.push("staging SITE_URL is the production site");
  if (v.SITE_URL && /skillmountainacademy\.com/i.test(v.SITE_URL)) f.push("staging SITE_URL points at the production domain");
  if (!v.SITE_URL) f.push("staging SITE_URL is not filled in (its workers.dev address)");
  if (v.OWNER_EMAIL && v.OWNER_EMAIL === pv.OWNER_EMAIL) f.push("staging OWNER_EMAIL is the production owner address (use a staging address)");
  if (v.ENVIRONMENT !== "staging") f.push("vars.ENVIRONMENT must be \"staging\"");
  if ((staging.define?.["process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY"] ?? '""') !== '""') f.push("staging must not carry a Paystack key");
  return f;
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  const read = (file: string) => JSON.parse(stripJsonc(readFileSync(file, "utf8"))) as Cfg;
  const f = checkStaging(read(a.str("config") ?? "wrangler.staging.jsonc"), read("wrangler.jsonc"), { productionUuid: a.str("production-uuid"), productionKv: a.str("production-kv") });
  for (const x of f) console.error(`  - ${x}`);
  console.log(f.length ? `STAGING CONFIGURATION NOT READY (${f.length})` : "STAGING CONFIGURATION ISOLATED FROM PRODUCTION");
  process.exit(f.length ? 1 : 0);
}
