/**
 * A deliberately tiny auth layer: two shared passwords, a signed cookie, no
 * user accounts and nothing to administer. Runs on the edge runtime (used by
 * middleware) as well as in Server Actions, so it sticks to Web Crypto.
 */

export const GUEST_COOKIE = "bs_guest";
export const ADMIN_COOKIE = "bs_admin";

/**
 * Guests stay signed in for a month — they'll come back to check details.
 * Admin sessions are short: that cookie is what protects the guest list, and
 * a laptop left open at a coffee shop shouldn't stay authorized for weeks.
 */
export const GUEST_SESSION_SECONDS = 30 * 24 * 60 * 60;
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;

export type Role = "guest" | "admin";

export function sessionSeconds(role: Role): number {
  return role === "admin" ? ADMIN_SESSION_SECONDS : GUEST_SESSION_SECONDS;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    throw new Error(
      "AUTH_SECRET is not set. Add it to .env.local and to your Vercel project."
    );
  }
  return s;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/** Comparison whose running time does not depend on where the strings differ. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Compare a submitted password against a plaintext one from the environment.
 * Both sides are hashed first so the comparison can't be timed, and so the
 * expected value never sits in memory next to the comparison.
 */
export async function passwordMatches(
  submitted: string,
  expected: string | undefined
): Promise<boolean> {
  if (!expected) return false;
  const [a, b] = await Promise.all([
    hmac(`pw:${submitted.trim()}`),
    hmac(`pw:${expected.trim()}`),
  ]);
  return safeEqual(a, b);
}

/**
 * A token that carried a valid signature for the role asked about, and has not
 * expired.
 *
 * `issuedAt` is the part callers cannot get anywhere else: a signed cookie has
 * no server-side record to revoke, so the only way to invalidate one early is
 * to compare when it was minted against a cutoff. See `hasGuestAccess` in
 * lib/session.ts, which checks it against the guest-password epoch.
 */
export type VerifiedToken = { issuedAt: number; expiresAt: number };

export async function createToken(role: Role): Promise<string> {
  const issued = Date.now();
  const expires = issued + sessionSeconds(role) * 1000;
  // Issue time is inside the signed payload, not alongside it: a holder who
  // could edit it would simply date their cookie forward past any cutoff.
  const payload = `${role}.${issued}.${expires}`;
  return `${payload}.${await hmac(payload)}`;
}

/**
 * Verify a cookie's signature, role and expiry. Returns what the token claims
 * once it has proved it, or null.
 *
 * Deliberately no I/O: this runs in middleware on every request, and the
 * revocation check that needs the database is layered on top by callers that
 * are already reading it.
 */
export async function verifyToken(
  token: string | undefined,
  role: Role
): Promise<VerifiedToken | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;

  const [tokenRole, issuedRaw, expiresRaw, signature] = parts;
  if (tokenRole !== role) return null;

  const issuedAt = Number(issuedRaw);
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;
  if (expiresAt < Date.now()) return null;

  const signed = await hmac(`${tokenRole}.${issuedRaw}.${expiresRaw}`);
  if (!safeEqual(signed, signature)) return null;

  return { issuedAt, expiresAt };
}

/** Shared cookie options, so login and logout paths cannot drift apart. */
export function cookieOptions(role: Role) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionSeconds(role),
  } as const;
}
