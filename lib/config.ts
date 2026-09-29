export const SITE_URL = "https://ebukarofficial.github.io/sma-platform";

export const CFG = {
  paystackKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "",
  sheetUrl: process.env.NEXT_PUBLIC_SHEET_URL ?? "",
  whatsapp: process.env.NEXT_PUBLIC_WHATSAPP ?? "", // e.g. 2348012345678
};

export type Programme = {
  id: string;
  name: string;
  tag: string;
  blurb: string;
  live: boolean;
  fee?: number; // naira
  months?: number;
  tone: string; // tailwind gradient classes for the card tile
};

// Add or open programmes here. Only live: true can be registered for.
// If you change a fee, change it in supabase/functions/paystack-webhook/index.ts too.
export const PROGRAMMES: Programme[] = [
  { id: "graphics", name: "Graphics Design", tag: "Design", live: true, fee: 350000, months: 6,
    tone: "from-indigo via-plum to-brand-orange",
    blurb: "Brand identity, layout, print and social media design, taught to you one-on-one." },
  { id: "devops", name: "DevOps Engineer", tag: "Engineering", live: true, fee: 450000, months: 6,
    tone: "from-navy via-indigo to-brand-red",
    blurb: "Linux, CI/CD, containers and cloud, learned through hands-on projects." },
  { id: "uiux", name: "UI/UX Design", tag: "Design", live: false, tone: "", blurb: "Research, wireframes and product design." },
  { id: "web", name: "Web Development", tag: "Engineering", live: false, tone: "", blurb: "Build and ship modern websites." },
  { id: "video", name: "Video Editing", tag: "Creative", live: false, tone: "", blurb: "Edit content people finish watching." },
];
