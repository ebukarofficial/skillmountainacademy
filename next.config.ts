import type { NextConfig } from "next";

// BASE_PATH is set by the GitHub Actions workflow to "/<repo-name>".
// Leave it empty when using a custom domain.
const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.BASE_PATH ?? "",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
