import "server-only";
import { cookies } from "next/headers";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cache } from "react";
import type { PhotoTotals, PhotoView, WallFilter } from "../../convex/photos";
import {
  PHOTO_PAGE_SIZE,
  PHOTO_STORAGE_CAP_BYTES,
  PHOTO_WEB_MAX_EDGE_DRIVE,
  PHOTO_WEB_MAX_EDGE_SITE,
} from "../../convex/limits";
import { convexClient, convexKey } from "@/lib/convex";
import type { PhotoStorage } from "@/lib/defaults";
import { getDriveConnection, googleConfigured, maybeReprobe } from "@/lib/google-drive";
import {
  UPLOADER_COOKIE,
  isUploaderId,
  newUploaderId,
  uploaderCookieOptions,
} from "@/lib/photo-device";
import { photoWallState, withStorage, type StorageStatus, type WallState } from "@/lib/photo-wall";
import { hasGuestAccess, isAdminSession } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export type { PhotoTotals, PhotoView, WallFilter };
export { UPLOADER_COOKIE, isUploaderId, newUploaderId, uploaderCookieOptions };

/* ------------------------------------------------------------- identity */

/**
 * The device id from the cookie, or null if there is none worth trusting.
 * See lib/photo-device.ts for what the cookie is and why it exists.
 */
export async function currentUploaderId(): Promise<string | null> {
  const value = (await cookies()).get(UPLOADER_COOKIE)?.value;
  return isUploaderId(value) ? value : null;
}

/**
 * The device id, minting and setting one if this device has none yet.
 *
 * Normally the middleware has already set it on the page load. This is the
 * fallback for a request that arrived without one — and the reason it must
 * stay a fallback: three uploads starting together with no cookie would
 * each mint their own here.
 */
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

/** How large a web copy the phone makes, by where the original goes. */
export function webMaxEdgeFor(storage: PhotoStorage): number {
  return storage === "drive" ? PHOTO_WEB_MAX_EDGE_DRIVE : PHOTO_WEB_MAX_EDGE_SITE;
}

/**
 * Where things stand with the storage behind the wall, for the pause rule
 * and the hosts' notices. Memoised per request: the header, the page and a
 * route can each ask.
 *
 * A failing-but-recoverable Drive connection is re-probed here once its
 * interval has passed, so an outage on Google's side clears itself on the
 * next page load after it ends, with no host involved.
 */
export const storageStatus = cache(async (): Promise<StorageStatus> => {
  const settings = await getSettings();
  const [connection, totals] = await Promise.all([
    settings.photoStorage === "drive" && googleConfigured()
      ? getDriveConnection().then((c) => (c ? maybeReprobe(c) : null))
      : Promise.resolve(null),
    loadTotals().catch((error) => {
      console.error("Reading the photo totals failed", error);
      return { live: 0, hidden: 0, bytes: 0 };
    }),
  ]);
  return {
    storage: settings.photoStorage,
    drive: connection ? { health: connection.health, failureKind: connection.failureKind } : null,
    bytes: totals.bytes,
    cap: PHOTO_STORAGE_CAP_BYTES,
  };
});

/**
 * Whether the wall is showing and taking uploads: the hosts' settings and
 * today's date first, then whether the storage behind it is ready.
 */
export const wallState = cache(async (): Promise<WallState> => {
  const settings = await getSettings();
  const base = photoWallState(
    {
      mode: settings.photoWall,
      startISO: settings.startISO,
      endISO: settings.endISO,
      closesISO: settings.photoWallClosesISO,
    },
    new Date()
  );
  // Nothing to pause when the wall is not taking uploads anyway.
  if (!base.uploads) return base;
  return withStorage(base, await storageStatus());
});

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
