/**
 * Where a redirect is allowed to send someone.
 *
 * Lives here rather than in a "use server" module: those may only export async
 * functions, so a plain helper exported from one is unusable. Both the gate
 * page and the sign-in actions need the same rule, and a second copy is how
 * one of them ends up missing a case.
 */

/** Somewhere inside this site, or the invitation. Never another origin. */
export function safeNext(value: unknown, fallback = "/invitation"): string {
  if (typeof value !== "string" || value === "") return fallback;

  /*
   * Next's redirect() accepts absolute URLs, so anything that a browser could
   * read as "somewhere else" has to go:
   *   //evil.example and /\evil.example are protocol-relative;
   *   https://evil.example is plainly external;
   *   a newline or tab can smuggle one of those past a naive check.
   */
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;

  return value;
}
