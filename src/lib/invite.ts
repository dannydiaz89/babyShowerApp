/**
 * The invite code behind the QR on a printed invitation.
 *
 * Not a second class of credential: a link carrying a valid code mints exactly
 * the cookie the password form mints, with the same lifetime and the same
 * revocation. What it buys is something the hosts can rotate without changing
 * the password everyone has already been told, and that nobody has to type.
 *
 * No server-only imports: the admin page builds a link with this, the route
 * that consumes one checks with it, and the tests read it directly.
 */

import { safeEqual } from "@/lib/auth";

/**
 * Crockford's base32 alphabet, which leaves out I, L, O and U. A guest reading
 * a code off paper cannot turn a 1 into an I, and with no U in the set the
 * generator cannot spell anything the hosts would rather it did not.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Ten characters: fifty bits, in front of the same per-address lockout that
 * guards the password. Long enough that guessing is hopeless, short enough
 * that the QR stays sparse and scans from a printed invitation.
 */
export const INVITE_CODE_LENGTH = 10;

/** A fresh code. Unbiased: 32 divides 256, so every byte maps evenly. */
export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * What a code means however it arrived.
 *
 * Uppercased and stripped of anything outside the alphabet, so a link typed
 * by hand, wrapped by a mail client, or written in lower case still matches.
 * An all-uppercase URL is also what lets a QR encoder use its alphanumeric
 * mode, which is a visibly sparser code at the same print size.
 *
 * Bounded, because this arrives from the network: a comparison never has to
 * walk further than a code's worth of characters.
 */
export function normalizeInviteCode(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 64);
}

/** Whether a submitted code is the stored one. Timing-safe; blank never matches. */
export function inviteCodeMatches(submitted: string, stored: string | undefined): boolean {
  const expected = normalizeInviteCode(stored ?? "");
  if (!expected) return false;

  return safeEqual(normalizeInviteCode(submitted), expected);
}

/** Where a code lives in a URL. One place, so the route and the link agree. */
export function invitePath(code: string, next?: string): string {
  const path = `/i/${encodeURIComponent(code)}`;
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
