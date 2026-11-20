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
  graphics: "", marketing: "", uiux: "", webdev: "", cybersecurity: "", cloud: "", devops: "", "cloud-devops": "",
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
  tone: string;
  learn: string[];
};

// Every programme is online, one-on-one, teacher-to-student, with a Skill Mountain Academy certificate,
// and can be paid in 3 parts. All programmes listed here are open for registration.
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
];

// Old links used different names. /checkout/?p=cyber still opens Cybersecurity, and so on.
export const LEGACY_SLUGS: Record<string, string> = { cyber: "cybersecurity", web: "webdev" };
// Programmes that are no longer offered. Old links to them go to the home page with a short notice.
export const REMOVED_SLUGS = ["ielts", "data", "data-analytics"];

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

export const FAQ: [string, string][] = [
  ["Why is one-on-one learning better than a class?", "In a group, the pace is set by the room. Here, a mentor teaches only you. Your questions are answered straight away, nothing is skipped, and your time goes where you need it. It works like a homeschool: one teacher, one student."],
  ["I find it hard to learn in a crowd. Is SMA for me?", "Yes. Skill Mountain Academy was designed for people who learn better away from a crowd. There is no audience, no pressure and no comparing yourself with anyone else."],
  ["Do I need any experience?", "No. Programmes run from complete beginner to advanced. Your mentor starts exactly where you are, including if you have little or no IT experience."],
  ["Can I learn around my job, school or family?", "Yes. You choose training times that suit your life, so learning fits around your other commitments."],
  ["Which skills are in demand in the world job market?", "Companies everywhere need people who can build and run cloud systems, automate software delivery, defend against cyber threats, build websites and apps, grow brands online and design. Those are the skills our programmes teach. You can use them in a job, as a freelancer or in your own business, in Nigeria or abroad."],
  ["Will I have something real to show employers or clients?", "Yes. You learn by doing, through hands-on projects, real-world scenarios and industry tools. You build a portfolio and get career guidance along the way."],
  ["Do the Cloud programmes teach AWS or Azure?", "Both. Cloud Engineering, DevOps Engineering and Cloud & DevOps Engineering all teach Amazon Web Services (AWS) and Microsoft Azure, with hands-on projects on each, so you can work with either platform."],
  ["What is the internship?", "Every programme ends with an internship after the training: 2 months for most programmes and 3 months for Digital Marketing. You work on practical projects with guidance and feedback from your mentor, and add the work to your portfolio. It is part of your learning, not a paid job, and it is not a promise of employment."],
  ["Can I pay in instalments?", "Yes. You can pay in full, or in 3 parts: 50% when you register, 30% and 20% later (usually 45 and 90 days after registering, or 30 and 60 days for 3-month training). We email a secure payment link for each part on its due date, with a reminder 3 days before. Live-session access is paused if a payment is more than 2 weeks late."],
  ["Will I get a certificate?", "Yes. When you complete your programme's requirements you receive a Skill Mountain Academy certificate. It is an SMA certificate, not a university degree or a government or professional qualification."],
  ["Do you teach children?", "Yes, through our children's package. Children learn only through a parent or guardian's account and with the parent's consent, with a customised curriculum and one-on-one teaching. Visit the children's package page to send us an enquiry."],
  ["I am outside Nigeria. Can I enrol?", "Yes. Teaching is online, so you can study from anywhere. Programme fees are set in naira (₦). When you enrol, the country you select determines the currency in which we show an approximate equivalent: US dollars, pounds sterling or euros. Payment is processed in naira through Paystack, and your bank converts it at its own rate."],
  ["Are admissions open all year?", "Admissions are managed in periods, and enrolment on each programme is matched to the number of verified instructors available to teach it. Each programme page shows whether admissions are currently open."],
  ["How do I pay, and what happens next?", "Complete the enrolment form on the programme page, accept the terms and choose to pay in full or in 3 parts, by Paystack (card or bank transfer) or a manual transfer to our UBA account. When your payment is confirmed, we email your welcome message with your curriculum and a secure link to sign in to your student dashboard."],
  ["I paid by bank transfer. What do I do now?", "Send us your teller (proof of payment) on WhatsApp or email, quoting your reference. We confirm it and then send your welcome email. Please send it on or before the scheduled date for your programme."],
  ["How is my class time set?", "After enrolment you choose a preferred weekly day and time, for example Monday at 10:00. Once confirmed, that becomes your fixed weekly session with your instructor for the programme, and each week's Google Meet link appears in your dashboard. Any change to the timetable goes through Admissions."],
];

// Shown in the FAQ only when group classes are switched on (FLAGS.GROUP_ENABLED).
export const FAQ_GROUP: [string, string] = ["Can I learn with friends?", "Yes. You can learn with 1 or 2 friends in one shared live class, for one group price. The person registering adds the others by name and email, and each learner keeps their own record, grades and attendance."];
export const faqList = (): [string, string][] => (FLAGS.GROUP_ENABLED ? [...FAQ, FAQ_GROUP] : FAQ);

// Screenshots of real posts about SMA. Upload each image to the public/reviews folder in GitHub,
// then add a line here, for example: { file: "review-1.png", platform: "Instagram", alt: "Post by a learner" }
export const REVIEW_SHOTS: { file: string; platform: string; alt: string }[] = [];
