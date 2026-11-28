-- 0018: fail-closed reconciliation of Paystack checkout attempts (Stage E.4, 28 Nov 2026). ADDITIVE ONLY.
-- Closes the release race found in the Stage E.3 review: Paystack is checked (not paid), the customer then pays, the
-- webhook is late, and the release commits because D1 still says unpaid. D1 cannot lock Paystack, so the protections are:
--   version            every change to an attempt increases it (trigger below). A worker acts only on the version it
--                      read, so a stale worker can never overwrite a newer state.
--   verified_*         the last answer Paystack gave for the reference, stored with the version it applies to. Only a
--                      definite 'failed' or 'abandoned' answer for the right reference, amount and currency counts.
--                      Timeouts, errors, unreadable or unknown answers are stored as 'unknown' and never count.
--   first_verified_at  when an unbroken run of definite non-success answers began. A release needs the latest answer
--                      to be at most 10 minutes old AND the run to be at least 30 minutes long (two checks 30 min apart).
--   outcome            'paid' when a successful charge was recorded for this reference; 'reconcile' when money arrived
--                      that needs a person (a charge for a released or failed attempt, a second payment for a part
--                      already paid, or a successful charge with the wrong amount). Never cleared or downgraded.
--   resolved_*         who reviewed a 'reconcile' outcome and why (the review changes no money).
-- Triggers enforce the rules for every code path, so a bug or an old Worker cannot release unsafely:
--   * a release is refused unless the stored evidence is current, definite, fresh and settled, and nothing was paid;
--   * a recorded Paystack payment sets the attempt's outcome in the same transaction as the payment row;
--   * no new checkout attempt can be opened for a paid part, or while any attempt for it needs reconciliation;
--   * an outcome is never removed or downgraded, and a paid part never becomes unpaid.
-- No existing row changes value (new columns start NULL / 0). Local and staging only until approved.
ALTER TABLE payment_attempts ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_attempts ADD COLUMN verified_status TEXT;
ALTER TABLE payment_attempts ADD COLUMN verified_at TEXT;
ALTER TABLE payment_attempts ADD COLUMN verified_version INTEGER;
ALTER TABLE payment_attempts ADD COLUMN first_verified_at TEXT;
ALTER TABLE payment_attempts ADD COLUMN outcome TEXT CHECK (outcome IS NULL OR outcome IN ('paid', 'reconcile'));
ALTER TABLE payment_attempts ADD COLUMN resolved_by TEXT;
ALTER TABLE payment_attempts ADD COLUMN resolved_reason TEXT;
CREATE INDEX IF NOT EXISTS payment_attempts_outcome ON payment_attempts(instalment_id, outcome);

CREATE TRIGGER IF NOT EXISTS payment_attempts_version AFTER UPDATE ON payment_attempts WHEN NEW.version = OLD.version BEGIN UPDATE payment_attempts SET version = OLD.version + 1 WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS payment_attempts_release_guard BEFORE UPDATE OF state ON payment_attempts WHEN NEW.state = 'released' AND OLD.state <> 'released' AND NOT (OLD.outcome IS NULL AND OLD.verified_version = OLD.version AND OLD.verified_status IN ('failed', 'abandoned') AND OLD.verified_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes') AND OLD.first_verified_at <= strftime('%Y-%m-%dT%H:%M:%fZ', OLD.verified_at, '-30 minutes') AND NOT EXISTS (SELECT 1 FROM instalments WHERE id = OLD.instalment_id AND status = 'paid') AND NOT EXISTS (SELECT 1 FROM payments WHERE provider_ref = OLD.reference OR instalment_id = OLD.instalment_id)) BEGIN SELECT RAISE(ABORT, 'payment_release_refused'); END;

CREATE TRIGGER IF NOT EXISTS payments_attempt_outcome AFTER INSERT ON payments WHEN NEW.provider = 'paystack' BEGIN UPDATE payment_attempts SET outcome = CASE WHEN state IN ('released', 'failed') OR EXISTS (SELECT 1 FROM payments p WHERE p.instalment_id = NEW.instalment_id AND p.id <> NEW.id) OR outcome = 'reconcile' THEN 'reconcile' ELSE 'paid' END WHERE reference = NEW.provider_ref; END;

CREATE TRIGGER IF NOT EXISTS payments_duplicate_bank AFTER INSERT ON payments WHEN NEW.provider <> 'paystack' BEGIN UPDATE payment_attempts SET outcome = 'reconcile' WHERE instalment_id = NEW.instalment_id AND outcome = 'paid'; END;

CREATE TRIGGER IF NOT EXISTS payment_attempts_checkout_guard BEFORE INSERT ON payment_attempts WHEN EXISTS (SELECT 1 FROM instalments WHERE id = NEW.instalment_id AND status = 'paid') OR EXISTS (SELECT 1 FROM payment_attempts WHERE instalment_id = NEW.instalment_id AND outcome IS NOT NULL AND resolved_by IS NULL) BEGIN SELECT RAISE(ABORT, 'checkout_blocked'); END;

CREATE TRIGGER IF NOT EXISTS payment_attempts_outcome_kept BEFORE UPDATE OF outcome ON payment_attempts WHEN OLD.outcome IS NOT NULL AND (NEW.outcome IS NULL OR (OLD.outcome = 'reconcile' AND NEW.outcome <> 'reconcile')) BEGIN SELECT RAISE(ABORT, 'payment_outcome_kept'); END;

CREATE TRIGGER IF NOT EXISTS instalments_paid_kept BEFORE UPDATE OF status ON instalments WHEN OLD.status = 'paid' AND NEW.status <> 'paid' BEGIN SELECT RAISE(ABORT, 'instalment_paid_kept'); END;
