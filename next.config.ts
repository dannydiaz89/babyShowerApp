import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Next.js inlines a little bootstrap script, so 'unsafe-inline' is required
 * for scripts; React Refresh additionally needs 'unsafe-eval' in development.
 * Fonts are self-hosted by next/font, so nothing needs an external origin.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  /*
   * Production only. This directive rewrites every http:// request as https://,
   * which is right once the site is on Vercel — but in development it breaks
   * access from another device on the network: the phone asks for
   * http://192.168.x.x:3001, the directive upgrades it, the dev server speaks
   * no TLS, and you get ERR_SSL_PROTOCOL_ERROR or a page with no stylesheet.
   * localhost is exempt from the upgrade, which is why it only shows on a phone.
   */
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const baseHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Clickjacking: nobody frames this site and harvests clicks on it.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // The registry links point off-site. Without this, Amazon and Target would
  // receive the invitation URL in the Referer header.
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

// HSTS is ignored over plain HTTP anyway, and pinning it while testing on a
// phone risks that device refusing http:// to this host later.
if (!isDev) {
  baseHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  });
}

const nextConfig: NextConfig = {
  poweredByHeader: false,

  /*
   * Reaching the dev server from a phone means requests arrive with a LAN
   * origin rather than localhost, which Next.js flags and will eventually
   * block for /_next/* assets. Development only; production serves one origin.
   */
  ...(isDev
    ? { allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.*.*", "10.*.*.*"] }
    : {}),

  /**
   * Build output directory, overridable per process.
   *
   * A second `next dev` (or a `next build`) sharing `.next` with a running dev
   * server will delete files out from under it, and the running server then
   * throws ENOENT on routes-manifest.json and friends. Set NEXT_DIST_DIR to
   * give the second process its own directory instead. See `pnpm dev:scratch`.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  async headers() {
    return [
      { source: "/:path*", headers: baseHeaders },
      {
        // Every admin response contains guest names, emails and phone numbers.
        // Keep them out of browser, proxy and CDN caches entirely.
        source: "/admin/:path*",
        headers: [
          ...baseHeaders,
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, private",
          },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

export default nextConfig;
