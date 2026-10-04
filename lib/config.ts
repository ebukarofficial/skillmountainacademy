export const SITE_URL = "https://ebukarofficial.github.io/skillmountainacademy";

export const CFG = {
  paystackKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "",
  sheetUrl: process.env.NEXT_PUBLIC_SHEET_URL ?? "", // Google Apps Script web app (payment check + emails)
  base: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  phone: "0706 100 0472",
  whatsapp: process.env.NEXT_PUBLIC_WHATSAPP || "2347061000472",
  // Shown on the site. Opens an email to the real Gmail below until the domain is bought.
  emailShown: "admission@skillmountainacademy.com",
  emailReal: "skillmountainacademy@gmail.com",
};

// Social pages. These appear ONLY as icons in the footer. Check each address is correct.
export const SOCIAL = [
  { name: "Facebook", url: "https://www.facebook.com/skillmountainacademy" },
  { name: "LinkedIn", url: "https://www.linkedin.com/company/skillmountainacademy" },
  { name: "Instagram", url: "https://www.instagram.com/skillmountainacademy" },
  { name: "TikTok", url: "https://www.tiktok.com/@skillmountainacademy" },
] as const;

// Google Form that receives every registration. See README "Google Form" steps.
// url = the form address with /viewform changed to /formResponse. entries = the entry.XXXX ids of each question.
export const GFORM = {
   url: "https://docs.google.com/forms/d/e/1FAIpQLSezGUioInLaOeKbwcvYzP3_kLAT4Yb-sa1PZyVBEwcnZHQjNg/formResponse",
  entries: {
    name: "entry.1113918736",
    email: "entry.1715586709",
    phone: "entry.1114667610",
    programme: "entry.1888645505",
    reference: "entry.741144483",
  },
};

export type Programme = {
  id: string;
  name: string;
  tag: string;
  blurb: string;
  live: boolean;
  fee?: number; // price in naira that the learner pays
  was?: number; // old price in naira, shown crossed out
  months?: number;
  tone: string;
  learn: string[];
};

// Open or add programmes here. Only live: true can be registered for.
// Fees are enforced on the server too: change them in docs/google-sheet-script.gs as well.
export const PROGRAMMES: Programme[] = [
  { id: "graphics", name: "Graphics Design", tag: "Design", live: true, fee: 350000, months: 6,
    tone: "from-brand-red via-brand-orange to-[#ffb35c]",
    blurb: "Brand identity, layout, print and social media design, taught to you one-on-one.",
    learn: ["Design fundamentals: layout, colour and typography", "Photoshop for photo editing and social media designs",
      "Illustrator for logos and vector artwork", "InDesign for print and layout work",
      "After Effects and XD basics", "A client-ready portfolio of real brand projects"] },
  { id: "devops", name: "DevOps Engineering", tag: "Engineering", live: true, fee: 450000, months: 6,
    tone: "from-navy via-indigo to-plum",
    blurb: "Cloud-native tools and practices, learned through hands-on projects with your mentor.",
    learn: ["Linux and the command line", "Git and GitHub workflows", "Building CI/CD pipelines that test and ship code",
      "Containers with Docker", "Deploying and managing apps with Kubernetes", "Cloud basics, monitoring and troubleshooting live systems"] },
  { id: "cloud", name: "Cloud Engineering", tag: "Engineering", live: true, fee: 450000, was: 700000,
    tone: "from-indigo via-navy to-brand-orange",
    blurb: "Design, deploy and run applications on the cloud, one-on-one with your mentor.",
    learn: ["Cloud fundamentals: compute, storage and networking", "Identity, security and access management",
      "Deploying and scaling applications", "Infrastructure as code", "Monitoring, backups and cost control", "Hands-on projects on a major cloud platform"] },
  { id: "marketing", name: "Digital Marketing", tag: "Marketing", live: true, fee: 300000,
    tone: "from-brand-orange via-brand-red to-plum",
    blurb: "Grow brands and businesses online with strategy, content and ads.",
    learn: ["Social media strategy and content", "Audience and brand research", "SEO and website basics",
      "Email marketing", "Paid ads", "Analytics and reporting"] },
  { id: "ielts", name: "IELTS Training", tag: "Language", live: true, fee: 200000,
    tone: "from-plum via-indigo to-navy",
    blurb: "Prepare for your IELTS exam with a mentor focused on your target score.",
    learn: ["Listening, Reading, Writing and Speaking skills", "Time management and band-score strategies",
      "Full practice tests with feedback", "Personal coaching on your weak areas"] },
  { id: "uiux", name: "UI/UX Design", tag: "Design", live: false, tone: "from-plum via-brand-red to-brand-orange",
    blurb: "Research, wireframes and product design.", learn: [] },
  { id: "web", name: "Web Development", tag: "Engineering", live: false, tone: "from-indigo via-navy to-brand-orange",
    blurb: "Build and ship modern websites and apps.", learn: [] },
];

export const AUDIENCE = [
  ["School leavers", "Start your skill journey early, before or alongside your studies."],
  ["Graduates", "Add a practical skill to your degree."],
  ["Working professionals", "Re-skill and stay ahead in your career."],
  ["Job seekers", "Learn something employers and clients pay for."],
  ["Entrepreneurs", "Build the skills your business needs, yourself."],
];

export type Testimonial = { name: string; handle: string; platform: string; date: string; quote: string; url: string };
// Real learner posts that mention SMA. Paste each one here (with the learner's permission) and it appears on the site.
// Example: { name: "Jane D.", handle: "@jane", platform: "Instagram", date: "12 Aug 2026", quote: "Their words", url: "https://link-to-the-post" }
export const TESTIMONIALS: Testimonial[] = [];
