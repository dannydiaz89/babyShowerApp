/**
 * What a photo route can answer when it says no.
 *
 * Codes rather than sentences: the browser has the dictionary in the
 * reader's language and turns each into a message. Shared by the routes
 * and the client components, so it has no server-only imports.
 */
export const PHOTO_ERROR_CODES = [
  /** No current guest or host session. */
  "signed-out",
  /** The hosts have not opened the wall, or have closed uploads. */
  "closed",
  /** Too many requests from this device; try later. */
  "rate-limited",
  /** The file is over the size limit. */
  "too-large",
  /** The request was not shaped as expected. */
  "bad-request",
  /** Google Drive could not be reached or refused. */
  "drive",
  /** No such photo. */
  "not-found",
  /** The caller may not do that to this photo. */
  "forbidden",
  /** Something else went wrong; the server has logged it. */
  "failed",
] as const;

export type PhotoErrorCode = (typeof PHOTO_ERROR_CODES)[number];

export function isPhotoErrorCode(value: unknown): value is PhotoErrorCode {
  return (PHOTO_ERROR_CODES as readonly string[]).includes(value as string);
}
