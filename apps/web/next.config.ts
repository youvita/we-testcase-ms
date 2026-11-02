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
  // basePath means Next serves nothing at the true origin root, so on a
  // hostname of our own (the app's dedicated tunnel) "/" is a bare 404. Send
  // it to the app. `basePath: false` keeps the rule off the prefix, so it
  // matches a literal "/" and not the internal "/" that "/cases/" becomes --
  // without it the two would redirect to each other forever.
  ...(basePath
    ? {
        async redirects() {
          return [
            {
              source: "/",
              destination: basePath,
              permanent: false,
              basePath: false,
            },
          ];
        },
      }
    : {}),
  // Expose to the browser for Better Auth client path under the prefix.
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath ?? "",
  },
};

export default nextConfig;
