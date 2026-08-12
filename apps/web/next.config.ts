import type { NextConfig } from "next";
import path from "path";

/** Normalize "/cases" or "cases" → "/cases"; empty → undefined (app at root). */
function normalizeBasePath(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === "/") return undefined;
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/$/, "") || undefined;
}

const basePath = normalizeBasePath(process.env.BASE_PATH);

const nextConfig: NextConfig = {
  // Standalone output is required for the production Docker image (Mac mini).
  output: "standalone",
  // Edge / shared Cloudflare URL: BASE_PATH=/cases (build-time).
  ...(basePath ? { basePath } : {}),
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
  // Expose to the browser for Better Auth client path under the prefix.
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath ?? "",
  },
};

export default nextConfig;
