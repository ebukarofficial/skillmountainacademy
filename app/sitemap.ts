import type { MetadataRoute } from "next";
import { PROGRAMMES, SITE_URL } from "@/lib/config";
export const dynamic = "force-static";
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "monthly", priority: 1 },
    ...PROGRAMMES.map((p) => ({ url: `${SITE_URL}/programmes/${p.slug}/`, changeFrequency: "monthly" as const, priority: 0.8 })),
    ...["terms", "privacy", "cookies", "refunds"].map((p) => ({ url: `${SITE_URL}/${p}/`, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
