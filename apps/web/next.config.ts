import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Standalone output is required for the production Docker image (Mac mini).
  output: "standalone",
  // Include monorepo packages in the standalone file trace.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@wetestcase/dto"],
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
