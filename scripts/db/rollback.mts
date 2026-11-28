// Worker rollback compatibility (Stage 3A.1).
//
// "The candidate expects a lower migration number" is NOT enough to approve a rollback: a migration can be additive in
// schema yet change data or behaviour that an older Worker does not understand. For every migration this file records
// what an OLDER Worker (one that does not know the migration) would face, in five areas: schema, data/behaviour,
// triggers/database writes, authentication/sessions, and security. decideRollback() combines them into one verdict:
//
//   SAFE            same schema version, no crossed migrations, not below the security floor: a code-only rollback
//   CHECK_REQUIRED  allowed only after the listed read-only checks pass and the listed actions are done
//   UNSAFE          not without an additional migration or code change (or the migration history is unknown)
//   PROHIBITED      crosses the Stage 2C security floor; never without the owner's explicit written exception, and even
//                   then at best CHECK_REQUIRED
//
// A migration with no assessment here makes every rollback across it UNSAFE (a test enforces that each migration file
// has an entry). Facts are counts from read-only queries, gathered with `npm run db:rollback-check`.
//   npm run db:rollback-check -- --candidate-expected 0009_owner.sql (--local-dir <isolated> | --remote --owner-approved
//     --account-id <id> --database-uuid <uuid>) [--owner-security-exception "Name"] [--version-id <id> --record <file.json>]
// The record (Stage 3B) is what `npm run cf -- worker-rollback` requires: verdict, identity, candidate version, facts.
export type RollbackRecord = { at: string; candidateExpected: string; versionId: string | null; identity: { accountId: string; databaseUuid: string } | null;
  applied: string[]; facts: Record<string, number>; verdict: Verdict; actions: string[]; reasons: string[] };
import { isMain, parseArgs } from "./args.mts";
import { localTarget, query, verifiedRemote, type Target } from "./d1.mts";
import { resolve, dirname } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

export type Verdict = "SAFE" | "CHECK_REQUIRED" | "UNSAFE" | "PROHIBITED";
export type Area = "schema" | "data" | "triggers" | "auth" | "security";
// A read-only check: passes when the count is zero. onFail "unsafe" = the rollback becomes UNSAFE; "action" = it stays
// CHECK_REQUIRED with the remediation listed.
export type Check = { id: string; area: Area; description: string; sql: string; onFail: "unsafe" | "action"; remediation: string };
export type MigrationCompat = { olderWorker: "safe" | "check" | "unsafe"; areas: Partial<Record<Area, string>>; checks?: Check[]; actions?: string[]; unsafeBecause?: string };

// The Stage 2C security floor: Workers that expect 0010 or later carry the owner model, mandatory owner MFA, account-bound
// owner identity and the audit protections. Anything older is below the floor.
export const SECURITY_FLOOR = "0010_owner_integrity.sql";

export const COMPAT: Record<string, MigrationCompat> = {
  "0001_init.sql": { olderWorker: "safe", areas: { schema: "baseline" } },
  "0002_seed_programmes.sql": { olderWorker: "safe", areas: { schema: "no schema change", data: "programme catalogue rows; an older Worker prices from its own lib/config.ts" } },
  "0003_lms.sql": { olderWorker: "unsafe", unsafeBecause: "a Worker without the learning platform would remove sign-in, portals, classes and records that students and staff depend on",
    areas: { schema: "adds the LMS tables", data: "all LMS records become unreachable", auth: "no sign-in at all in an older Worker" } },
  "0004_admissions.sql": { olderWorker: "check",
    areas: { schema: "additive (admissions tables, instructor verification columns)", data: "an older Worker ignores admissions modes, capacity and instructor verification", security: "unapproved instructor accounts would be treated as active instructors" },
    checks: [
      { id: "instructors_not_approved", area: "security", description: "active instructor accounts that are not verified 'approved'", onFail: "unsafe",
        sql: "SELECT COUNT(*) AS n FROM users WHERE role = 'instructor' AND status = 'active' AND COALESCE(verification, '') <> 'approved'",
        remediation: "an older Worker would let these unverified instructors teach; suspend them first or do not roll back" },
      { id: "admissions_restricted", area: "data", description: "programmes whose admissions are closed, scheduled, capacity-limited or hidden", onFail: "action",
        sql: "SELECT COUNT(*) AS n FROM programme_admissions WHERE mode <> 'open' OR enforce_capacity = 1 OR listed = 0",
        remediation: "an older Worker would accept registrations for these programmes; the owner must accept that or close registrations another way" },
    ] },
  "0005_identity.sql": { olderWorker: "check",
    areas: { schema: "additive (staff numbers, email preferences)", data: "registration and staff numbers are not shown", security: "email opt-outs are ignored" },
    checks: [{ id: "email_opt_outs", area: "data", description: "users who turned off optional emails", onFail: "action",
      sql: "SELECT COUNT(*) AS n FROM users WHERE email_prefs IS NOT NULL AND (email_prefs LIKE '%false%')",
      remediation: "an older Worker would send them optional emails again; the owner must accept that" }] },
  "0006_instructor_profile.sql": { olderWorker: "safe", areas: { schema: "additive instructor profile columns", data: "profile details not shown" } },
  "0007_refinement.sql": { olderWorker: "check",
    areas: { schema: "additive (settings, call bookings, assistant enquiries, weekly items, contact log)", data: "the AI Automation programme and engagement settings are unknown to an older Worker" },
    checks: [{ id: "ai_automation_records", area: "data", description: "enrolments, orders or registrations for the ai-automation programme", onFail: "unsafe",
      sql: "SELECT (SELECT COUNT(*) FROM enrolments WHERE programme_slug = 'ai-automation') + (SELECT COUNT(*) FROM orders WHERE programme_slug = 'ai-automation') + (SELECT COUNT(*) FROM registrations WHERE programme_slug = 'ai-automation') AS n",
      remediation: "an older Worker has no ai-automation programme and cannot show or bill these records" }] },
  "0008_security.sql": { olderWorker: "check",
    areas: { schema: "additive (MFA tables, session activity and MFA columns)", auth: "an older Worker treats sessions still WAITING for the authenticator code as fully signed in, and enforces no idle limit", security: "no MFA, no 10-minute student idle limit" },
    checks: [{ id: "mfa_pending_sessions", area: "auth", description: "sessions waiting for the authenticator code", onFail: "action",
      sql: "SELECT COUNT(*) AS n FROM auth_sessions WHERE mfa_pending = 1", remediation: "they would become full sessions: clear all sessions immediately after the rollback" }],
    actions: ["Immediately after the rollback, end every session (DELETE FROM auth_sessions on the production database, with owner approval) so nobody keeps a session the older Worker would treat differently."] },
  "0009_owner.sql": { olderWorker: "check",
    areas: { schema: "additive (removal columns, removal requests, mfa_required)", data: "removal requests are invisible", auth: "removed accounts stay blocked only because they are also suspended", security: "an older Worker can REACTIVATE a permanently removed account and ignores forced MFA re-enrolment" },
    checks: [{ id: "removed_accounts", area: "security", description: "permanently removed accounts", onFail: "action",
      sql: "SELECT COUNT(*) AS n FROM users WHERE removed_at IS NOT NULL", remediation: "an older Worker could reactivate them; the owner must watch for reactivation until the newer Worker returns" }] },
  "0010_owner_integrity.sql": { olderWorker: "check",
    areas: { schema: "additive (owner_record) plus four triggers", triggers: "older Workers never update or delete audit_log rows outside retention (365+ days) and never write owner_record, so the triggers do not break them",
      security: "a Stage 2B Worker reads the owner set-up from app_settings, not owner_record, identifies the owner by email only and allows owner actions without the code" },
    checks: [{ id: "bootstrap_only_in_owner_record", area: "security", description: "owner set-up recorded only in owner_record (invisible to a Stage 2B Worker)", onFail: "unsafe",
      sql: "SELECT COUNT(*) AS n FROM owner_record WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'owner_bootstrap')",
      remediation: "a Stage 2B Worker would offer the one-time owner set-up again; do not roll back below Stage 2C" }] },
  "0011_catalogue.sql": { olderWorker: "check",
    areas: { schema: "additive (schools, programme_drafts, catalogue columns on programmes, duration snapshot on enrolments)", data: "an older Worker prices and names programmes from its own lib/config.ts and ignores drafts, schools and publication status" },
    checks: [{ id: "catalogue_published_changes", area: "data", description: "programmes published, paused or retired through the catalogue (changes an older Worker would not honour)", onFail: "unsafe",
      sql: "SELECT COUNT(*) AS n FROM programmes WHERE published_at IS NOT NULL OR status <> 'published'",
      remediation: "an older Worker would keep selling a paused or retired programme, or reject a newly published one; do not roll back below 0011 after the first catalogue publication" }] },
  "0012_pricing_snapshot.sql": { olderWorker: "safe",
    areas: { schema: "additive nullable pricing-snapshot columns on orders", data: "an older Worker leaves the new columns empty on the orders it creates; charging (NGN) and existing orders are unchanged" } },
  "0013_order_idempotency.sql": { olderWorker: "check",
    areas: { schema: "additive idempotency columns and a unique index on orders", data: "an older Worker writes NULL keys (allowed by the unique index) and does not de-duplicate retries or guarantee a pricing snapshot" },
    checks: [{ id: "orders_with_pricing_snapshot", area: "data", description: "orders created by a Stage D.1 Worker (an older Worker would create orders without the required pricing record)", onFail: "action",
      sql: "SELECT COUNT(*) AS n FROM orders WHERE pricing_snapshot IS NOT NULL",
      remediation: "rolling back below Stage D.1 lets new orders be created without a pricing snapshot; roll back only with registrations closed" }] },
};

const num = (m: string) => Number(m.slice(0, 4));
export type CheckResult = Check & { migration: string; value: number | null; outcome: "pass" | "fail" | "unknown" };
export type Decision = { verdict: Verdict; reasons: string[]; crossed: string[]; checks: CheckResult[]; actions: string[] };

export function decideRollback(o: { candidateExpected: string; dbApplied: string[] | null; facts?: Record<string, number>; ownerSecurityException?: string; known?: string[] }): Decision {
  const reasons: string[] = [], actions: string[] = [], checks: CheckResult[] = [];
  const known = o.known ?? Object.keys(COMPAT);
  const out = (verdict: Verdict, crossed: string[] = []): Decision => ({ verdict, reasons, crossed, checks, actions });
  if (!/^\d{4}_.+\.sql$/.test(o.candidateExpected) || !known.includes(o.candidateExpected)) { reasons.push(`The candidate's expected migration ${o.candidateExpected} is not a known migration.`); return out("UNSAFE"); }
  if (!o.dbApplied?.length) { reasons.push("The database's migration history is unknown: no rollback decision is possible (fail closed)."); return out("UNSAFE"); }
  const latest = o.dbApplied.at(-1)!;
  if (num(o.candidateExpected) > num(latest)) { reasons.push(`The candidate expects ${o.candidateExpected} but the database is at ${latest}: it needs schema that does not exist.`); return out("UNSAFE"); }
  const crossed = o.dbApplied.filter((m) => num(m) > num(o.candidateExpected));
  const unassessed = crossed.filter((m) => !COMPAT[m]);
  if (unassessed.length) { reasons.push(`No compatibility assessment for ${unassessed.join(", ")}: rolling back across it is not allowed until it is assessed.`); return out("UNSAFE", crossed); }
  let verdict: Verdict = "SAFE";
  const below = num(o.candidateExpected) < num(SECURITY_FLOOR);
  if (below) {
    if (!o.ownerSecurityException?.trim()) { reasons.push(`The candidate is below the Stage 2C security floor (it expects ${o.candidateExpected}, the floor is ${SECURITY_FLOOR}). Prohibited without the owner's explicit written approval.`); verdict = "PROHIBITED"; }
    else { reasons.push(`Below the Stage 2C security floor: owner exception recorded (${o.ownerSecurityException.trim()}). Security weaknesses fixed in Stages 2B/2C return while this Worker runs.`); verdict = "CHECK_REQUIRED"; }
  }
  for (const m of crossed) {
    const c = COMPAT[m];
    for (const [area, text] of Object.entries(c.areas)) reasons.push(`${m} [${area}]: ${text}`);
    if (c.olderWorker === "unsafe") { reasons.push(`${m}: UNSAFE: ${c.unsafeBecause}.`); if (verdict !== "PROHIBITED") verdict = "UNSAFE"; }
    for (const ch of c.checks ?? []) {
      const v = o.facts?.[ch.id];
      const outcome = v === undefined ? "unknown" : v === 0 ? "pass" : "fail";
      checks.push({ ...ch, migration: m, value: v ?? null, outcome });
      if (outcome === "fail" && ch.onFail === "unsafe" && verdict !== "PROHIBITED") { verdict = "UNSAFE"; reasons.push(`${m}: check ${ch.id} failed (${v}): ${ch.remediation}.`); }
      else if (outcome !== "pass" && verdict === "SAFE") verdict = "CHECK_REQUIRED";
      if (outcome === "fail" && ch.onFail === "action") actions.push(`${ch.id}: ${ch.remediation}.`);
    }
    for (const a of c.actions ?? []) { actions.push(a); if (verdict === "SAFE") verdict = "CHECK_REQUIRED"; }
  }
  if (verdict === "SAFE") reasons.push(crossed.length ? "All crossed migrations are compatible." : "Same schema version as the database: a code-only rollback.");
  if (checks.some((c) => c.outcome === "unknown")) reasons.push("Some checks have not been run against the database yet (npm run db:rollback-check).");
  return out(verdict, crossed);
}

// Gathers the facts (read-only counts) for the checks a rollback to `candidateExpected` would need.
export function gatherFacts(t: Target, candidateExpected: string, applied: string[]): Record<string, number> {
  const facts: Record<string, number> = {};
  for (const m of applied.filter((x) => num(x) > num(candidateExpected))) {
    for (const ch of COMPAT[m]?.checks ?? []) {
      const [rows] = query(t, ch.sql);
      facts[ch.id] = Number((rows[0] as { n?: number })?.n ?? NaN);
    }
  }
  return facts;
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  try {
    const cand = a.str("candidate-expected");
    if (!cand) throw new Error("Give --candidate-expected <NNNN_name.sql> (the last migration file at the candidate Worker's commit, or its EXPECTED_MIGRATION).");
    const t: Target = a.has("remote")
      ? verifiedRemote({ ownerApproved: a.has("owner-approved"), accountId: a.str("account-id"), databaseUuid: a.str("database-uuid") }).target
      : localTarget(resolve(a.str("local-dir") ?? ""), { reuse: true });
    const [rows] = query(t, "SELECT name FROM d1_migrations ORDER BY id");
    const applied = rows.map((r) => String(r.name));
    const d = decideRollback({ candidateExpected: cand, dbApplied: applied, facts: gatherFacts(t, cand, applied), ownerSecurityException: a.str("owner-security-exception") });
    if (a.str("record")) {
      const rec: RollbackRecord = { at: new Date().toISOString(), candidateExpected: cand, versionId: a.str("version-id") ?? null,
        identity: t.kind === "remote" && t.identity ? { ...t.identity } : null, applied, facts: gatherFacts(t, cand, applied), verdict: d.verdict, actions: d.actions, reasons: d.reasons };
      mkdirSync(dirname(resolve(a.str("record")!)), { recursive: true });
      writeFileSync(resolve(a.str("record")!), `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
    }
    for (const r of d.reasons) console.log(`  ${r}`);
    for (const c of d.checks) console.log(`CHECK ${c.outcome.toUpperCase().padEnd(7)} ${c.id} = ${c.value ?? "?"} (${c.description})`);
    for (const x of d.actions) console.log(`ACTION  ${x}`);
    console.log(`ROLLBACK VERDICT: ${d.verdict}`);
    process.exit(d.verdict === "SAFE" || d.verdict === "CHECK_REQUIRED" ? 0 : 1);
  } catch (e) { console.error(`FAIL: ${(e as Error).message}`); process.exit(2); }
}
