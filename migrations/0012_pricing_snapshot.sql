-- 0012: country-based tuition snapshot on orders (Expansion Stage D, 27 Nov 2026). ADDITIVE ONLY.
-- Every new order records, at the moment it is made, which country of residence and which network country were seen,
-- which tuition tier and currency applied, the tuition amount in that currency, the currency actually charged by the
-- payment provider, and a JSON snapshot of the quote (price source, exchange rate, source, time and rounding).
-- Existing orders are NOT touched: their new columns stay NULL, which means "made before Stage D" (charged in NGN, as
-- recorded in total_kobo). Nothing here changes any amount. Local and staging only until the owner approves it.
-- ISO 3166-1 alpha-2 declared by the student (validated)
ALTER TABLE orders ADD COLUMN residence_country TEXT;
-- ISO alpha-2 from Cloudflare request metadata (supporting signal)
ALTER TABLE orders ADD COLUMN ip_country TEXT;
-- local | international | international_legacy_ngn
ALTER TABLE orders ADD COLUMN pricing_tier TEXT;
-- currency of the tuition that applied: NGN (local, or no international price set), USD, GBP or EUR
ALTER TABLE orders ADD COLUMN tuition_currency TEXT;
-- tuition in minor units of tuition_currency, when one applies
ALTER TABLE orders ADD COLUMN tuition_minor INTEGER;
-- what the provider charges (NGN today); NULL on older orders = NGN
ALTER TABLE orders ADD COLUMN charge_currency TEXT;
-- JSON: the full server quote used for this order
ALTER TABLE orders ADD COLUMN pricing_snapshot TEXT;
