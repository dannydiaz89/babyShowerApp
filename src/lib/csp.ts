/**
 * The site's Content-Security-Policy, minted fresh for every request.
 *
 * Next.js inlines a bootstrap script into every HTML response, which used to
 * force `script-src 'unsafe-inline'`. That single source undoes most of what a
 * CSP is for: it permits the inline <script> an XSS injects just as readily as
 * the one the framework wrote. Instead the middleware generates a nonce per
 * request and Next stamps it on the scripts it inlines, so the policy can name
 * that one script and refuse every other.
 *
 * This deliberately does not live in next.config.ts. Headers declared there are
 * static, and a nonce that repeats across requests is a nonce in name only —
 * an attacker who can read one page can reuse it.
 */
export type CspOrigins = {
  /**
   * Where photo web copies are served from — the Convex storage host. Only
   * `img-src`: nothing else on the page is allowed to reach it.
   */
  imageOrigins?: string[];
  /**
   * Where the browser may send a request. Google's upload endpoint, so a
   * phone can PUT an original straight to the hosts' Drive without the
   * bytes passing through this server.
   */
  connectOrigins?: string[];
};

/** Keep only well-formed https origins: a bad env value must not widen the policy. */
function origins(list: string[] | undefined): string {
  const kept: string[] = [];
  for (const value of list ?? []) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && url.origin !== "null") kept.push(url.origin);
    } catch {
      // Not a URL; dropped.
    }
  }
  return kept.length > 0 ? ` ${kept.join(" ")}` : "";
}

export function contentSecurityPolicy(
  nonce: string,
  isDev: boolean,
  extra: CspOrigins = {}
): string {
  return [
    "default-src 'self'",

    /*
     * 'strict-dynamic' lets the nonced bootstrap pull in the chunk files it
     * needs without this policy naming each hashed filename. Browsers too old
     * to implement it ignore the keyword and fall back to 'self', which admits
     * those same chunks by origin — so both paths work and neither admits an
     * inline script. React Refresh compiles with eval, in development only.
     */
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,

    /*
     * Styles stay 'unsafe-inline'. next/font inlines a <style> block and
     * Tailwind's preflight arrives the same way, and neither can be nonced
     * without Next emitting the nonce on them. An injected <style> cannot
     * execute, which is why the script-src above is the half that matters.
     */
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${origins(extra.imageOrigins)}`,
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}${origins(extra.connectOrigins)}`,
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
}

/**
 * A fresh 128-bit nonce, base64 encoded because that is the alphabet the CSP
 * source-expression grammar accepts. Uses the Web Crypto API rather than
 * Node's, since middleware runs on the Edge runtime.
 */
export function cspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
