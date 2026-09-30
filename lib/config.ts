export const SITE_URL = "https://ebukarofficial.github.io/skillmountainacademy";

export const CFG = {
  paystackKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "",
  sheetUrl: process.env.NEXT_PUBLIC_SHEET_URL ?? "",
  base: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  // Phone/WhatsApp number from the SMA admissions flyer. Change if it is out of date.
  phone: "0706 100 0472",
  whatsapp: process.env.NEXT_PUBLIC_WHATSAPP || "2347061000472",
};

export type Programme = {
  id: string;
  name: string;
  tag: string;
  blurb: string;
  live: boolean;
  fee?: number; // naira
  months?: number;
  tone: string; // gradient for the hero card
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
  { id: "devops", name: "DevOps Engineer", tag: "Engineering", live: true, fee: 450000, months: 6,
    tone: "from-navy via-indigo to-plum",
    blurb: "Cloud-native tools and practices, learned through hands-on projects with your mentor.",
    learn: ["Linux and the command line", "Git and GitHub workflows", "Building CI/CD pipelines that test and ship code",
      "Containers with Docker", "Deploying and managing apps with Kubernetes", "Cloud basics, monitoring and troubleshooting live systems"] },
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
