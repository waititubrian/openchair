import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
    // Dev-time "instant navigation" checks only run on segments that opt in with
    // `export const instant`. The signed-in dashboard is rendered per request on purpose
    // (session and role are read fresh, never cached in the browser), so it would
    // otherwise be flagged on every page. Public booking pages will opt in.
    instantInsights: { validationLevel: "manual-warning" },
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
