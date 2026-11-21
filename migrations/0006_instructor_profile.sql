-- Instructor onboarding profile: what a new instructor fills in before the Academy verifies them.
-- Safe on a live database: it only adds columns. Existing approved instructors are marked verified.
ALTER TABLE users ADD COLUMN headline TEXT;              -- one-line professional citation shown under the name
ALTER TABLE users ADD COLUMN achievements TEXT;          -- JSON list of strings
ALTER TABLE users ADD COLUMN certifications TEXT;        -- JSON list of {title, issuer, year, url} (url = public verification page)
ALTER TABLE users ADD COLUMN languages TEXT;             -- JSON list of strings
ALTER TABLE users ADD COLUMN country_origin TEXT;
ALTER TABLE users ADD COLUMN country_residence TEXT;
ALTER TABLE users ADD COLUMN profile_submitted_at TEXT;  -- when the instructor last submitted the profile for verification
ALTER TABLE users ADD COLUMN verified_at TEXT;           -- when the Academy approved them

UPDATE users SET verified_at = created_at WHERE role = 'instructor' AND verification = 'approved';
