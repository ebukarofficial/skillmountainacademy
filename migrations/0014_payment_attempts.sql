-- 0014: concurrency-safe Paystack initialisation (Expansion Stage D.1.1, 28 Nov 2026). ADDITIVE ONLY.
-- One row per attempt to open a Paystack checkout for an instalment. A request must INSERT a 'claimed' row before it
-- calls Paystack; the partial unique index allows only ONE claimed / initialized / uncertain attempt per instalment, so a
-- second, simultaneous request cannot claim and cannot call Paystack. The attempt's Paystack reference is deterministic
-- (<instalment reference>-A001, -A002 ...) and unique. States:
--   claimed      a request owns the attempt and is calling Paystack now
--   initialized  Paystack returned a checkout; it is reused by every retry
--   failed       Paystack definitely refused (no transaction exists); a new attempt is allowed
--   uncertain    the outcome is unknown (timeout, provider error, crash, or a failed write after success); NO new attempt is
--                made automatically. Finance checks it with Paystack and may release it (reason recorded).
--   released     an uncertain attempt that Finance checked and released, so a new attempt is allowed
-- orders.payment_init (0013) is no longer written. No existing row changes. Local and staging only until approved.
CREATE TABLE IF NOT EXISTS payment_attempts (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES orders(id),
  instalment_id     TEXT NOT NULL REFERENCES instalments(id),
  attempt           INTEGER NOT NULL,
  reference         TEXT NOT NULL UNIQUE,
  state             TEXT NOT NULL CHECK (state IN ('claimed', 'initialized', 'failed', 'uncertain', 'released')),
  authorization_url TEXT,
  access_code       TEXT,
  detail            TEXT,
  claimed_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  released_by       TEXT,
  released_reason   TEXT,
  UNIQUE (instalment_id, attempt)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_one_active ON payment_attempts(instalment_id) WHERE state IN ('claimed', 'initialized', 'uncertain');
CREATE INDEX IF NOT EXISTS payment_attempts_state ON payment_attempts(state, updated_at);
