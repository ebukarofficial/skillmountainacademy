-- Skill Mountain Academy: first schema. Apply with:
--   npx wrangler d1 migrations apply skillmountainacademy-db --remote
-- Money is stored in kobo (1 naira = 100 kobo) as integers, so amounts always add up exactly.
-- Times are ISO 8601 strings in UTC.

CREATE TABLE programmes (
  slug              TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  price_kobo        INTEGER NOT NULL,
  was_kobo          INTEGER,
  timed_price_kobo  INTEGER,
  group_price_kobo  INTEGER,
  training_months   INTEGER NOT NULL,
  internship_months INTEGER NOT NULL,
  level             TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- One row per person: a learner, a parent, a child (through a parent) or a group member added by a lead learner.
CREATE TABLE registrations (
  id                TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('learner', 'parent', 'child', 'group_member')),
  lead_id           TEXT REFERENCES registrations(id),  -- group lead, or the parent of a child
  programme_slug    TEXT NOT NULL,
  first_name        TEXT NOT NULL,
  middle_name       TEXT,
  surname           TEXT,
  email             TEXT NOT NULL,
  phone             TEXT,
  country           TEXT,
  city              TEXT,
  adult             TEXT,
  education         TEXT,
  english           TEXT,
  computer_literate TEXT,
  background        TEXT,
  background_detail TEXT,
  why               TEXT,
  goals             TEXT,
  industry          TEXT,
  guardian_name     TEXT,
  guardian_phone    TEXT,
  terms             TEXT,
  ip_hash           TEXT
);
CREATE INDEX registrations_email ON registrations(email);
CREATE INDEX registrations_lead ON registrations(lead_id);

CREATE TABLE orders (
  id               TEXT PRIMARY KEY,
  reference        TEXT NOT NULL UNIQUE,
  created_at       TEXT NOT NULL,
  registration_id  TEXT NOT NULL REFERENCES registrations(id),
  programme_slug   TEXT NOT NULL,
  plan             TEXT NOT NULL CHECK (plan IN ('full', 'parts')),
  method           TEXT NOT NULL CHECK (method IN ('paystack', 'bank')),
  total_kobo       INTEGER NOT NULL,   -- what the learner owes in NGN, computed by the server
  regular_kobo     INTEGER NOT NULL,   -- the programme's regular price at the time
  hold_id          TEXT,               -- the price hold used, if any
  group_size       INTEGER NOT NULL DEFAULT 1,
  display_currency TEXT NOT NULL DEFAULT 'NGN',
  fx_rate          REAL,               -- units of display_currency per 1 NGN, when the order was made
  fx_at            TEXT,               -- when that rate was fetched
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'part_paid', 'paid', 'cancelled'))
);
CREATE INDEX orders_registration ON orders(registration_id);

-- Pay in full = one instalment. Pay in 3 parts = three (50/30/20). They always add up to orders.total_kobo.
CREATE TABLE instalments (
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL REFERENCES orders(id),
  seq              INTEGER NOT NULL,
  amount_kobo      INTEGER NOT NULL,
  due_date         TEXT NOT NULL,      -- YYYY-MM-DD (Africa/Lagos)
  reference        TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'paid', 'overdue')),
  reminder_sent_at TEXT,
  link_sent_at     TEXT,
  paid_at          TEXT,
  UNIQUE (order_id, seq)
);
CREATE INDEX instalments_due ON instalments(status, due_date);

CREATE TABLE payments (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  instalment_id TEXT REFERENCES instalments(id),
  provider      TEXT NOT NULL,         -- 'paystack' or 'bank'
  provider_ref  TEXT NOT NULL UNIQUE,  -- one payment row per Paystack reference: the idempotency key
  amount_kobo   INTEGER NOT NULL,
  currency      TEXT NOT NULL,
  status        TEXT NOT NULL,
  paid_at       TEXT,
  created_at    TEXT NOT NULL
);

-- Paystack webhook deliveries already processed (Paystack can send the same event more than once).
CREATE TABLE webhook_events (
  id          TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

-- Timed price holds (dormant until a programme has a timed price).
CREATE TABLE holds (
  id             TEXT PRIMARY KEY,
  visitor_hash   TEXT NOT NULL,
  ip_hash        TEXT,
  programme_slug TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  cooldown_until TEXT NOT NULL,
  UNIQUE (visitor_hash, programme_slug)
);
CREATE INDEX holds_ip ON holds(ip_hash, programme_slug);

CREATE TABLE children_enquiries (
  id                 TEXT PRIMARY KEY,
  created_at         TEXT NOT NULL,
  parent_name        TEXT NOT NULL,
  email              TEXT NOT NULL,
  phone              TEXT NOT NULL,
  child_age          INTEGER NOT NULL,
  programme_interest TEXT NOT NULL,
  message            TEXT,
  ip_hash            TEXT
);

-- Fixed-window rate limits for public forms.
CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
