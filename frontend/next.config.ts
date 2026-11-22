import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy.
 * - No third-party origins at all: fonts, scripts and styles are self-hosted.
 * - 'unsafe-inline' for scripts is needed by the Next.js bootstrap and the next-themes
 *   no-flash snippet; 'unsafe-eval' is only added in development (React Refresh).
 * - blob:/data: images are used for local upload previews and canvas exports.
 */
const csp = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // The application never uses next/image. Switching the optimiser off also lets the image leave
  // out sharp and its LGPL libvips binaries (see Dockerfile).
  images: { unoptimized: true },
  reactStrictMode: true,
  // NOTE: the API proxy is NOT a `rewrites()` entry. Rewrites in next.config are
  // resolved at build time, which would bake API_INTERNAL_URL into the image.
  // See src/app/api/v1/[...path]/route.ts, which reads the env var per request.
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The page policy is NOT applied to /api: those responses are proxied from the backend and
      // keep its stricter policy ("default-src 'none'", plus "sandbox" on file downloads). Setting
      // the page policy there replaced it.
      { source: "/((?!api/).*)", headers: [{ key: "Content-Security-Policy", value: csp }] },
    ];
  },
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
