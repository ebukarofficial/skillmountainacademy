import type { NextConfig } from "next";

// BASE_PATH is set by the GitHub Actions workflow to "/<repo-name>".
// Leave it empty when using a custom domain.
const base = process.env.BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: base,
  images: { unoptimized: true },
  trailingSlash: true,
  env: { NEXT_PUBLIC_BASE_PATH: base },
};

export default nextConfig;
