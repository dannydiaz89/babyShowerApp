import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { assertServer } from "./guard";
import {
  PHOTO_DRIVE_INFLIGHT_BUDGET_BYTES,
  PHOTO_DRIVE_INFLIGHT_WINDOW_MS,
  PHOTO_MAX_DIMENSION,
  PHOTO_STORAGE_CAP_BYTES,
  PHOTO_UPLOADER_NAME_MAX,
  PHOTO_WEB_MAX_BYTES,
} from "./limits";

/*
 * Guest photos. Every function here takes the server key: the browser never
 * calls Convex, so who may do what — a guest hiding their own photo, a host
 * deleting anyone's — is decided by the Next.js route that calls in, and the
 * mutations only enforce the invariants that must hold whoever the caller is.
 */

const status = v.union(v.literal("live"), v.literal("hidden"));
const hiddenBy = v.union(v.literal("guest"), v.literal("host"));

/**
 * What a browser is allowed to know about a photo.
 *
 * Deliberately not `schema.doc("photos")`: that carries `uploaderId`, the
 * device cookie that authorises hiding, and handing it out would let one
 * guest hide another's photos. Ownership is answered as `mine` instead.
 */
export const photoView = v.object({
  id: v.id("photos"),
  url: v.string(),
  width: v.number(),
  height: v.number(),
  uploaderName: v.optional(v.string()),
  status,
  hiddenBy: v.optional(hiddenBy),
  hiddenAt: v.optional(v.number()),
  createdAt: v.number(),
  originalBytes: v.optional(v.number()),
  inDrive: v.boolean(),
  mine: v.boolean(),
});

export type PhotoView = {
  id: Id<"photos">;
  url: string;
  width: number;
  height: number;
  uploaderName?: string;
  status: "live" | "hidden";
  hiddenBy?: "guest" | "host";
  hiddenAt?: number;
  createdAt: number;
  originalBytes?: number;
  inDrive: boolean;
  mine: boolean;
};

const filter = v.union(v.literal("live"), v.literal("hidden"), v.literal("all"));
export type WallFilter = "live" | "hidden" | "all";

const totalsValidator = v.object({
  live: v.number(),
  hidden: v.number(),
  /** Web-copy bytes in the site's storage, live and hidden together. */
  bytes: v.number(),
});
export type PhotoTotals = { live: number; hidden: number; bytes: number };

/* ------------------------------------------------------------------ totals */

async function totalsRow(ctx: QueryCtx) {
  return ctx.db
    .query("photoTotals")
    .withIndex("by_singleton", (q) => q.eq("singleton", "photos"))
    .unique();
}

/**
 * Move the counters, in the same transaction as the write they describe.
 *
 * Unlike the RSVP totals there is no rebuild: the table did not exist before
 * the counters did, so a missing row simply means no photo has been added
 * yet, and it is created from zero.
 */
async function adjustTotals(
  ctx: MutationCtx,
  delta: { live?: number; hidden?: number; bytes?: number }
): Promise<void> {
  const existing = await totalsRow(ctx);
  const live = Math.max(0, (existing?.live ?? 0) + (delta.live ?? 0));
  const hidden = Math.max(0, (existing?.hidden ?? 0) + (delta.hidden ?? 0));
  const bytes = Math.max(0, (existing?.bytes ?? 0) + (delta.bytes ?? 0));

  if (existing) await ctx.db.patch(existing._id, { live, hidden, bytes });
  else await ctx.db.insert("photoTotals", { singleton: "photos", live, hidden, bytes });
}

/* -------------------------------------------------------------------- view */

async function toView(
  ctx: QueryCtx,
  photo: Doc<"photos">,
  viewerId: string | null
): Promise<PhotoView | null> {
  /*
   * The URL is what the wall actually loads, and it is the one thing tying
   * the page to where web copies live. Moving them to S3 later means
   * changing this line and the upload side, and nothing the browser sees.
   */
  const url = await ctx.storage.getUrl(photo.webStorageId);
  if (!url) return null;

  return {
    id: photo._id,
    url,
    width: photo.width,
    height: photo.height,
    uploaderName: photo.uploaderName,
    status: photo.status,
    hiddenBy: photo.hiddenBy,
    hiddenAt: photo.hiddenAt,
    createdAt: photo._creationTime,
    originalBytes: photo.originalBytes,
    inDrive: photo.driveFileId !== undefined,
    mine: viewerId !== null && photo.uploaderId === viewerId,
  };
}

/* --------------------------------------------------------------- functions */

/** Where the Next.js server posts a web copy. Short-lived, single use. */
export const generateUploadUrl = mutation({
  args: { key: v.string() },
  returns: v.string(),
  handler: async (ctx, { key }) => {
    assertServer(key);
    return ctx.storage.generateUploadUrl();
  },
});

const createResult = v.union(
  v.object({ ok: v.literal(true), photo: photoView }),
  v.object({
    ok: v.literal(false),
    reason: v.union(
      v.literal("not-uploaded"),
      v.literal("too-large"),
      v.literal("bad-dimensions"),
      v.literal("storage-full"),
      v.literal("bad-session")
    ),
  })
);

/**
 * Record a photo once its web copy is in storage.
 *
 * The stored file is checked here rather than trusted from the caller: the
 * size on the row is what the wall header adds up, and a copy past the
 * limit is refused so a bad client cannot fill storage one oversize file at
 * a time.
 *
 * A refusal is returned, not thrown. A mutation that throws rolls back
 * everything it did — including deleting the offending file — and the whole
 * point of refusing is that the file does not stay.
 */
export const create = mutation({
  args: {
    key: v.string(),
    uploaderId: v.string(),
    uploaderName: v.optional(v.string()),
    webStorageId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
    driveFileId: v.optional(v.string()),
    originalName: v.optional(v.string()),
    originalBytes: v.optional(v.number()),
    /** The in-flight reservation this original came through. Required with a Drive id. */
    sessionId: v.optional(v.id("driveSessions")),
    /** When Google says the file was created, so it can be tied to the session. */
    driveCreatedAt: v.optional(v.number()),
  },
  returns: createResult,
  handler: async (ctx, { key, ...args }) => {
    assertServer(key);

    /*
     * With a Drive original, the reservation is consumed here, in the same
     * transaction as the row. It must be this device's, still open, big
     * enough for the file Google reports, and older than that file — so a
     * reservation cannot be released against some other upload, and one
     * Drive file cannot be recorded twice to release two.
     */
    if (args.driveFileId) {
      const bad = { ok: false as const, reason: "bad-session" as const };
      if (!args.sessionId) return bad;
      const session = await ctx.db.get(args.sessionId);
      if (!session || session.finalized || session.uploaderId !== args.uploaderId) return bad;
      if ((args.originalBytes ?? 0) > session.size) return bad;
      if (args.driveCreatedAt !== undefined && args.driveCreatedAt < session.openedAt - 60_000) return bad;
      const already = await ctx.db
        .query("photos")
        .withIndex("by_driveFileId", (q) => q.eq("driveFileId", args.driveFileId))
        .first();
      if (already) return bad;
    }

    const file = await ctx.db.system.get("_storage", args.webStorageId);
    if (!file) return { ok: false as const, reason: "not-uploaded" as const };
    if (file.size > PHOTO_WEB_MAX_BYTES) {
      await ctx.storage.delete(args.webStorageId);
      return { ok: false as const, reason: "too-large" as const };
    }

    /*
     * The storage cap, checked here where the row and the counter change
     * together: two uploads racing past it on the route side would both
     * be let through, but this runs in a transaction and only one wins.
     */
    const totals = await totalsRow(ctx);
    if ((totals?.bytes ?? 0) + file.size > PHOTO_STORAGE_CAP_BYTES) {
      await ctx.storage.delete(args.webStorageId);
      return { ok: false as const, reason: "storage-full" as const };
    }

    const width = Math.round(args.width);
    const height = Math.round(args.height);
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 1 ||
      height < 1 ||
      width > PHOTO_MAX_DIMENSION ||
      height > PHOTO_MAX_DIMENSION
    ) {
      await ctx.storage.delete(args.webStorageId);
      return { ok: false as const, reason: "bad-dimensions" as const };
    }

    const uploaderName = args.uploaderName?.trim().slice(0, PHOTO_UPLOADER_NAME_MAX);

    const id = await ctx.db.insert("photos", {
      status: "live",
      uploaderId: args.uploaderId,
      uploaderName: uploaderName || undefined,
      webStorageId: args.webStorageId,
      width,
      height,
      webBytes: file.size,
      driveFileId: args.driveFileId,
      originalName: args.originalName?.slice(0, 255),
      originalBytes: args.originalBytes,
    });
    await adjustTotals(ctx, { live: 1, bytes: file.size });
    if (args.sessionId) await ctx.db.delete(args.sessionId);

    const view = await toView(ctx, (await ctx.db.get(id))!, args.uploaderId);
    if (!view) throw new Error("The photo could not be read back.");
    return { ok: true as const, photo: view };
  },
});

/**
 * One page of the wall, newest first.
 *
 * Guests get `live`; the hosts choose. Each filter walks one index range —
 * `by_status` for a single status, creation time for everything — so no page
 * reads rows it does not return. `viewerId` is the caller's device cookie
 * and only ever decides the `mine` flag.
 */
export const wall = query({
  args: {
    key: v.string(),
    paginationOpts: paginationOptsValidator,
    filter,
    viewerId: v.union(v.string(), v.null()),
  },
  returns: paginationResultValidator(photoView),
  handler: async (ctx, { key, paginationOpts, filter, viewerId }) => {
    assertServer(key);

    const result =
      filter === "all"
        ? await ctx.db.query("photos").order("desc").paginate(paginationOpts)
        : await ctx.db
            .query("photos")
            .withIndex("by_status", (q) => q.eq("status", filter))
            .order("desc")
            .paginate(paginationOpts);

    const page: PhotoView[] = [];
    for (const photo of result.page) {
      const view = await toView(ctx, photo, viewerId);
      if (view) page.push(view);
    }

    return { ...result, page };
  },
});

/**
 * Remove a stored web copy that no photo row points at.
 *
 * For the route's failure path: the copy went into storage and then the
 * record did not happen. Checked against the rows first, so a retry that
 * races a success can never delete a copy a photo is using.
 */
export const discard = mutation({
  args: { key: v.string(), storageId: v.id("_storage") },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, { key, storageId }) => {
    assertServer(key);
    const inUse = await ctx.db
      .query("photos")
      .withIndex("by_webStorageId", (q) => q.eq("webStorageId", storageId))
      .first();
    if (inUse) return { deleted: false };
    await ctx.storage.delete(storageId);
    return { deleted: true };
  },
});

/**
 * Which of these Drive file ids belong to a recorded photo.
 *
 * For reconciling the folder: the caller lists what is in Drive and asks
 * here what is accounted for; the rest is nobody's. One index read per id,
 * bounded by the caller's page size.
 */
export const RECORDED_IDS_BATCH = 500;

export const recordedDriveIds = query({
  args: { key: v.string(), ids: v.array(v.string()) },
  returns: v.array(v.string()),
  handler: async (ctx, { key, ids }) => {
    assertServer(key);
    // Refused, not trimmed: an id this did not check would read as unrecorded
    // to the caller, and unrecorded is what gets deleted.
    if (ids.length > RECORDED_IDS_BATCH) throw new Error(`At most ${RECORDED_IDS_BATCH} ids per call.`);
    const known: string[] = [];
    for (const id of ids) {
      const row = await ctx.db
        .query("photos")
        .withIndex("by_driveFileId", (q) => q.eq("driveFileId", id))
        .first();
      if (row) known.push(id);
    }
    return known;
  },
});

/* -------------------------------------------------------- drive sessions */

/**
 * Reserve room in the in-flight budget for one original, or refuse.
 *
 * Summed over the recent window, unrecorded only, inside the transaction,
 * so two openers racing past the budget cannot both get through. Rows well
 * past the window are dropped a few at a time here, so the table stays
 * the size of one busy hour.
 */
export const openSession = mutation({
  args: { key: v.string(), uploaderId: v.string(), address: v.string(), size: v.number() },
  returns: v.union(
    v.object({ ok: v.literal(true), sessionId: v.id("driveSessions") }),
    v.object({ ok: v.literal(false) })
  ),
  handler: async (ctx, { key, uploaderId, address, size }) => {
    assertServer(key);
    const now = Date.now();
    const since = now - PHOTO_DRIVE_INFLIGHT_WINDOW_MS;

    const open = await ctx.db
      .query("driveSessions")
      .withIndex("by_finalized_openedAt", (q) => q.eq("finalized", false).gte("openedAt", since))
      .take(5000);
    const inFlight = open.reduce((sum, s) => sum + s.size, 0);
    if (inFlight + size > PHOTO_DRIVE_INFLIGHT_BUDGET_BYTES) return { ok: false as const };

    // Tidy a few rows that are long past mattering.
    const stale = await ctx.db
      .query("driveSessions")
      .withIndex("by_finalized_openedAt", (q) =>
        q.eq("finalized", false).lt("openedAt", since - PHOTO_DRIVE_INFLIGHT_WINDOW_MS)
      )
      .take(20);
    for (const row of stale) await ctx.db.delete(row._id);

    const sessionId = await ctx.db.insert("driveSessions", {
      uploaderId,
      address,
      size,
      openedAt: now,
      finalized: false,
    });
    return { ok: true as const, sessionId };
  },
});

/* ----------------------------------------------------------- sweeping */

/**
 * Claim the right to sweep stored copies, at most once per interval.
 * Lives on the totals row so it works whichever storage the hosts chose.
 */
export const claimSweep = mutation({
  args: { key: v.string(), intervalMs: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { key, intervalMs }) => {
    assertServer(key);
    const now = Date.now();
    const existing = await totalsRow(ctx);
    if (existing) {
      if (now - (existing.lastSweptAt ?? 0) < intervalMs) return false;
      await ctx.db.patch(existing._id, { lastSweptAt: now });
    } else {
      await ctx.db.insert("photoTotals", { singleton: "photos", live: 0, hidden: 0, bytes: 0, lastSweptAt: now });
    }
    return true;
  },
});

/**
 * Delete stored copies that no photo points at and that are old enough
 * not to be an upload still being recorded.
 *
 * The route discards a copy at once when its record fails; this is for
 * the case where that discard could not happen either — an outage that
 * took both — so nothing in storage stays unowned for good. Oldest first,
 * a bounded page per run.
 */
export const sweepOrphanCopies = mutation({
  args: { key: v.string(), olderThanMs: v.number(), max: v.number() },
  returns: v.object({ deleted: v.number(), done: v.boolean() }),
  handler: async (ctx, { key, olderThanMs, max }) => {
    assertServer(key);
    const cutoff = Date.now() - olderThanMs;

    /*
     * One page per run, continuing where the last run stopped, so a store
     * whose first page is all owned files still has its later pages looked
     * at. The cursor lives on the totals row; a finished walk clears it and
     * the next run starts over.
     */
    const totals = await totalsRow(ctx);
    const page = await ctx.db.system
      .query("_storage")
      .paginate({ numItems: Math.min(max, 500), cursor: totals?.sweepCursor ?? null });

    let deleted = 0;
    for (const file of page.page) {
      if (file._creationTime > cutoff) continue;
      const owner = await ctx.db
        .query("photos")
        .withIndex("by_webStorageId", (q) => q.eq("webStorageId", file._id))
        .first();
      if (owner) continue;
      await ctx.storage.delete(file._id);
      deleted += 1;
    }

    const next = page.isDone ? undefined : page.continueCursor;
    if (totals) await ctx.db.patch(totals._id, { sweepCursor: next });
    else await ctx.db.insert("photoTotals", { singleton: "photos", live: 0, hidden: 0, bytes: 0, sweepCursor: next });
    return { deleted, done: page.isDone };
  },
});

export const totals = query({
  args: { key: v.string() },
  returns: totalsValidator,
  handler: async (ctx, { key }) => {
    assertServer(key);
    const row = await totalsRow(ctx);
    return { live: row?.live ?? 0, hidden: row?.hidden ?? 0, bytes: row?.bytes ?? 0 };
  },
});

/**
 * Take a photo off the wall without deleting it.
 *
 * A guest may only hide what their own device added; the check is here, on
 * the row, rather than in the route, so no caller can skip it. A host may
 * hide anything. Answers `false` rather than throwing on a mismatch — the
 * route turns that into a message, and a thrown error would say nothing
 * more useful.
 */
export const hide = mutation({
  args: {
    key: v.string(),
    id: v.id("photos"),
    by: hiddenBy,
    uploaderId: v.union(v.string(), v.null()),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { key, id, by, uploaderId }) => {
    assertServer(key);

    const photo = await ctx.db.get(id);
    if (!photo) return { ok: false };

    if (by === "guest" && (uploaderId === null || photo.uploaderId !== uploaderId)) {
      return { ok: false };
    }

    // Already hidden: nothing to move, and re-hiding is not an error.
    if (photo.status === "hidden") return { ok: true };

    await ctx.db.patch(id, { status: "hidden", hiddenAt: Date.now(), hiddenBy: by });
    await adjustTotals(ctx, { live: -1, hidden: 1 });
    return { ok: true };
  },
});

/** Host: put a hidden photo back on the wall. */
export const restore = mutation({
  args: { key: v.string(), id: v.id("photos") },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { key, id }) => {
    assertServer(key);

    const photo = await ctx.db.get(id);
    if (!photo) return { ok: false };
    if (photo.status === "live") return { ok: true };

    await ctx.db.patch(id, { status: "live", hiddenAt: undefined, hiddenBy: undefined });
    await adjustTotals(ctx, { live: 1, hidden: -1 });
    return { ok: true };
  },
});

/**
 * Host: delete a photo for good.
 *
 * The row and the web copy go together, in this one transaction, so the wall
 * can never show a photo whose image is gone or keep an image no row points
 * to. The Drive original is outside Convex; its id is handed back so the
 * caller can delete it next, and a failure there leaves at worst an extra
 * file in a folder the hosts can see.
 */
export const remove = mutation({
  args: { key: v.string(), id: v.id("photos") },
  returns: v.object({ driveFileId: v.union(v.string(), v.null()) }),
  handler: async (ctx, { key, id }) => {
    assertServer(key);

    const photo = await ctx.db.get(id);
    if (!photo) return { driveFileId: null };

    await ctx.storage.delete(photo.webStorageId);
    await ctx.db.delete(id);
    await adjustTotals(ctx, {
      ...(photo.status === "live" ? { live: -1 } : { hidden: -1 }),
      bytes: -photo.webBytes,
    });

    return { driveFileId: photo.driveFileId ?? null };
  },
});
