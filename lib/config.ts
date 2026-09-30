export const SITE_URL = "https://ebukarofficial.github.io/skillmountainacademy";

export const CFG = {
  paystackKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "",
  sheetUrl: process.env.NEXT_PUBLIC_SHEET_URL ?? "", // Apps Script web app (payment check + community signups)
  base: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  email: "skillmountainacademy@gmail.com",
  handle: "skillmountainacademy",
  phone: "0706 100 0472", // from the SMA admissions flyer. Change if out of date.
  whatsapp: process.env.NEXT_PUBLIC_WHATSAPP || "2347061000472",
};

// Paste the block printed by createRegistrationForm() in docs/google-sheet-script.gs here.
// While "action" is empty, registrations are not sent to the Google Form.
export const FORM = {
  action: "", // e.g. https://docs.google.com/forms/d/e/XXXX/formResponse
  entries: { name: "", email: "", phone: "", programme: "", amount: "", reference: "" }, // e.g. "entry.123456789"
};

export const SOCIALS = [
  { label: "Instagram", short: "IG", href: `https://www.instagram.com/${CFG.handle}` },
  { label: "LinkedIn", short: "in", href: `https://www.linkedin.com/company/${CFG.handle}` },
  { label: "Facebook", short: "f", href: `https://www.facebook.com/${CFG.handle}` },
  { label: "TikTok", short: "TT", href: `https://www.tiktok.com/@${CFG.handle}` },
];

export type Programme = {
  id: string;
  name: string;
  tag: string;
  blurb: string;
  live: boolean;
  fee?: number; // what the student pays, in naira
  was?: number; // crossed-out original price. Set to 0 to hide the slash.
  months?: number;
  tone: string;
  learn: string[];
};

// Open or add programmes here. Only live: true can be registered for.
// Fees are enforced on the server too: change them in docs/google-sheet-script.gs as well.
// NOTE: "was" prices for everything except Cloud Engineer are PLACEHOLDERS. Replace with your real original prices.
export const PROGRAMMES: Programme[] = [
  { id: "graphics", name: "Graphics Design", tag: "Design", live: true, fee: 350000, was: 550000, months: 6,
    tone: "from-brand-red via-brand-orange to-[#ffb35c]",
    blurb: "Brand identity, layout, print and social media design, taught to you one-on-one.",
    learn: ["Design fundamentals: layout, colour and typography", "Photoshop for photo editing and social media designs",
      "Illustrator for logos and vector artwork", "InDesign for print and layout work",
      "After Effects and XD basics", "A client-ready portfolio of real brand projects"] },
  { id: "devops", name: "DevOps Engineer", tag: "Engineering", live: true, fee: 450000, was: 650000, months: 6,
    tone: "from-navy via-indigo to-plum",
    blurb: "Cloud-native tools and practices, learned through hands-on projects with your mentor.",
    learn: ["Linux and the command line", "Git and GitHub workflows", "Building CI/CD pipelines that test and ship code",
      "Containers with Docker", "Deploying and managing apps with Kubernetes", "Cloud basics, monitoring and troubleshooting live systems"] },
  { id: "cloud", name: "Cloud Engineer", tag: "Engineering", live: true, fee: 450000, was: 700000,
    tone: "from-indigo via-navy to-brand-orange",
    blurb: "Design, build and run applications on the cloud, guided step by step.",
    learn: ["Cloud fundamentals: compute, storage and networking", "Identity, access and security basics",
      "Hosting and scaling real applications", "Infrastructure as code", "Serverless and managed services", "Monitoring, backups and cost control"] },
  { id: "marketing", name: "Digital Marketing", tag: "Business", live: true, fee: 300000, was: 450000,
    tone: "from-brand-orange via-brand-red to-plum",
    blurb: "Get customers online with content, ads and analytics that you can measure.",
    learn: ["Social media strategy and content", "Search engine optimisation (SEO)", "Paid ads on major platforms",
      "Email and WhatsApp marketing", "Analytics and reporting", "Running a campaign from idea to results"] },
  { id: "ielts", name: "IELTS Training", tag: "Language", live: true, fee: 200000, was: 300000,
    tone: "from-plum via-indigo to-navy",
    blurb: "Prepare for the IELTS exam with focused one-on-one coaching.",
    learn: ["The four IELTS skills: listening, reading, writing and speaking", "Exam format and time management",
      "Practice tests with detailed feedback", "Writing task coaching", "Speaking practice with a mentor"] },
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

// Add REAL student feedback here. While this list is empty the testimonials section stays hidden.
// Example: { name: "Full Name", role: "Graphics Design student", text: "What they said.", date: "Sept 2026" }
export type Testimonial = { name: string; role: string; text: string; date?: string };
export const TESTIMONIALS: Testimonial[] = [];
