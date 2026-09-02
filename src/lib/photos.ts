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
import {
  getDriveConnection,
  googleConfigured,
  scheduleReconcile,
  scheduleReprobe,
} from "@/lib/google-drive";
import { clientAddress, mintAllowed } from "@/lib/photo-routes";
import { after } from "next/server";
import {
  UPLOADER_COOKIE,
  mintUploaderCookie,
  readUploaderCookie,
  uploaderCookieOptions,
} from "@/lib/photo-device";
import { photoWallState, withStorage, type StorageStatus, type WallState } from "@/lib/photo-wall";
import { hasGuestAccess, isAdminSession } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export type { PhotoTotals, PhotoView, WallFilter };
export { UPLOADER_COOKIE, uploaderCookieOptions };

/* ------------------------------------------------------------- identity */

/**
 * The device id from the cookie, or null if there is none worth trusting.
 * See lib/photo-device.ts for what the cookie is and why it exists.
 */
export async function currentUploaderId(): Promise<string | null> {
  return readUploaderCookie((await cookies()).get(UPLOADER_COOKIE)?.value);
}

/**
 * The device id, minting and setting one if this device has none yet.
 *
 * Normally the middleware has already set it on the page load. This is the
 * fallback for a request that arrived without one — and the reason it must
 * stay a fallback: three uploads starting together with no cookie would
 * each mint their own here. Minting is rationed per address, here as in
 * the middleware; null means this address has had its share.
 */
export async function ensureUploaderId(): Promise<string | null> {
  const existing = await currentUploaderId();
  if (existing) return existing;
  if (!(await mintAllowed(await clientAddress()))) return null;
  const signed = await mintUploaderCookie();
  (await cookies()).set(UPLOADER_COOKIE, signed, uploaderCookieOptions());
  return readUploaderCookie(signed);
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
 * A failing-but-recoverable Drive connection is scheduled for a re-probe
 * here once its interval has passed — after the response, never in its
 * way — so an outage on Google's side clears itself on a later page load
 * with no host involved. The recorded state is what this request serves.
 */
export const storageStatus = cache(async (): Promise<StorageStatus> => {
  const settings = await getSettings();
  const [connection, totals] = await Promise.all([
    settings.photoStorage === "drive" && googleConfigured()
      ? getDriveConnection().then(async (c) => {
          if (!c) return null;
          // Any page load may tidy the folder, so an abandoned upload does
          // not wait for the next successful one to be noticed.
          await scheduleReconcile(c);
          return scheduleReprobe(c);
        })
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
    new Date(),
    settings.timeZone
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

/** How often stored copies are swept for orphans, at most, and how old one must be. */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const SWEEP_OLDER_THAN_MS = 30 * 60 * 1000;

/**
 * One page of the sweep of stored copies, continuing from where the last
 * one stopped. The route discards an orphan at once when it can; this
 * catches the ones it could not.
 */
export async function sweepStoredCopies(): Promise<{ deleted: number; done: boolean }> {
  try {
    const result = await convexClient().mutation(api.photos.sweepOrphanCopies, {
      key: convexKey(),
      olderThanMs: SWEEP_OLDER_THAN_MS,
      max: 500,
    });
    if (result.deleted > 0) {
      console.log(`Swept ${result.deleted} unowned web cop${result.deleted === 1 ? "y" : "ies"}.`);
    }
    return result;
  } catch (error) {
    console.error("Sweeping stored copies failed", error);
    return { deleted: 0, done: false };
  }
}

/**
 * Arrange a sweep after this response, if one is due. The cron in
 * convex/crons.ts is what guarantees one; this is the same work done
 * sooner when the site is busy.
 */
export async function scheduleStorageSweep(): Promise<void> {
  try {
    const claimed = await convexClient().mutation(api.photos.claimSweep, {
      key: convexKey(),
      intervalMs: SWEEP_INTERVAL_MS,
    });
    if (claimed) after(() => sweepStoredCopies());
  } catch (error) {
    console.error("Scheduling a storage sweep failed", error);
  }
}

/** Best effort: remove a stored copy that ended up with no photo row. */
export async function discardWebCopy(storageId: Id<"_storage">): Promise<void> {
  try {
    await convexClient().mutation(api.photos.discard, { key: convexKey(), storageId });
  } catch (error) {
    console.error("Discarding an orphaned web copy failed", error);
  }
}
