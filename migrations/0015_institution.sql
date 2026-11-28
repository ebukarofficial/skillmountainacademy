-- 0015: institutional structure, staff invitations and approval requests (Expansion Stage E, 28 Nov 2026). ADDITIVE ONLY.
-- Nothing is seeded and nothing is backfilled: no department exists, no one is assigned, no approval rule is active and
-- no permission changes until the owner acts. Existing accounts, groups, sessions and audit records are untouched.
--
-- departments        organisational units, created by the owner (names are an owner decision)
-- staff_assignments  who belongs to which department, and who heads it. Membership grants NO permission by itself:
--                    permissions still come only from the administrator group (admin_role). One head per department.
-- staff_invitations  single-use, time-limited invitations tied to one email address and one role/group. Only a hash of
--                    the token is stored. Accepting one creates the account with exactly the invited role.
-- approval_requests  a generic request/decision record. The action runs only after approval, executed by the server.
CREATE TABLE IF NOT EXISTS departments (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  purpose     TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS staff_assignments (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  department_slug  TEXT NOT NULL REFERENCES departments(slug),
  position         TEXT NOT NULL CHECK (position IN ('head', 'staff')),
  reason           TEXT,
  created_at       TEXT NOT NULL,
  created_by       TEXT,
  ended_at         TEXT,
  ended_by         TEXT,
  end_reason       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_assignments_one_head ON staff_assignments(department_slug) WHERE position = 'head' AND ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_assignments_one_active ON staff_assignments(user_id, department_slug) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS staff_assignments_user ON staff_assignments(user_id, ended_at);

CREATE TABLE IF NOT EXISTS staff_invitations (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL,
  full_name        TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('admin', 'instructor')),
  admin_role       TEXT,
  department_slug  TEXT REFERENCES departments(slug),
  position         TEXT CHECK (position IS NULL OR position IN ('head', 'staff')),
  token_hash       TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  expires_at       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  created_by       TEXT NOT NULL,
  decided_at       TEXT,
  decided_by       TEXT,
  revoke_reason    TEXT,
  accepted_user_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_invitations_one_pending ON staff_invitations(email) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS approval_requests (
  id                TEXT PRIMARY KEY,
  category          TEXT NOT NULL,
  target_type       TEXT NOT NULL,
  target_id         TEXT NOT NULL,
  payload           TEXT NOT NULL,
  reason            TEXT NOT NULL,
  requested_by      TEXT NOT NULL,
  approver          TEXT NOT NULL CHECK (approver IN ('owner', 'super')),
  status            TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  expires_at        TEXT NOT NULL,
  decided_by        TEXT,
  decided_at        TEXT,
  decision_comment  TEXT,
  executed_at       TEXT,
  execution_result  TEXT,
  escalated_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS approval_requests_status ON approval_requests(status, approver, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_one_pending ON approval_requests(category, target_id) WHERE status = 'pending';
