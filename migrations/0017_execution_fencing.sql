-- Stage E.2: fencing for approved actions, so a superseded (stale) run can never commit the action itself.
-- 0016 identified a run only by its claim time, and protected only the final status write; the action's own changes
-- were separate statements that an old run could still make after a newer run had taken over.
--   approval_requests.execution_claim_id  a fresh random identifier for every claimed run (the fencing token)
--   execution_fences                      one row per run that COMMITTED. It is the first statement of the same D1
--                                         batch (one transaction) as the action's changes, its audit records and the
--                                         "completed" status. owner_check becomes NULL, and the whole batch rolls back,
--                                         unless the run still owns the current claim; effect_check becomes NULL, and
--                                         the batch rolls back, unless the action's intended result is in place. A row
--                                         here is therefore proof that the run's action committed, exactly once.
-- Additive only. Requests left "executing" by 0016 have no claim id: a recovery treats them as unreconciled and checks
-- the target's current state before doing anything.
ALTER TABLE approval_requests ADD COLUMN execution_claim_id TEXT;
CREATE TABLE IF NOT EXISTS execution_fences (
  claim_id      TEXT PRIMARY KEY NOT NULL,
  approval_id   TEXT NOT NULL REFERENCES approval_requests(id),
  owner_check   TEXT NOT NULL,
  effect_check  TEXT NOT NULL,
  committed_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS execution_fences_approval ON execution_fences(approval_id);
