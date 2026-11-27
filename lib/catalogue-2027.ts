// The 2027 programme catalogue as approved by the owner on 27 Nov 2026: 21 programmes in six schools, with the
// international tuition benchmark in US dollars and the training + internship durations.
//
// This file is REFERENCE DATA ONLY. It seeded migration 0011 (programme drafts, all unpublished) and is used by the
// catalogue integrity tests. It is not read by the website or the Worker, and editing it changes nothing live: the
// catalogue is managed in the database through Admin > Programmes > Catalogue.
//
// Nigerian local tuition (NGN) is deliberately absent. It is a separate price set by the owner, never a conversion of
// the dollar figure, and a programme cannot be published until it has one.

export type School2027 = { slug: string; code: string; name: string; tab: string; tone: string };
export type Programme2027 = {
  n: number; slug: string; school: string; name: string; usd: number; training: number; internship: number;
  // The current live programme this 2027 programme replaces in place (same slug), if any.
  reuses?: string;
};

// Tones are existing gradient strings from lib/config.ts, so their Tailwind classes are already in the build.
export const SCHOOLS_2027: School2027[] = [
  { slug: "ai-systems", code: "01", name: "School of AI & Intelligent Systems", tab: "AI", tone: "from-indigo via-plum to-brand-red" },
  { slug: "software-engineering", code: "02", name: "School of Software Engineering & Computing", tab: "Software", tone: "from-indigo via-navy to-brand-orange" },
  { slug: "cloud-infrastructure", code: "03", name: "School of Cloud, DevOps & Digital Infrastructure", tab: "Cloud & Security", tone: "from-navy via-indigo to-plum" },
  { slug: "data-science", code: "04", name: "School of Data Science & Analytics", tab: "Data", tone: "from-ink via-navy to-brand-red" },
  { slug: "creative-technology", code: "05", name: "School of Creative Technology & Digital Media", tab: "Creative & Product", tone: "from-plum via-brand-red to-brand-orange" },
  { slug: "business-operations", code: "06", name: "School of Business, Management & Remote Operations", tab: "Business", tone: "from-brand-orange via-brand-red to-plum" },
];

export const PROGRAMMES_2027: Programme2027[] = [
  { n: 1, slug: "ai-automation", reuses: "ai-automation", school: "ai-systems", name: "AI Automation & Agentic Systems", usd: 500, training: 1, internship: 1 },
  { n: 2, slug: "ai-engineering", school: "ai-systems", name: "AI Engineering & LLM Application Development", usd: 1500, training: 5, internship: 2 },
  { n: 3, slug: "ai-chatbot", school: "ai-systems", name: "AI Chatbot & Conversational AI Development", usd: 950, training: 3, internship: 2 },
  { n: 4, slug: "ai-data-annotation", school: "ai-systems", name: "AI Data Annotation & Model Evaluation", usd: 450, training: 2, internship: 1 },
  { n: 5, slug: "webdev", reuses: "webdev", school: "software-engineering", name: "Web Development & Full-Stack Engineering", usd: 1350, training: 5, internship: 2 },
  { n: 6, slug: "python", school: "software-engineering", name: "Python Programming & Applied Software Development", usd: 1050, training: 4, internship: 2 },
  { n: 7, slug: "software-testing", school: "software-engineering", name: "Software Testing & Quality Assurance Engineering", usd: 1050, training: 4, internship: 2 },
  { n: 8, slug: "cloud", reuses: "cloud", school: "cloud-infrastructure", name: "Cloud Engineering", usd: 1500, training: 5, internship: 2 },
  { n: 9, slug: "devops", reuses: "devops", school: "cloud-infrastructure", name: "DevOps Engineering", usd: 1500, training: 5, internship: 2 },
  { n: 10, slug: "cybersecurity", reuses: "cybersecurity", school: "cloud-infrastructure", name: "Cybersecurity", usd: 1650, training: 5, internship: 2 },
  { n: 11, slug: "data-analytics-bi", school: "data-science", name: "Data Analytics & Business Intelligence", usd: 1050, training: 4, internship: 2 },
  { n: 12, slug: "data-science-ml", school: "data-science", name: "Data Science & Machine Learning", usd: 1850, training: 6, internship: 2 },
  { n: 13, slug: "graphics", reuses: "graphics", school: "creative-technology", name: "Graphic Design & Brand Identity", usd: 650, training: 3, internship: 1 },
  { n: 14, slug: "uiux", reuses: "uiux", school: "creative-technology", name: "UI/UX Design", usd: 850, training: 4, internship: 1 },
  { n: 15, slug: "product-management", school: "creative-technology", name: "Product Management", usd: 850, training: 4, internship: 1 },
  { n: 16, slug: "ai-video", school: "creative-technology", name: "AI Video Production & Professional Video Editing", usd: 700, training: 3, internship: 1 },
  { n: 17, slug: "marketing", reuses: "marketing", school: "creative-technology", name: "Digital Marketing & Growth Strategy", usd: 850, training: 4, internship: 1 },
  { n: 18, slug: "virtual-assistance", school: "business-operations", name: "Virtual Assistance & Remote Business Operations", usd: 550, training: 3, internship: 1 },
  { n: 19, slug: "project-management", school: "business-operations", name: "Project Management", usd: 850, training: 4, internship: 1 },
  { n: 20, slug: "business-analysis", school: "business-operations", name: "Business Analysis", usd: 850, training: 4, internship: 1 },
  { n: 21, slug: "technical-writing", school: "business-operations", name: "Technical Writing & Documentation", usd: 650, training: 3, internship: 1 },
];

// Slugs that must never be reused for a different programme: retired links still resolve to their old meaning.
// "data" and "data-analytics" were removed programmes (REMOVED_SLUGS); the 2027 data programmes use new slugs.
export const RESERVED_SLUGS = ["data", "data-analytics", "ielts", "cyber", "web", "cloud-devops"];

// Owner-supplied introduction (programme 1 only, 27 Nov 2026 catalogue text). Other programmes' descriptions,
// learning outcomes, curriculum and final project are entered through the admin catalogue editor.
export const INTRO_2027: Record<string, string> = {
  "ai-automation": "Students learn how to design, build and deploy intelligent business workflows, AI-powered systems and automated operations.",
};
