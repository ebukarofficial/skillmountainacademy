-- 0013: registration integrity (Expansion Stage D.1, 28 Nov 2026). ADDITIVE ONLY.
-- * idempotency_key: one per checkout attempt, sent by the website. A retried registration with the same key returns
--   the order already created instead of creating a second one. The unique index makes this hold even for two
--   requests arriving at the same moment. Older orders keep NULL (several NULLs are allowed by a unique index).
-- * request_fingerprint: a hash of what was asked for (programme, plan, method, email, group), so a key reused for a
--   different request is refused rather than silently answered with another order.
-- * payment_init: the Paystack initialisation already made for part 1 (reference and checkout address), so a retry
--   reuses it instead of opening a second payment attempt.
-- No existing row or amount changes. Local and staging only until the owner approves it.
ALTER TABLE orders ADD COLUMN idempotency_key TEXT;
ALTER TABLE orders ADD COLUMN request_fingerprint TEXT;
ALTER TABLE orders ADD COLUMN payment_init TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key ON orders(idempotency_key);
