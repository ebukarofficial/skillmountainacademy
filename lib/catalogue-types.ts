// Shapes shared by the database catalogue (Worker), the build-time export (scripts/catalogue-export.mts) and the
// website (lib/config.ts). Prices on the public side are whole naira, as everywhere else on the website.
export type SnapshotProgramme = {
  slug: string; name: string; tag: string; tone: string; blurb: string; price: number; was: number | null;
  trainingMonths: number; internshipMonths: number; level: string; audience: string | null; track: "cloud" | null;
  timedPrice: number | null; groupPrice: number | null; fullPaymentOnly: boolean; learn: string[];
  school: string | null; priceUsdCents: number | null; description: string | null; curriculumOutline: string[]; finalProject: string | null;
};
export type SnapshotSchool = { slug: string; code: string; name: string; tab: string; tone: string };
export type CatalogueSnapshot = {
  source: "database"; generatedAt: string; programmes: SnapshotProgramme[]; schools: SnapshotSchool[]; retired: { slug: string; name: string }[];
};
