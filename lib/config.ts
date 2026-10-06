export const SITE_URL = "https://ebukarofficial.github.io/skillmountainacademy";

export const CFG = {
  paystackKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "",
  sheetUrl: process.env.NEXT_PUBLIC_SHEET_URL ?? "", // Google Apps Script web app (payment check, emails, mailing list)
  base: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  whatsapp: process.env.NEXT_PUBLIC_WHATSAPP || "2347061000472", // used only for the Chat button and Partner button
  usdRate: 1400, // naira per US dollar. Used only if the live rate cannot be loaded.
};

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
  id: string;
  name: string;
  tag: string;
  blurb: string;
  live: boolean;
  fee?: number; // discounted price in naira that the learner pays
  was?: number; // usual price in naira, shown crossed out
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
  { id: "cyber", name: "Cybersecurity", tag: "Engineering", live: true, fee: 650000, was: 850000,
    tone: "from-ink via-navy to-brand-red",
    blurb: "Learn to protect systems, networks and data from real-world threats.",
    learn: ["Networking and operating system security fundamentals", "Threats, vulnerabilities and risk assessment",
      "Securing web and cloud applications", "Monitoring, detecting and responding to incidents",
      "Ethical hacking and penetration testing basics", "Security policies, compliance and best practice"] },
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
  { id: "data", name: "Data Analytics", tag: "Data", live: false, tone: "from-navy via-plum to-brand-red",
    blurb: "Turn data into decisions with analysis, dashboards and storytelling.", learn: [] },
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

// "Tell us your goal" picker in the Your Path section.
export const GOALS: { goal: string; id: string; why: string }[] = [
  { goal: "Build a career in tech", id: "cloud", why: "Cloud engineers design and run the systems that modern companies depend on, and the skill travels across borders." },
  { goal: "Automate and ship software", id: "devops", why: "DevOps engineers connect development and operations so software is built, tested and released faster." },
  { goal: "Protect systems and data", id: "cyber", why: "Cybersecurity professionals defend organisations against attacks. Every industry needs them." },
  { goal: "Create and design", id: "graphics", why: "Graphics designers shape how brands look. You can work for a company, freelance, or build your own studio." },
  { goal: "Grow a brand or business online", id: "marketing", why: "Digital marketing skills help any business find customers online, including your own." },
  { goal: "Study or work abroad", id: "ielts", why: "A strong IELTS score is asked for by many universities and employers abroad. Your mentor focuses on your target score." },
];

// "Your path" step-by-step guide.
export const STEPS: { title: string; text: string; cta?: [string, string] }[] = [
  { title: "Explore at your own pace", text: "Use the search box at the top of the page, or the category tabs in the Programmes section. Open What you'll learn on any card to see exactly what you will cover.", cta: ["Browse programmes", "#programmes"] },
  { title: "Choose the programme that fits your goal", text: "Not sure where to start? Pick your goal in the box above and we will point you to the best match. You can change your mind before you pay.", cta: ["Pick my goal", "#goal"] },
  { title: "Check your price and your discount", text: "The price on each card is the discounted price you pay. Where you see a crossed-out figure, that is the usual price. Prices show in naira with an approximate US dollar amount for learners outside Nigeria." },
  { title: "Read and accept the terms", text: "On the checkout page you will read our Terms and Conditions and tick the box to confirm you have read and understood them. You cannot pay until you do." },
  { title: "Register and pay securely", text: "Enter your name, email and phone or WhatsApp number, then click Pay. Paystack opens so you can pay by card or bank transfer. Learners abroad can pay with an international card." },
  { title: "Get your confirmation", text: "Within minutes of your payment being confirmed, we email you a payment confirmation and your learning resources. Check your spam folder if you do not see it." },
  { title: "Meet your mentor and begin", text: "Your mentor contacts you to learn your goals, agree your schedule and set up your first one-on-one session. From there, you learn at your pace." },
];

export const FAQ: [string, string][] = [
  ["Why is one-on-one learning better than a class?", "In a group, the pace is set by the room. Here, a mentor teaches only you. Your questions are answered straight away, nothing is skipped, and your time goes where you need it. It works like a homeschool: one teacher, one student."],
  ["I find it hard to learn in a crowd. Is SMA for me?", "Yes. Skill Mountain Academy was designed for people who learn better away from a crowd. There is no audience, no pressure and no comparing yourself with anyone else."],
  ["Do I need any experience?", "No. Programmes run from complete beginner to advanced. Your mentor starts exactly where you are, including if you have little or no IT experience."],
  ["Can I learn around my job, school or family?", "Yes. You choose training times that suit your life, so learning fits around your other commitments."],
  ["Which skills are in demand in the world job market?", "Companies everywhere need people who can build and run cloud systems, automate software delivery, defend against cyber threats, grow brands online and design. Those are the skills our programmes teach. You can use them in a job, as a freelancer or in your own business, in Nigeria or abroad."],
  ["How can IELTS Training help my career?", "Many universities and employers abroad ask for an IELTS score. Our IELTS Training prepares you for the exam so you can apply for study and work opportunities with confidence."],
  ["Will I have something real to show employers or clients?", "Yes. You learn by doing, through hands-on projects, real-world scenarios and industry tools. You build a portfolio and get career guidance along the way."],
  ["I am outside Nigeria. Can I register?", "Yes. Prices show in US dollars as a guide. You pay through Paystack in naira, and your bank converts the amount at its own rate."],
  ["How do I pay, and what happens next?", "Choose your programme, accept the terms, and pay by card or bank transfer. Once Paystack confirms your payment, we email you a payment confirmation and your learning resources, and your mentor gets in touch."],
];

// Screenshots of real posts about SMA. Upload each image to the public/reviews folder in GitHub,
// then add a line here, for example: { file: "review-1.png", platform: "Instagram", alt: "Post by a learner" }
export const REVIEW_SHOTS: { file: string; platform: string; alt: string }[] = [];
