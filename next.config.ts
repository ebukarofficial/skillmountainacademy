import type { NextConfig } from "next";

// Static export. `next build` writes the finished website to the "out" folder, and Cloudflare serves that folder
// (see wrangler.jsonc). The site lives at the domain root, so no basePath or assetPrefix is needed.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true }, // there is no image optimiser on a static host
  trailingSlash: true,           // /checkout/ is written to out/checkout/index.html (matches html_handling in wrangler.jsonc)
};

export default nextConfig;
