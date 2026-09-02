/**
 * The site's own origin, from the headers of a request to it.
 *
 * Pure, so the rule that decides what address the tidy cron will call can
 * be tested. Only what a host's browser used is considered, and only when
 * a cron running elsewhere could reach it: a localhost or private-name
 * origin from development is not worth recording, and would only make the
 * cron fail every ten minutes.
 */
export function siteOriginFrom(headers: {
  get(name: string): string | null;
}): string | null {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim();
  if (!host) return null;
  const proto = (headers.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
  if (proto !== "http" && proto !== "https") return null;

  let url: URL;
  try {
    url = new URL(`${proto}://${host}`);
  } catch {
    return null;
  }
  const name = url.hostname;
  if (
    name === "localhost" ||
    name === "127.0.0.1" ||
    name === "[::1]" ||
    name.endsWith(".local") ||
    name.endsWith(".localhost")
  ) {
    return null;
  }
  return url.origin;
}
