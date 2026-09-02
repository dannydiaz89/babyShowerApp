import "server-only";
import { cookies } from "next/headers";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { PhotoTotals, PhotoView, WallFilter } from "../../convex/photos";
import { PHOTO_PAGE_SIZE } from "../../convex/limits";
import { GUEST_SESSION_SECONDS } from "@/lib/auth";
import { convexClient, convexKey } from "@/lib/convex";
import { photoWallState, type WallState } from "@/lib/photo-wall";
import { hasGuestAccess, isAdminSession } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export type { PhotoTotals, PhotoView, WallFilter };

/* ------------------------------------------------------------- identity */

/**
 * Which phone added a photo.
 *
 * There are no guest accounts, and the guest cookie only proves the shared
 * password. So the first upload from a device sets this second cookie: a
 * random id, nothing more, that a photo remembers as its uploader. "Your
 * photos" means "photos from this device". Lose the cookie and the photos
 * stay; they are just no longer yours to remove, which is what the hosts
 * are for.
 *
 * Its lifetime matches the guest session. It carries little power — the
 * worst a stolen one can do is hide that device's own photos, which a host
 * can restore.
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

/** The device id from the cookie, or null if there is none worth trusting. */
export async function currentUploaderId(): Promise<string | null> {
  const value = (await cookies()).get(UPLOADER_COOKIE)?.value;
  return isUploaderId(value) ? value : null;
}

/** The device id, minting and setting one if this device has none yet. */
export async function ensureUploaderId(): Promise<string> {
  const existing = await currentUploaderId();
  if (existing) return existing;
  const id = newUploaderId();
  (await cookies()).set(UPLOADER_COOKIE, id, uploaderCookieOptions());
  return id;
}

export type Caller = {
  /** Host outranks guest; null is nobody the site knows. */
  role: "host" | "guest" | null;
  uploaderId: string | null;
};

/** Who is calling a photo route. Route Handlers, like Server Actions, check for themselves. */
export async function photoCaller(): Promise<Caller> {
  const [host, guest, uploaderId] = await Promise.all([
    isAdminSession(),
    hasGuestAccess(),
    currentUploaderId(),
  ]);
  return { role: host ? "host" : guest ? "guest" : null, uploaderId };
}

/* ---------------------------------------------------------------- state */

/** Whether the wall is showing and taking uploads, from the hosts' settings and today's date. */
export async function wallState(): Promise<WallState> {
  const settings = await getSettings();
  return photoWallState(settings.photoWall, settings.startISO, new Date());
}

/* -------------------------------------------------------------- reading */

export type WallPage = { photos: PhotoView[]; cursor: string | null; done: boolean };

/**
 * One page of the wall.
 *
 * `viewerId` only decides the `mine` flag on each photo. A guest sees live
 * photos and nothing else; the filter is the caller's choice only for hosts,
 * which the routes enforce before getting here.
 */
export async function loadWallPage({
  filter,
  cursor,
  viewerId,
  numItems = PHOTO_PAGE_SIZE,
}: {
  filter: WallFilter;
  cursor: string | null;
  viewerId: string | null;
  numItems?: number;
}): Promise<WallPage> {
  const result: FunctionReturnType<typeof api.photos.wall> = await convexClient().query(
    api.photos.wall,
    { key: convexKey(), filter, viewerId, paginationOpts: { numItems, cursor } }
  );
  return { photos: result.page, cursor: result.continueCursor, done: result.isDone };
}

export async function loadTotals(): Promise<PhotoTotals> {
  return convexClient().query(api.photos.totals, { key: convexKey() });
}

/* -------------------------------------------------------------- storage */

/**
 * Put a web copy where the wall can serve it.
 *
 * This is the storage seam. Today the copy goes to Convex file storage
 * through a single-use upload URL; the wall then serves the URL the query
 * hands back. Moving copies to S3 or similar means replacing this function
 * and the `url` lookup in convex/photos.ts, and nothing the browser sees.
 */
export async function storeWebCopy(copy: Blob): Promise<Id<"_storage">> {
  const client = convexClient();
  const uploadUrl = await client.mutation(api.photos.generateUploadUrl, { key: convexKey() });

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": copy.type },
    body: copy,
  });
  if (!response.ok) throw new Error(`Storing the web copy failed (${response.status}).`);

  const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
  return storageId;
}
