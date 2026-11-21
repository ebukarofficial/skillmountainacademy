// Editorial copy for each programme page. Prices, durations, names and the topic list stay in lib/config.ts
// (the source of truth) and the curriculum PDFs. Nothing here promises jobs, earnings or placements.

export type ProgrammeCopy = {
  discipline: string;      // one line for the programme card
  intro: string[];         // what the discipline is, and why it matters now
  opportunities: string[]; // kinds of work the skill can support (never a promise)
  mastery: string[];       // capabilities, not topics
  outcomes: string[];      // what a student should be able to show at the end
  suitedTo?: string;       // who the programme suits (the Cloud track uses lib/config.ts audience instead)
};

export const PROGRAMME_COPY: Record<string, ProgrammeCopy> = {
  graphics: {
    suitedTo: "Beginners and early-career creatives who want a professional command of design and its tools.",
    discipline: "Visual communication for brands, print and digital media.",
    intro: [
      "Graphic design is the discipline of making ideas visible: shaping how organisations, products and messages are seen and understood. It joins visual judgement with technical command of professional software.",
      "Every organisation communicates visually, on screens, in print and across social platforms. Designers who can think strategically and execute precisely remain essential to that work.",
    ],
    opportunities: ["In-house brand and marketing teams", "Design studios and agencies", "Independent practice for clients", "Building the visual identity of your own venture"],
    mastery: ["Apply layout, colour and typography with deliberate intent", "Edit and compose images to a professional standard in Photoshop", "Build logos and vector artwork in Illustrator", "Prepare print and multi-page layouts in InDesign", "Present and defend design decisions to a client"],
    outcomes: ["A portfolio of finished brand projects, from brief to final files", "Print-ready and screen-ready artwork prepared to professional specifications", "The ability to take a client brief through concept, revision and delivery"],
  },
  uiux: {
    suitedTo: "Beginners, graphic designers and developers moving into digital product design. No coding is required.",
    discipline: "Research-led design of digital products people can use.",
    intro: [
      "Product design is the practice of understanding what people need and designing digital products that meet those needs clearly. It brings together research, structure, interaction and visual design.",
      "As more of life moves onto apps and websites, organisations depend on designers who can turn evidence about users into products that work.",
    ],
    opportunities: ["Product teams in technology companies", "Digital agencies and consultancies", "Freelance product and interface design", "Designing products for your own venture"],
    mastery: ["Plan and run user research, and turn findings into design decisions", "Structure information and user flows", "Wireframe and prototype in Figma", "Build consistent, accessible interfaces with a design system", "Test a design with users and improve it"],
    outcomes: ["Product design case studies documenting research, decisions and results", "Interactive prototypes ready for testing and handover", "A working method you can apply to an unfamiliar product problem"],
  },
  webdev: {
    suitedTo: "Beginners comfortable using a computer, and self-taught developers who want structure and review.",
    discipline: "Building and shipping modern websites and web applications.",
    intro: [
      "Web development is the craft of building the sites and applications people use every day, from the structure of a page to the logic and data behind it.",
      "Nearly every organisation runs on the web. Developers who can build reliably, work with version control and deploy their own work are needed across every sector.",
    ],
    opportunities: ["Product and engineering teams", "Agencies building for clients", "Freelance development", "Building and launching your own products"],
    mastery: ["Write semantic, responsive HTML and CSS", "Program confidently in JavaScript", "Build interfaces with a modern framework", "Connect applications to APIs and data", "Use Git and GitHub, and deploy a live site"],
    outcomes: ["Live, deployed web projects you built and can explain line by line", "A public GitHub record of your work", "The ability to plan, build and ship a small application independently"],
  },
  marketing: {
    suitedTo: "Business owners, early-career marketers and beginners who want to grow an audience online with evidence.",
    discipline: "Strategy, content and measurement for growth online.",
    intro: [
      "Digital marketing is the discipline of reaching and persuading people online: understanding an audience, creating content for it, and measuring what works.",
      "Businesses of every size compete for attention online. Marketers who combine strategy with evidence from analytics are central to how organisations grow.",
    ],
    opportunities: ["Marketing teams in companies of every size", "Agencies managing campaigns for clients", "Independent consulting", "Growing your own business or brand"],
    mastery: ["Research an audience and position a brand", "Plan and produce social media content to a strategy", "Apply the fundamentals of search engine optimisation", "Run email and paid advertising campaigns", "Read analytics and report results honestly"],
    outcomes: ["A documented campaign plan built on audience research", "Content and campaign work you have run and measured", "Reports that show what worked, what did not and what to do next"],
  },
  cybersecurity: {
    suitedTo: "Beginners with an interest in technology, and IT professionals moving into security.",
    discipline: "Protecting systems, networks and data from real threats.",
    intro: [
      "Cybersecurity is the practice of defending systems, networks and information against attack, misuse and failure. It demands technical depth, method and sound judgement.",
      "Every organisation that holds data is a potential target. People who understand how attacks work, and how to prevent, detect and respond to them, are needed in every industry.",
    ],
    opportunities: ["Security and IT operations teams", "Consultancies and managed security providers", "Risk, governance and compliance functions", "Securing systems in your own organisation"],
    mastery: ["Explain and secure networks and operating systems", "Assess threats, vulnerabilities and risk", "Secure web and cloud applications", "Monitor for, detect and respond to incidents", "Apply ethical hacking techniques within agreed boundaries"],
    outcomes: ["Documented security assessments of practice environments", "Incident response work recorded step by step", "A clear understanding of security policy and compliance in practice"],
  },
  cloud: {
    discipline: "Designing and running applications on AWS and Azure.",
    intro: [
      "Cloud engineering is the discipline of designing, deploying and operating systems on cloud platforms. This programme teaches both Amazon Web Services and Microsoft Azure.",
      "Modern organisations increasingly run on cloud infrastructure. Engineers who can deploy securely, automate and control cost are central to that shift. The programme is suitable for beginners.",
    ],
    opportunities: ["Cloud and infrastructure teams", "Technology consultancies", "Operations and support roles moving to the cloud", "Running infrastructure for your own products"],
    mastery: ["Work with cloud compute, storage and networking", "Manage identity, security and access", "Deploy and scale applications", "Describe infrastructure as code", "Monitor systems, plan backups and control cost"],
    outcomes: ["Hands-on projects deployed on both AWS and Azure", "Infrastructure you can rebuild from code", "The ability to explain the design and cost of what you deployed"],
  },
  devops: {
    discipline: "Automating how software is built, tested and released.",
    intro: [
      "DevOps engineering connects software development with operations, so that software is built, tested and released reliably and quickly. This programme works on both AWS and Azure.",
      "Organisations that ship software depend on automation. Engineers who can build pipelines, work with containers and keep live systems healthy are essential to modern delivery. Basic cloud knowledge is expected.",
    ],
    opportunities: ["Platform and DevOps teams", "Site reliability and operations functions", "Consultancies supporting delivery teams", "Automating delivery for your own products"],
    mastery: ["Work fluently on Linux and the command line", "Run professional Git and GitHub workflows", "Build CI/CD pipelines that test and ship code", "Package applications with Docker", "Deploy and operate applications on Kubernetes"],
    outcomes: ["Working pipelines that take code from commit to production", "Containerised applications deployed and monitored on AWS and Azure", "The ability to troubleshoot a failing release methodically"],
  },
  "cloud-devops": {
    discipline: "The complete path from cloud fundamentals to DevOps.",
    intro: [
      "This programme combines cloud engineering and DevOps in one continuous path, beginning with the fundamentals of AWS and Azure and progressing to automation, containers and delivery pipelines.",
      "It is designed for learners who want the full foundation in one programme, from first deployments to the practices modern engineering teams rely on.",
    ],
    opportunities: ["Cloud, platform and DevOps teams", "Technology consultancies", "Operations roles moving to modern delivery", "Building and running your own products"],
    mastery: ["Work with core cloud services on AWS and Azure", "Secure identities and networks in the cloud", "Use Linux, Git and infrastructure as code", "Build CI/CD pipelines", "Operate containers with Docker and Kubernetes"],
    outcomes: ["Projects that span infrastructure, automation and delivery", "Deployments on both AWS and Azure you can rebuild from code", "Readiness to take on cloud and DevOps work under guidance"],
  },
  "ai-automation": {
    suitedTo: "Professionals, business owners and operators who want to apply AI and automation to real work. No programming background is required.",
    discipline: "Applying AI tools and automation to business and professional workflows.",
    intro: [
      "AI automation is the practice of combining modern AI tools with workflow automation so that routine work (research, drafting, follow-up, data entry, reporting) is handled reliably and reviewed by people.",
      "The programme teaches real tools and their limits. Students design, build, test and maintain automations for actual business processes, and learn where human judgement must stay in the loop.",
    ],
    opportunities: ["Operations and administration roles", "Marketing, sales and customer teams", "Independent automation work for small businesses", "Running and improving your own business"],
    mastery: ["Choose the right AI tool for a task, and recognise where it fails", "Design a business process as a workflow before automating it", "Build no-code and low-code automations that connect business applications",
      "Set up AI assistants and agents for research, content and customer work", "Automate lead capture, customer follow-up and marketing tasks", "Support e-commerce and dropshipping operations with AI and automation",
      "Test, monitor and improve automations over time"],
    outcomes: ["Working automations built for real business processes, documented for handover", "A practical project portfolio from training and the internship", "A method for assessing which work should and should not be automated"],
  },
};

const FALLBACK: ProgrammeCopy = { discipline: "", intro: [], opportunities: [], mastery: [], outcomes: [] };
export const programmeCopy = (slug: string): ProgrammeCopy => PROGRAMME_COPY[slug] ?? FALLBACK;
