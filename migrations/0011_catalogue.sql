-- 0011: database-backed programme catalogue (Expansion Stage B, 27 Nov 2026). ADDITIVE ONLY.
-- * schools: the six schools of the 2027 catalogue.
-- * programmes (existing table) gains the catalogue fields. Its rows remain the LIVE, public catalogue: the nine
--   programmes on the website today, marked published, with the display text they already show. price_kobo stays the
--   Nigerian local tuition in kobo; price_usd_cents is the separate international tuition (US cents), empty for now.
--   One alignment: Cloud Engineering's was_kobo (crossed-out price, seeded by 0002) is cleared, because the live
--   website has never shown one. Prices and durations of live rows are NOT touched.
-- * programme_drafts: unpublished edits and new programmes. Seeded with the 21 programmes of the 2027 catalogue
--   (titles, schools, US dollar tuition, durations). Nigerian tuition is left empty on purpose: it is never derived
--   from the dollar price, and a programme cannot be published without it. Nothing here is visible to the public.
-- * enrolments gains a snapshot of the training and internship months, filled for every existing enrolment from the
--   programme's current durations, so a later duration change never alters a student's existing programme period.
-- Local and staging only until the owner approves it for production (Stage B brief).

CREATE TABLE IF NOT EXISTS schools (
  slug TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  tab_label TEXT NOT NULL,
  tone TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO schools (slug, code, name, tab_label, tone, position, created_at, updated_at) VALUES ('ai-systems', '01', 'School of AI & Intelligent Systems', 'AI', 'from-indigo via-plum to-brand-red', 1, datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO schools (slug, code, name, tab_label, tone, position, created_at, updated_at) VALUES ('software-engineering', '02', 'School of Software Engineering & Computing', 'Software', 'from-indigo via-navy to-brand-orange', 2, datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO schools (slug, code, name, tab_label, tone, position, created_at, updated_at) VALUES ('cloud-infrastructure', '03', 'School of Cloud, DevOps & Digital Infrastructure', 'Cloud & Security', 'from-navy via-indigo to-plum', 3, datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO schools (slug, code, name, tab_label, tone, position, created_at, updated_at) VALUES ('data-science', '04', 'School of Data Science & Analytics', 'Data', 'from-ink via-navy to-brand-red', 4, datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO schools (slug, code, name, tab_label, tone, position, created_at, updated_at) VALUES ('creative-technology', '05', 'School of Creative Technology & Digital Media', 'Creative & Product', 'from-plum via-brand-red to-brand-orange', 5, datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO schools (slug, code, name, tab_label, tone, position, created_at, updated_at) VALUES ('business-operations', '06', 'School of Business, Management & Remote Operations', 'Business', 'from-brand-orange via-brand-red to-plum', 6, datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;

ALTER TABLE programmes ADD COLUMN school_slug TEXT REFERENCES schools(slug);
ALTER TABLE programmes ADD COLUMN tag TEXT;
ALTER TABLE programmes ADD COLUMN tone TEXT;
ALTER TABLE programmes ADD COLUMN blurb TEXT;
ALTER TABLE programmes ADD COLUMN description TEXT;
ALTER TABLE programmes ADD COLUMN learn_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE programmes ADD COLUMN curriculum_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE programmes ADD COLUMN final_project TEXT;
ALTER TABLE programmes ADD COLUMN audience TEXT;
ALTER TABLE programmes ADD COLUMN track TEXT;
ALTER TABLE programmes ADD COLUMN full_payment_only INTEGER NOT NULL DEFAULT 0;
ALTER TABLE programmes ADD COLUMN price_usd_cents INTEGER CHECK (price_usd_cents IS NULL OR price_usd_cents > 0);
ALTER TABLE programmes ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'paused', 'retired'));
ALTER TABLE programmes ADD COLUMN published_at TEXT;
ALTER TABLE programmes ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE programmes ADD COLUMN created_at TEXT;
ALTER TABLE programmes ADD COLUMN updated_by TEXT;
ALTER TABLE programmes ADD COLUMN retired_at TEXT;
ALTER TABLE programmes ADD COLUMN retired_by TEXT;
ALTER TABLE programmes ADD COLUMN retired_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_programmes_status ON programmes(status, position);

-- Live rows: the display text the website shows today (lib/config.ts), so reading the catalogue from the database
-- changes nothing a visitor sees. Only the new columns are written, plus Cloud's stale crossed-out price.
UPDATE programmes SET tag = 'Design', tone = 'from-brand-red via-brand-orange to-[#ffb35c]', blurb = 'Brand identity, layout, print and social media design, taught to you one-on-one.', learn_json = '["Design fundamentals: layout, colour and typography","Photoshop for photo editing and social media designs","Illustrator for logos and vector artwork","InDesign for print and layout work","After Effects and XD basics","A client-ready portfolio of real brand projects"]', audience = NULL, track = NULL, full_payment_only = 0, position = 1, created_at = COALESCE(created_at, updated_at) WHERE slug = 'graphics';
UPDATE programmes SET tag = 'Design', tone = 'from-plum via-brand-red to-brand-orange', blurb = 'Research, wireframes, prototypes and product design for apps and websites, one-on-one with your mentor.', learn_json = '["User research and understanding user needs","Information architecture and user flows","Wireframing and prototyping in Figma","Visual design, design systems and accessibility","Usability testing and improving a design","A portfolio of real product design case studies"]', audience = NULL, track = NULL, full_payment_only = 0, position = 2, created_at = COALESCE(created_at, updated_at) WHERE slug = 'uiux';
UPDATE programmes SET tag = 'Engineering', tone = 'from-indigo via-navy to-brand-orange', blurb = 'Build and ship modern websites and web apps, from your first page to a live project.', learn_json = '["HTML and CSS for responsive pages","JavaScript fundamentals","Building interfaces with a modern framework","Working with APIs and data","Git, GitHub and deploying a live site","A portfolio of real web projects"]', audience = NULL, track = NULL, full_payment_only = 0, position = 3, created_at = COALESCE(created_at, updated_at) WHERE slug = 'webdev';
UPDATE programmes SET tag = 'Marketing', tone = 'from-brand-orange via-brand-red to-plum', blurb = 'Grow brands and businesses online with strategy, content and ads.', learn_json = '["Social media strategy and content","Audience and brand research","SEO and website basics","Email marketing","Paid ads","Analytics and reporting"]', audience = NULL, track = NULL, full_payment_only = 0, position = 4, created_at = COALESCE(created_at, updated_at) WHERE slug = 'marketing';
UPDATE programmes SET tag = 'Engineering', tone = 'from-ink via-navy to-brand-red', blurb = 'Learn to protect systems, networks and data from real-world threats.', learn_json = '["Networking and operating system security fundamentals","Threats, vulnerabilities and risk assessment","Securing web and cloud applications","Monitoring, detecting and responding to incidents","Ethical hacking and penetration testing basics","Security policies, compliance and best practice"]', audience = NULL, track = NULL, full_payment_only = 0, position = 5, created_at = COALESCE(created_at, updated_at) WHERE slug = 'cybersecurity';
UPDATE programmes SET tag = 'Cloud', tone = 'from-indigo via-navy to-brand-orange', blurb = 'Design, deploy and run applications on AWS and Azure, one-on-one with your mentor.', learn_json = '["Cloud fundamentals: compute, storage and networking","Identity, security and access management","Deploying and scaling applications","Infrastructure as code","Monitoring, backups and cost control","Hands-on projects on AWS and Azure"]', audience = 'Beginners, including people with little or no IT experience.', track = 'cloud', full_payment_only = 0, position = 6, created_at = COALESCE(created_at, updated_at) WHERE slug = 'cloud';
UPDATE programmes SET tag = 'Cloud', tone = 'from-navy via-indigo to-plum', blurb = 'Automate how software is built, tested and shipped on AWS and Azure, through hands-on projects with your mentor.', learn_json = '["Linux and the command line","Git and GitHub workflows","Building CI/CD pipelines that test and ship code","Containers with Docker","Deploying and managing apps with Kubernetes","Monitoring and troubleshooting live systems on AWS and Azure"]', audience = 'Learners who already have basic cloud knowledge.', track = 'cloud', full_payment_only = 0, position = 7, created_at = COALESCE(created_at, updated_at) WHERE slug = 'devops';
UPDATE programmes SET tag = 'Cloud', tone = 'from-navy via-plum to-brand-orange', blurb = 'The complete path: beginner-level cloud on AWS and Azure through to DevOps, in one programme.', learn_json = '["Cloud fundamentals on AWS and Azure","Identity, security and networking in the cloud","Linux, Git and infrastructure as code","CI/CD pipelines that test and ship code","Containers with Docker and Kubernetes","Monitoring, cost control and real-world projects"]', audience = 'Beginners who want the full path, from cloud basics through to DevOps.', track = 'cloud', full_payment_only = 0, position = 8, created_at = COALESCE(created_at, updated_at) WHERE slug = 'cloud-devops';
UPDATE programmes SET tag = 'AI', tone = 'from-indigo via-plum to-brand-red', blurb = 'Apply modern AI tools and no-code automation to real business workflows, from research and content to sales and operations.', learn_json = '["Understanding modern AI tools and their limits","AI-assisted business operations and research","No-code and low-code workflow automation","AI agents and assistants for everyday work","Lead generation, customer management and marketing automation","E-commerce and dropshipping operations with AI support","Integrating business applications","Testing, monitoring and improving automated workflows"]', audience = 'Professionals, business owners and operators who want to apply AI and automation to real work.', track = NULL, full_payment_only = 1, position = 9, created_at = COALESCE(created_at, updated_at) WHERE slug = 'ai-automation';
UPDATE programmes SET was_kobo = NULL WHERE slug = 'cloud' AND was_kobo = 70000000;

CREATE TABLE IF NOT EXISTS programme_drafts (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  school_slug TEXT NOT NULL REFERENCES schools(slug),
  blurb TEXT,
  description TEXT,
  learn_json TEXT NOT NULL DEFAULT '[]',
  curriculum_json TEXT NOT NULL DEFAULT '[]',
  final_project TEXT,
  training_months INTEGER NOT NULL CHECK (training_months BETWEEN 1 AND 24),
  internship_months INTEGER NOT NULL CHECK (internship_months BETWEEN 0 AND 12),
  price_usd_cents INTEGER CHECK (price_usd_cents IS NULL OR price_usd_cents > 0),
  price_kobo INTEGER CHECK (price_kobo IS NULL OR price_kobo > 0),
  level TEXT,
  audience TEXT,
  full_payment_only INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_programme_drafts_school ON programme_drafts(school_slug, position);

INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('ai-automation', 'AI Automation & Agentic Systems', 'ai-systems', 'Students learn how to design, build and deploy intelligent business workflows, AI-powered systems and automated operations.', 1, 1, 50000, NULL, 1, 1, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('ai-engineering', 'AI Engineering & LLM Application Development', 'ai-systems', NULL, 5, 2, 150000, NULL, 0, 2, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('ai-chatbot', 'AI Chatbot & Conversational AI Development', 'ai-systems', NULL, 3, 2, 95000, NULL, 0, 3, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('ai-data-annotation', 'AI Data Annotation & Model Evaluation', 'ai-systems', NULL, 2, 1, 45000, NULL, 0, 4, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('webdev', 'Web Development & Full-Stack Engineering', 'software-engineering', NULL, 5, 2, 135000, NULL, 0, 5, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('python', 'Python Programming & Applied Software Development', 'software-engineering', NULL, 4, 2, 105000, NULL, 0, 6, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('software-testing', 'Software Testing & Quality Assurance Engineering', 'software-engineering', NULL, 4, 2, 105000, NULL, 0, 7, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('cloud', 'Cloud Engineering', 'cloud-infrastructure', NULL, 5, 2, 150000, NULL, 0, 8, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('devops', 'DevOps Engineering', 'cloud-infrastructure', NULL, 5, 2, 150000, NULL, 0, 9, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('cybersecurity', 'Cybersecurity', 'cloud-infrastructure', NULL, 5, 2, 165000, NULL, 0, 10, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('data-analytics-bi', 'Data Analytics & Business Intelligence', 'data-science', NULL, 4, 2, 105000, NULL, 0, 11, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('data-science-ml', 'Data Science & Machine Learning', 'data-science', NULL, 6, 2, 185000, NULL, 0, 12, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('graphics', 'Graphic Design & Brand Identity', 'creative-technology', NULL, 3, 1, 65000, NULL, 0, 13, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('uiux', 'UI/UX Design', 'creative-technology', NULL, 4, 1, 85000, NULL, 0, 14, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('product-management', 'Product Management', 'creative-technology', NULL, 4, 1, 85000, NULL, 0, 15, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('ai-video', 'AI Video Production & Professional Video Editing', 'creative-technology', NULL, 3, 1, 70000, NULL, 0, 16, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('marketing', 'Digital Marketing & Growth Strategy', 'creative-technology', NULL, 4, 1, 85000, NULL, 0, 17, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('virtual-assistance', 'Virtual Assistance & Remote Business Operations', 'business-operations', NULL, 3, 1, 55000, NULL, 0, 18, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('project-management', 'Project Management', 'business-operations', NULL, 4, 1, 85000, NULL, 0, 19, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('business-analysis', 'Business Analysis', 'business-operations', NULL, 4, 1, 85000, NULL, 0, 20, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;
INSERT INTO programme_drafts (slug, name, school_slug, blurb, training_months, internship_months, price_usd_cents, price_kobo, full_payment_only, position, source, created_at, updated_at) VALUES ('technical-writing', 'Technical Writing & Documentation', 'business-operations', NULL, 3, 1, 65000, NULL, 0, 21, 'catalogue-2027', datetime('now'), datetime('now')) ON CONFLICT(slug) DO NOTHING;

ALTER TABLE enrolments ADD COLUMN training_months INTEGER;
ALTER TABLE enrolments ADD COLUMN internship_months INTEGER;
UPDATE enrolments SET training_months = (SELECT p.training_months FROM programmes p WHERE p.slug = enrolments.programme_slug),
  internship_months = (SELECT p.internship_months FROM programmes p WHERE p.slug = enrolments.programme_slug)
  WHERE training_months IS NULL;
