/**
 * The site's own origin, from the headers of a request to it.
 *
 * Pure, so the rule that decides what address the tidy cron will call can
 * be tested. Only what a host's browser used is considered, and only when
 * a cron running elsewhere could reach it: a localhost or private-name
 * origin from development is not worth recording, and would only make the
 * cron fail every ten minutes.
 */
type Headers = { get(name: string): string | null };

/**
 * The origin this request was made to, development addresses included.
 *
 * What a host's own browser is looking at, which is what the invite link in
 * Settings has to be built from: on localhost it must say localhost, or the
 * QR a host scans to test their card goes nowhere.
 */
export function originFrom(headers: Headers): string | null {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim();
  if (!host) return null;
  const proto = (headers.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
  if (proto !== "http" && proto !== "https") return null;

  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

export function siteOriginFrom(headers: Headers): string | null {
  const origin = originFrom(headers);
  if (!origin) return null;

  const name = new URL(origin).hostname;
  if (
    name === "localhost" ||
    name === "127.0.0.1" ||
    name === "[::1]" ||
    name.endsWith(".local") ||
    name.endsWith(".localhost")
  ) {
    return null;
  }
  return origin;
}
