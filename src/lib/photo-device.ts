import { GUEST_SESSION_SECONDS } from "@/lib/auth";

/**
 * Which phone added a photo.
 *
 * There are no guest accounts, and the guest cookie only proves the shared
 * password. So a second cookie carries a random id, nothing more, that a
 * photo remembers as its uploader. "Your photos" means "photos from this
 * device". Lose the cookie and the photos stay; they are just no longer
 * yours to remove, which is what the hosts are for.
 *
 * Its lifetime matches the guest session. It carries little power — the
 * worst a stolen one can do is hide that device's own photos, which a host
 * can restore.
 *
 * Kept out of lib/photos.ts because the middleware sets this cookie, and
 * middleware runs on the Edge runtime where next/headers is not available.
 */
export const UPLOADER_COOKIE = "bs_photos";

export function isUploaderId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}

export function newUploaderId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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
