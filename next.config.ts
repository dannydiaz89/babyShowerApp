import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const baseHeaders = [
  /*
   * Content-Security-Policy is deliberately absent here and set per request in
   * src/middleware.ts instead. It carries a nonce, and a header declared in
   * this file is identical on every response — which would make the nonce
   * worthless. See src/lib/csp.ts.
   */
  // Clickjacking: nobody frames this site and harvests clicks on it.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // The registry links point off-site. Without this, Amazon and Target would
  // receive the invitation URL in the Referer header.
  { key: "Referrer-Policy", value: "no-referrer" },
  /*
   * Puts the site in its own browsing-context group: a page that opens this one
   * cannot reach into it through window.opener, and the registry and map links
   * that open in a new tab get their opener severed on the way out. Nothing
   * here ever reads back from a window it opened, so this costs nothing.
   */
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
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
