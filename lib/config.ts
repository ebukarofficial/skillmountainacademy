export const SITE_URL = "https://skillmountainacademy.com";

export const CFG = {
  paystackKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "",
  sheetUrl: process.env.NEXT_PUBLIC_SHEET_URL ?? "", // Google Apps Script web app (payment check, emails, mailing list)
  // Cloudflare Turnstile SITE key for the "SMA forms" widget. It is public (every visitor's browser sees it), so it lives
  // in the code. The matching SECRET key is the Worker secret TURNSTILE_SECRET and must never be committed.
  turnstileSiteKey: "0x4AAAAAAGJzlJVnZfWkmdHa",
  whatsapp: process.env.NEXT_PUBLIC_WHATSAPP || "2347061000472", // used only for the Chat button and Partner button
  calendlyConsult: "", // paste your Calendly link for FREE CONSULTATION calls here, e.g. https://calendly.com/yourname/consultation
};

// Business details shown in the footer and on the legal pages.
export const BUSINESS = {
  name: "Skill Mountain Academy Limited",
  address: "Suite C8, Zara Plaza, Life Camp, Abuja, Nigeria",
  phone: "0706 100 0472",
  email: "admission@skillmountainacademy.com",
  rc: "", // add your CAC registration number (RC number) here. It is shown automatically once filled in.
};
// If any website photos require credit under their licence (for example free Freepik images), write the credit line here. It shows in the footer.
export const IMAGE_CREDIT = "";

// Bank transfer details shown on the checkout page.
export const BANK = { name: "Skill Mountain Academy Limited", number: "1025440484", bank: "UBA" };

// Public Google Drive links to each programme's curriculum (share as "Anyone with the link can view").
// They power the Download curriculum button. The same links go in the welcome email (see docs/google-sheet-script.gs).
export const CURRICULUM_LINKS: Record<string, string> = {
  graphics: "", marketing: "", uiux: "", webdev: "", cybersecurity: "", cloud: "", devops: "", "cloud-devops": "", "ai-automation": "",
};

// Options used by the application form.
export const EDUCATION = ["Primary", "Secondary", "Tertiary"];
export const MARITAL = ["Single", "Married", "Other"];
export const ENGLISH = ["Basic", "Good", "Very good", "Excellent"];

// Social pages. These appear ONLY as icons in the footer.
export const SOCIAL = [
  { name: "Facebook", url: "https://www.facebook.com/skillmountainacademy" },
  { name: "X", url: "https://x.com/skillmountain_" },
  { name: "LinkedIn", url: "https://www.linkedin.com/company/skill-mountain-academy/" },
  { name: "Instagram", url: "https://www.instagram.com/skillmountainacademy" },
  { name: "TikTok", url: "https://www.tiktok.com/@skillmountainacademy" },
] as const;

// Google Form that receives every registration.
export const GFORM = {
  url: "https://docs.google.com/forms/d/e/1FAIpQLSezGUioInLaOeKbwcvYzP3_kLAT4Yb-sa1PZyVBEwcnZHQjNg/formResponse",
  entries: {
    name: "entry.1113918736",
    email: "entry.1715586709",
    phone: "entry.1114667610",
    programme: "entry.1888645505",
    reference: "entry.741144483",
    terms: "", // optional: add a "Terms accepted" question to the form and paste its entry.… id here
  },
};

export type Programme = {
  slug: string;              // used in links: /checkout/?p=<slug> (and /programmes/<slug>/ from Phase 2)
  name: string;
  tag: string;               // category tab on the home page
  blurb: string;
  price: number;             // regular price in naira (NGN)
  was?: number;              // previous price in naira, shown crossed out (leave out for none)
  trainingMonths: number;
  internshipMonths: number;
  level: string;
  audience?: string;         // who it is for (used in the Cloud track comparison)
  track?: "cloud";           // Cloud track programmes teach both AWS and Azure
  timedPrice: number | null; // price during a timed hold (Phase 5). null = no timed offer
  fastTrack: boolean;        // 3-month fast track. Switched OFF for every programme (see FAST_TRACK)
  curriculum: string;        // curriculum PDF path (added in Phase 2)
  groupPrice: number | null; // price for a group class (Phase 6). null = group option hidden
  fullPaymentOnly?: boolean;  // true = no 3-part instalment plan (AI Automation)
  tone: string;
  learn: string[];
};

// Every programme is online, one-on-one, teacher-to-student, with a Skill Mountain Academy certificate,
// and can be paid in 3 parts unless it is marked fullPaymentOnly. All programmes listed here are open for registration.
// Prices are checked on the server too: change them in docs/google-sheet-script.gs (FEES) as well.
const base = (slug: string) => ({ timedPrice: null, fastTrack: false, curriculum: `/curricula/${slug}.pdf`, groupPrice: null });

export const PROGRAMMES: Programme[] = [
  { slug: "graphics", name: "Graphics Design", tag: "Design", price: 350000, trainingMonths: 4, internshipMonths: 2,
    level: "Beginner to advanced", ...base("graphics"),
    tone: "from-brand-red via-brand-orange to-[#ffb35c]",
    blurb: "Brand identity, layout, print and social media design, taught to you one-on-one.",
    learn: ["Design fundamentals: layout, colour and typography", "Photoshop for photo editing and social media designs",
      "Illustrator for logos and vector artwork", "InDesign for print and layout work",
      "After Effects and XD basics", "A client-ready portfolio of real brand projects"] },
  { slug: "uiux", name: "UI/UX Design (Product Design)", tag: "Design", price: 400000, trainingMonths: 4, internshipMonths: 2,
    level: "Beginner to advanced", ...base("uiux"),
    tone: "from-plum via-brand-red to-brand-orange",
    blurb: "Research, wireframes, prototypes and product design for apps and websites, one-on-one with your mentor.",
    learn: ["User research and understanding user needs", "Information architecture and user flows",
      "Wireframing and prototyping in Figma", "Visual design, design systems and accessibility",
      "Usability testing and improving a design", "A portfolio of real product design case studies"] },
  { slug: "webdev", name: "Web Development", tag: "Engineering", price: 500000, trainingMonths: 4, internshipMonths: 2, // price: placeholder, owner to confirm
    level: "Beginner to advanced", ...base("webdev"),
    tone: "from-indigo via-navy to-brand-orange",
    blurb: "Build and ship modern websites and web apps, from your first page to a live project.",
    learn: ["HTML and CSS for responsive pages", "JavaScript fundamentals", "Building interfaces with a modern framework",
      "Working with APIs and data", "Git, GitHub and deploying a live site", "A portfolio of real web projects"] },
  { slug: "marketing", name: "Digital Marketing", tag: "Marketing", price: 300000, trainingMonths: 3, internshipMonths: 3,
    level: "Beginner to advanced", ...base("marketing"),
    tone: "from-brand-orange via-brand-red to-plum",
    blurb: "Grow brands and businesses online with strategy, content and ads.",
    learn: ["Social media strategy and content", "Audience and brand research", "SEO and website basics",
      "Email marketing", "Paid ads", "Analytics and reporting"] },
  { slug: "cybersecurity", name: "Cybersecurity", tag: "Engineering", price: 650000, trainingMonths: 4, internshipMonths: 2,
    level: "Beginner to advanced", ...base("cybersecurity"),
    tone: "from-ink via-navy to-brand-red",
    blurb: "Learn to protect systems, networks and data from real-world threats.",
    learn: ["Networking and operating system security fundamentals", "Threats, vulnerabilities and risk assessment",
      "Securing web and cloud applications", "Monitoring, detecting and responding to incidents",
      "Ethical hacking and penetration testing basics", "Security policies, compliance and best practice"] },
  // Cloud track: all three teach BOTH AWS and Azure.
  { slug: "cloud", name: "Cloud Engineering", tag: "Cloud", track: "cloud", price: 450000, trainingMonths: 4, internshipMonths: 2,
    level: "Beginner-friendly", audience: "Beginners, including people with little or no IT experience.", ...base("cloud"),
    tone: "from-indigo via-navy to-brand-orange",
    blurb: "Design, deploy and run applications on AWS and Azure, one-on-one with your mentor.",
    learn: ["Cloud fundamentals: compute, storage and networking", "Identity, security and access management",
      "Deploying and scaling applications", "Infrastructure as code", "Monitoring, backups and cost control", "Hands-on projects on AWS and Azure"] },
  { slug: "devops", name: "DevOps Engineering", tag: "Cloud", track: "cloud", price: 500000, trainingMonths: 4, internshipMonths: 2,
    level: "Mid-level", audience: "Learners who already have basic cloud knowledge.", ...base("devops"),
    tone: "from-navy via-indigo to-plum",
    blurb: "Automate how software is built, tested and shipped on AWS and Azure, through hands-on projects with your mentor.",
    learn: ["Linux and the command line", "Git and GitHub workflows", "Building CI/CD pipelines that test and ship code",
      "Containers with Docker", "Deploying and managing apps with Kubernetes", "Monitoring and troubleshooting live systems on AWS and Azure"] },
  { slug: "cloud-devops", name: "Cloud & DevOps Engineering", tag: "Cloud", track: "cloud", price: 650000, trainingMonths: 5, internshipMonths: 2,
    level: "Beginner to DevOps", audience: "Beginners who want the full path, from cloud basics through to DevOps.", ...base("cloud-devops"),
    tone: "from-navy via-plum to-brand-orange",
    blurb: "The complete path: beginner-level cloud on AWS and Azure through to DevOps, in one programme.",
    learn: ["Cloud fundamentals on AWS and Azure", "Identity, security and networking in the cloud", "Linux, Git and infrastructure as code",
      "CI/CD pipelines that test and ship code", "Containers with Docker and Kubernetes", "Monitoring, cost control and real-world projects"] },
  // Added 21 Nov 2026 (owner brief): ₦300,000, one month of training and one month of internship, full payment only.
  { slug: "ai-automation", name: "AI Automation", tag: "AI", price: 300000, trainingMonths: 1, internshipMonths: 1, fullPaymentOnly: true,
    level: "Beginner to intermediate", audience: "Professionals, business owners and operators who want to apply AI and automation to real work.", ...base("ai-automation"),
    tone: "from-indigo via-plum to-brand-red",
    blurb: "Apply modern AI tools and no-code automation to real business workflows, from research and content to sales and operations.",
    learn: ["Understanding modern AI tools and their limits", "AI-assisted business operations and research", "No-code and low-code workflow automation",
      "AI agents and assistants for everyday work", "Lead generation, customer management and marketing automation", "E-commerce and dropshipping operations with AI support",
      "Integrating business applications", "Testing, monitoring and improving automated workflows"] },
];

// Old links used different names. /checkout/?p=cyber still opens Cybersecurity, and so on.
export const LEGACY_SLUGS: Record<string, string> = { cyber: "cybersecurity", web: "webdev" };
// Programmes that are no longer offered. Old links to them go to the home page with a short notice.
export const REMOVED_SLUGS = ["ielts", "data", "data-analytics"];

// "nine" etc. for prose, so copy never falls out of step with the catalogue.
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
export const PROGRAMME_COUNT = WORDS[PROGRAMMES.length] ?? String(PROGRAMMES.length);

export function findProgramme(slug: string | null | undefined): Programme | undefined {
  if (!slug) return undefined;
  const s = LEGACY_SLUGS[slug] ?? slug;
  return PROGRAMMES.find((p) => p.slug === s);
}

// "4 months training + 2 months internship"
const months = (n: number) => `${n} month${n === 1 ? "" : "s"}`;
export const duration = (p: Programme) => `${months(p.trainingMonths)} training + ${months(p.internshipMonths)} internship`;

// The price the learner pays. A timed price applies only while a hold is active (Phase 5).
export const finalPrice = (p: Programme, holdActive = false) => (holdActive && p.timedPrice != null ? p.timedPrice : p.price);

// Feature switches. Both stay OFF until the owner supplies prices (groups) or ages, programmes and pricing (children).
// The Worker reads the same values, so turning one on here turns it on everywhere after the next deploy.
export const FLAGS = { GROUP_ENABLED: false, CHILDREN_ENABLED: false };

// The brand message. Repeated in the hero, the band under it, the page title, every programme page and the registration page.
export const MESSAGE = {
  headline: "For those made for more.",
  short: "Human mentorship. Intelligent learning. Practical mastery.",
  pillars: [
    { title: "One teacher. One student.", text: "Your mentor teaches only you, live and online." },
    { title: "Flexible", text: "Pick your day and time (weekday or Saturday), pay in 3 parts, learn online from anywhere." },
  ],
  group: { title: "Learn with 1 or 2 friends.", text: "Share one live class with up to two friends." },
};
export const pillars = () => (FLAGS.GROUP_ENABLED ? [...MESSAGE.pillars, MESSAGE.group] : MESSAGE.pillars);

// Career Launch Package, shown on every programme page. It helps learners prepare; it never promises a job or income.
export const TECH_SLUGS = ["cloud", "devops", "cloud-devops", "webdev", "cybersecurity"];
export function careerPackage(p: Programme): string[] {
  return [
    "LinkedIn profile setup and positioning",
    "Professional CV/resume development",
    TECH_SLUGS.includes(p.slug) ? "GitHub profile setup and project documentation" : "Portfolio setup and project documentation",
    "Job-search strategies and application techniques",
    "Interview preparation and feedback on practical projects",
    `A ${p.internshipMonths}-month internship`,
  ];
}

// 3-month fast track at 35% off. Kept as an option but switched OFF for every programme.
export const FAST_TRACK = { enabled: false, months: 3, discount: 0.35 };

// Pay in 3 parts. Due dates are days after registration (3-month training uses the shorter schedule).
export const PAY_PLAN = { split: [50, 30, 20], dueDays: [0, 45, 90], dueDaysShort: [0, 30, 60] };

// Children's package. Self-serve checkout stays off (FLAGS.CHILDREN_ENABLED) until the owner sets the ages, programmes and prices here.
export const CHILDREN = {
  minAge: 4, maxAge: 17,                 // ages accepted on the enquiry form
  programmes: [] as { slug: string; ages: string; price: number }[], // e.g. { slug: "graphics", ages: "10-17", price: 250000 }
};

export const AUDIENCE: [string, string, string?][] = [
  ["School leavers", "Start your skill journey early, before or alongside your studies."],
  ["Graduates", "Add a practical skill to your degree."],
  ["Working professionals", "Re-skill and stay ahead in your career."],
  ["Job seekers", "Learn something employers and clients pay for."],
  ["Entrepreneurs", "Build the skills your business needs, yourself."],
  ["Parents and children", "Customised one-on-one learning for children, through a parent account and with your consent.", "/children/"],
];

// "Tell us your goal" picker in the Your Path section.
// Every option points to a programme in PROGRAMMES.
export const GOALS: { goal: string; slug: string; why: string }[] = [
  { goal: "Start a career in tech", slug: "cloud", why: "Cloud engineers design and run the systems that modern companies depend on. This programme is beginner-friendly and teaches both AWS and Azure." },
  { goal: "Automate and ship software", slug: "devops", why: "DevOps engineers connect development and operations so software is built, tested and released faster. Best if you already know some cloud basics." },
  { goal: "Go from beginner to DevOps", slug: "cloud-devops", why: "One programme that takes you from beginner-level cloud on AWS and Azure all the way through to DevOps." },
  { goal: "Protect systems and data", slug: "cybersecurity", why: "Cybersecurity professionals defend organisations against attacks. Every industry needs them." },
  { goal: "Build websites and web apps", slug: "webdev", why: "Web developers build the sites and apps people use every day, for employers, clients or their own ideas." },
  { goal: "Design apps people love", slug: "uiux", why: "UI/UX designers research what users need and design products that are easy and pleasant to use." },
  { goal: "Create and design", slug: "graphics", why: "Graphics designers shape how brands look. You can work for a company, freelance, or build your own studio." },
  { goal: "Automate work with AI", slug: "ai-automation", why: "AI automation applies modern AI tools and no-code workflows to the routine work of a business: research, content, sales, customers and operations." },
  { goal: "Grow a brand or business online", slug: "marketing", why: "Digital marketing skills help any business find customers online, including your own." },
];

// "Your path" step-by-step guide.
export const STEPS: { title: string; text: string; cta?: [string, string] }[] = [
  { title: "Explore and read the curriculum", text: "Use the search box or the category tabs in the Programmes section. On any programme, tap View curriculum to see exactly what you will learn, and download it before you decide.", cta: ["Browse programmes", "#programmes"] },
  { title: "Choose the programme that fits your goal", text: "Not sure where to start? Pick your goal in the box above and we will point you to the best match. You can also book a free call with us first.", cta: ["Pick my goal", "#goal"] },
  { title: "Check your price and your discount", text: "The price on each card is the price you pay. Where you see a crossed-out figure, that is the previous price. Prices show in naira (₦)." },
  { title: "Fill in your application", text: "Click Register. A short application asks for your details, a few questions about your goals, and your parent or guardian details if the learner is under 18. Learners under 18 need a parent or guardian." },
  { title: "Accept the terms and pay", text: "Read and accept the Terms and Conditions, then choose how to pay: Paystack (card or bank transfer) or a manual transfer to our UBA account. If you transfer manually, send us your teller so we can confirm it." },
  { title: "Receive your welcome email", text: "As soon as your payment is confirmed, we email you a welcome message from Skill Mountain Academy with your curriculum link and a link to book your classes." },
  { title: "Pick your class days and times", text: "Use the booking link to choose the days and time that suit you. For example, three days a week for 45 minutes at 9 am. You receive a link to your virtual class for each session." },
  { title: "Start learning one-on-one", text: "Your mentor meets you online, at your pace, and guides you through projects until you are ready for the next step in your career." },
];

// "Before you apply": sixteen questions in four groups of four (owner brief, 21 Nov 2026). The flat FAQ list below
// is derived from it, for the structured data and anywhere a single list is needed.
export const FAQ_GROUPS: { title: string; items: [string, string][] }[] = [
  { title: "Studying with the Academy", items: [
    ["How is teaching organised?", "Each student is taught by one assigned instructor in a live one-on-one session every week. Questions are answered as they arise, and the pace follows the student's progress rather than a class timetable."],
    ["Do I need prior experience?", "Most programmes begin at beginner level. DevOps Engineering expects basic cloud knowledge. Each programme page states its level and who it suits."],
    ["Can I study alongside work or family?", "Yes. Your weekly session is set at a time agreed at enrolment, and independent study (10 to 20 hours a week) can be spread across the week."],
    ["What does a typical week involve?", "One 45 to 60 minute live session with your instructor, and independent study: assignments, practical tasks, quizzes, revision and preparation for the next session. Your dashboard lists the week's activities."],
  ] },
  { title: "Programmes", items: [
    ["How do I choose a programme?", "Read each programme page for its discipline, curriculum, level and duration. If you are unsure, book a call with Admissions and we will talk it through with you."],
    ["Will I produce practical work?", "Yes. Each programme is built around practical projects using the tools of the discipline, which form a portfolio of your work."],
    ["Do the Cloud programmes teach AWS or Azure?", "Both. Cloud Engineering, DevOps Engineering and Cloud & DevOps Engineering teach Amazon Web Services and Microsoft Azure, with practical work on each."],
    ["What is the internship?", "After training, each programme includes an internship period (one to three months, depending on the programme) of supervised practical projects. It is part of your studies; it is not paid employment and not a promise of employment."],
  ] },
  { title: "Fees and payment", items: [
    ["Can I pay in instalments?", "Most programmes can be paid in full or in 3 parts (50%, 30% and 20%) on the dates shown at checkout. AI Automation is paid in full. Live-session access is paused if a payment is more than two weeks late."],
    ["In which currency will I see the fee?", "Your country of residence sets the currency shown: pounds in the United Kingdom, euros in eurozone countries, naira where the naira is the national currency, and US dollars elsewhere. Payment is processed in naira, and the exact amount charged is shown before you pay."],
    ["How do I pay?", "On the programme page, complete the admission form and pay online with Paystack, or by bank transfer to the Academy's account."],
    ["I paid by bank transfer. What happens next?", "Send your proof of payment to Admissions, quoting your reference. Once the payment is confirmed in our account, your admission is processed."],
  ] },
  { title: "Admission and records", items: [
    ["Are admissions open all year?", "Admissions run in periods, and places on each programme depend on the instructors available to teach it. Each programme page shows its current admission status."],
    ["What happens after I pay?", "Your payment is verified, you receive your registration number and admission confirmation, and then a separate email to enter your learning space. Your instructor and weekly session time follow."],
    ["Will I receive a certificate?", "Students who complete their programme's requirements receive a Skill Mountain Academy certificate. It is the Academy's own certificate, not a university degree or a government or professional qualification."],
    ["Do you teach children?", "Yes, through the children's package, which runs through a parent or guardian's account and with their consent. Send an enquiry from the children's package page."],
  ] },
];
export const FAQ: [string, string][] = FAQ_GROUPS.flatMap((g) => g.items);

// Shown in the FAQ only when group classes are switched on (FLAGS.GROUP_ENABLED).
export const FAQ_GROUP: [string, string] = ["Can I learn with friends?", "Yes. You can learn with 1 or 2 friends in one shared live class, for one group price. The person registering adds the others by name and email, and each learner keeps their own record, grades and attendance."];
export const faqList = (): [string, string][] => (FLAGS.GROUP_ENABLED ? [...FAQ, FAQ_GROUP] : FAQ);

// Screenshots of real posts about SMA. Upload each image to the public/reviews folder in GitHub,
// then add a line here, for example: { file: "review-1.png", platform: "Instagram", alt: "Post by a learner" }
export const REVIEW_SHOTS: { file: string; platform: string; alt: string }[] = [];
