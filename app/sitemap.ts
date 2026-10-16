import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";
export const dynamic = "force-static";
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "monthly", priority: 1 },
    ...["terms", "privacy", "cookies", "refunds"].map((p) => ({ url: `${SITE_URL}/${p}/`, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
