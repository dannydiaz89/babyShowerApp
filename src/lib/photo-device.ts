import { GUEST_SESSION_SECONDS, signValue, verifySignedValue } from "@/lib/auth";

/**
 * Which phone added a photo.
 *
 * There are no guest accounts, and the guest cookie only proves the shared
 * password. So a second cookie carries a random id, nothing more, that a
 * photo remembers as its uploader. "Your photos" means "photos from this
 * device". Lose the cookie and the photos stay; they are just no longer
 * yours to remove, which is what the hosts are for.
 *
 * The id is signed. It carries little power over other people's photos,
 * but the upload limits are keyed on it, and an unsigned value could be
 * made up fresh for every request. Signed, a new id costs a page load,
 * and the per-address limits in the routes bound that too.
 *
 * Its lifetime matches the guest session. Kept out of lib/photos.ts because
 * the middleware sets this cookie, and middleware runs on the Edge runtime
 * where next/headers is not available.
 */
export const UPLOADER_COOKIE = "bs_photos";

const LABEL = "photo-device";

export function isUploaderId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}

export function newUploaderId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fresh id, signed, ready to set as the cookie's value. */
export async function mintUploaderCookie(): Promise<string> {
  return signValue(LABEL, newUploaderId());
}

/** The device id inside a cookie value, or null if it is missing, malformed or unsigned. */
export async function readUploaderCookie(value: string | undefined): Promise<string | null> {
  const id = await verifySignedValue(LABEL, value);
  return isUploaderId(id) ? id : null;
}

export function uploaderCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_SESSION_SECONDS,
  } as const;
}
