import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";
import {
  PHOTO_MAX_DIMENSION,
  PHOTO_UPLOADER_NAME_MAX,
  PHOTO_WEB_MAX_BYTES,
} from "../../../../convex/limits";
import { convexClient, convexKey } from "@/lib/convex";
import { recordDriveFailure, scheduleReconcile, verifyUploadedFile } from "@/lib/google-drive";
import {
  discardWebCopy,
  ensureUploaderId,
  loadWallPage,
  photoCaller,
  storeWebCopy,
  wallState,
  type WallFilter,
} from "@/lib/photos";
import { refuse, withinLimits } from "@/lib/photo-routes";
import { getSettings } from "@/lib/settings";

/*
 * The photo wall's two main endpoints.
 *
 *   GET  /api/photos?cursor=…&filter=…   one page, for infinite scroll
 *   POST /api/photos                     record a photo whose copies are up
 */

export const dynamic = "force-dynamic";

const WEB_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);

function filterParam(value: string | null, role: "host" | "guest"): WallFilter {
  // Guests see the live wall and nothing else, whatever the URL says.
  if (role !== "host") return "live";
  return value === "hidden" || value === "all" ? value : "live";
}

export async function GET(request: Request) {
  const caller = await photoCaller();
  if (!caller.role) return refuse("signed-out", 401);

  const state = await wallState();
  if (!state.visible && caller.role !== "host") return refuse("closed", 403);

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");

  try {
    const page = await loadWallPage({
      filter: filterParam(url.searchParams.get("filter"), caller.role),
      cursor: cursor && cursor.length < 4096 ? cursor : null,
      viewerId: caller.uploaderId,
    });
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Loading a wall page failed", error);
    return refuse("failed", 500);
  }
}

function integer(value: FormDataEntryValue | null, max: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > max) return null;
  return Math.round(n);
}

/**
 * Finish an upload.
 *
 * By now the phone has made a web copy and, when Drive is connected, PUT
 * the original there. The copy arrives here — it is small enough to pass
 * through Vercel — and the Drive file id is checked against the folder
 * before either is recorded, so nothing the phone claims is taken on trust.
 */
export async function POST(request: Request) {
  const caller = await photoCaller();
  if (!caller.role) return refuse("signed-out", 401);

  const state = await wallState();
  if (state.paused) return refuse(state.paused === "storage-full" ? "storage-full" : "paused", 503);
  if (!state.uploads && caller.role !== "host") return refuse("closed", 403);

  const uploaderId = await ensureUploaderId();
  if (!(await withinLimits("create", uploaderId))) return refuse("rate-limited", 429);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse("bad-request", 400);
  }

  const web = form.get("web");
  if (!(web instanceof Blob) || !WEB_TYPES.has(web.type)) return refuse("bad-request", 400);
  if (web.size > PHOTO_WEB_MAX_BYTES) return refuse("too-large", 413);

  const width = integer(form.get("width"), PHOTO_MAX_DIMENSION);
  const height = integer(form.get("height"), PHOTO_MAX_DIMENSION);
  if (!width || !height) return refuse("bad-request", 400);

  const uploaderName = String(form.get("uploaderName") ?? "")
    .trim()
    .slice(0, PHOTO_UPLOADER_NAME_MAX);
  const originalName = String(form.get("originalName") ?? "").slice(0, 255) || undefined;
  const originalBytes = integer(form.get("originalBytes"), Number.MAX_SAFE_INTEGER) ?? undefined;

  const claimedDriveId = String(form.get("driveFileId") ?? "").trim();
  /*
   * With Drive as the storage, a photo without an original is not what the
   * hosts were promised — whether a bare client skipped the step or the
   * choice changed under a batch in flight. Refused rather than recorded.
   */
  if ((await getSettings()).photoStorage === "drive" && !claimedDriveId) {
    return refuse("bad-request", 400);
  }
  let driveFileId: string | undefined;
  if (claimedDriveId) {
    if (claimedDriveId.length > 200) return refuse("bad-request", 400);
    try {
      const check = await verifyUploadedFile(claimedDriveId);
      if (!check.ok) return refuse("drive", 400);
      driveFileId = claimedDriveId;
    } catch (error) {
      console.error("Verifying the Drive upload failed", error);
      await recordDriveFailure(error);
      return refuse("paused", 503);
    }
  }

  let webStorageId: Awaited<ReturnType<typeof storeWebCopy>>;
  try {
    webStorageId = await storeWebCopy(web);
  } catch (error) {
    console.error("Storing a web copy failed", error);
    return refuse("failed", 500);
  }

  try {
    const result = await convexClient().mutation(api.photos.create, {
      key: convexKey(),
      uploaderId,
      uploaderName: uploaderName || undefined,
      webStorageId,
      width,
      height,
      driveFileId,
      originalName,
      originalBytes,
    });

    if (!result.ok) {
      return refuse(result.reason === "storage-full" ? "storage-full" : "bad-request", result.reason === "storage-full" ? 503 : 400);
    }
    // Uploads are when the folder gains files; a good moment to tidy it.
    if (driveFileId) await scheduleReconcile();
    return NextResponse.json({ photo: result.photo }, { status: 201 });
  } catch (error) {
    /*
     * The copy is stored but nothing points at it: no row, no place in the
     * meter, nothing a host could delete. Take it back out. A refusal above
     * already did so inside the mutation; this is for the mutation itself
     * not completing.
     */
    console.error("Recording a photo failed", error);
    await discardWebCopy(webStorageId);
    return refuse("failed", 500);
  }
}
