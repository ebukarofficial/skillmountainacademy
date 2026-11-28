-- Stage E.1: keep an approval DECISION apart from what happened to its ACTION.
-- 0015 had one status column (the decision) plus executed_at / execution_result, so an approved request whose action
-- failed looked "approved" with no reliable way to claim, recover or tell an interrupted run from a finished one.
-- These columns give the action its own state and an atomic claim. Additive only; no existing column changes.
--   execution_status      not_applicable | awaiting_execution | executing | completed | failed
--   execution_claimed_at  when the current (or last) run claimed it; the compare-and-set token for recording its outcome
--   execution_claimed_by  who ran it (the approver, or the approver who recovered it)
--   execution_attempts    how many runs were claimed
ALTER TABLE approval_requests ADD COLUMN execution_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (execution_status IN ('not_applicable', 'awaiting_execution', 'executing', 'completed', 'failed'));
ALTER TABLE approval_requests ADD COLUMN execution_claimed_at TEXT;
ALTER TABLE approval_requests ADD COLUMN execution_claimed_by TEXT;
ALTER TABLE approval_requests ADD COLUMN execution_attempts INTEGER NOT NULL DEFAULT 0;
-- Requests decided under 0015 (local and test databases only; 0015 was never applied in production): an approved
-- request with executed_at set ran; one without it did not, and is shown as failed so an approver can review it.
UPDATE approval_requests SET execution_status = 'completed' WHERE status = 'approved' AND executed_at IS NOT NULL AND execution_status = 'not_applicable';
UPDATE approval_requests SET execution_status = 'failed' WHERE status = 'approved' AND executed_at IS NULL AND execution_status = 'not_applicable';
CREATE INDEX IF NOT EXISTS approval_requests_execution ON approval_requests(execution_status) WHERE execution_status IN ('awaiting_execution', 'executing', 'failed');
