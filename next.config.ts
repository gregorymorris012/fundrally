import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local Supabase's redirect allow-list only has 127.0.0.1 entries (not
  // localhost), so auth testing has to happen on http://127.0.0.1:3000 —
  // but Next.js 16 dev mode blocks cross-origin dev-resource requests
  // (JS bundle chunks, HMR) from any origin not in this list by default,
  // which silently breaks client-side hydration (buttons stop doing
  // anything, no console error obviously pointing here).
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
