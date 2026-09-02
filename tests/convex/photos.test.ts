// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  PHOTO_DRIVE_INFLIGHT_BUDGET_BYTES,
  PHOTO_STORAGE_CAP_BYTES,
  PHOTO_WEB_MAX_BYTES,
} from "../../convex/limits";

/**
 * The photo functions against a real database.
 *
 * What matters here is who may hide what, and that the counters and stored
 * files stay in step with the rows — the two things that cannot be checked
 * by calling a pure function.
 */

const KEY = "test-server-key";
process.env.ADMIN_API_KEY = KEY;

const modules = import.meta.glob("../../convex/**/*.ts");

function db() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof db>;

/** Put a fake web copy in storage, as the finalize route does. */
async function storeCopy(t: T, bytes = 1000): Promise<Id<"_storage">> {
  return t.run(async (ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)])));
}

async function addPhoto(
  t: T,
  uploaderId: string,
  over: { driveFileId?: string; uploaderName?: string; webStorageId?: Id<"_storage"> } = {}
) {
  const result = await t.mutation(api.photos.create, {
    key: KEY,
    uploaderId,
    webStorageId: over.webStorageId ?? (await storeCopy(t)),
    width: 1600,
    height: 1200,
    ...over,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.photo;
}

async function wall(t: T, filter: "live" | "hidden" | "all", viewerId: string | null) {
  return t.query(api.photos.wall, {
    key: KEY,
    filter,
    viewerId,
    paginationOpts: { numItems: 50, cursor: null },
  });
}

describe("create", () => {
  it("refuses a caller without the server key", async () => {
    const t = db();
    await expect(
      t.mutation(api.photos.create, {
        key: "wrong",
        uploaderId: "dev-a",
        webStorageId: await storeCopy(t),
        width: 10,
        height: 10,
      })
    ).rejects.toThrow(/Not authorized/);
  });

  it("records the stored size and counts the photo as live", async () => {
    const t = db();
    const view = await addPhoto(t, "dev-a", { uploaderName: "  Tía Rosa  " });

    expect(view.status).toBe("live");
    expect(view.mine).toBe(true);
    expect(view.uploaderName).toBe("Tía Rosa");
    expect(view.url).toMatch(/^http/);

    expect(await t.query(api.photos.totals, { key: KEY })).toEqual({ live: 1, hidden: 0, bytes: 1000 });
  });

  it("refuses a web copy over the size limit and throws the file away", async () => {
    const t = db();
    const oversized = await storeCopy(t, PHOTO_WEB_MAX_BYTES + 1);

    const result = await t.mutation(api.photos.create, {
      key: KEY,
      uploaderId: "dev-a",
      webStorageId: oversized,
      width: 10,
      height: 10,
    });

    expect(result).toEqual({ ok: false, reason: "too-large" });
    // Refused by returning, not throwing: a throw would roll the delete back
    // and leave the oversize file in storage for good.
    const stillThere = await t.run(async (ctx) => ctx.storage.getUrl(oversized));
    expect(stillThere).toBeNull();
    expect(await t.query(api.photos.totals, { key: KEY })).toEqual({ live: 0, hidden: 0, bytes: 0 });
  });

  it("refuses dimensions the wall cannot lay out and drops the file", async () => {
    const t = db();
    const copy = await storeCopy(t);
    const result = await t.mutation(api.photos.create, {
      key: KEY,
      uploaderId: "dev-a",
      webStorageId: copy,
      width: 0,
      height: 10,
    });

    expect(result).toEqual({ ok: false, reason: "bad-dimensions" });
    expect(await t.run(async (ctx) => ctx.storage.getUrl(copy))).toBeNull();
  });
});

describe("the storage cap", () => {
  it("refuses a copy that would pass the cap, drops the file, and leaves the totals alone", async () => {
    const t = db();
    // Fill the counter to just under the cap without storing that much.
    await t.run(async (ctx) => {
      await ctx.db.insert("photoTotals", {
        singleton: "photos",
        live: 0,
        hidden: 0,
        bytes: PHOTO_STORAGE_CAP_BYTES - 500,
      });
    });
    const copy = await storeCopy(t, 1000);

    const result = await t.mutation(api.photos.create, {
      key: KEY,
      uploaderId: "dev-a",
      webStorageId: copy,
      width: 10,
      height: 10,
    });

    expect(result).toEqual({ ok: false, reason: "storage-full" });
    expect(await t.run(async (ctx) => ctx.storage.getUrl(copy))).toBeNull();
    expect((await t.query(api.photos.totals, { key: KEY })).bytes).toBe(PHOTO_STORAGE_CAP_BYTES - 500);
  });

  it("still takes a copy that fits exactly", async () => {
    const t = db();
    await t.run(async (ctx) => {
      await ctx.db.insert("photoTotals", {
        singleton: "photos",
        live: 0,
        hidden: 0,
        bytes: PHOTO_STORAGE_CAP_BYTES - 1000,
      });
    });

    const photo = await addPhoto(t, "dev-a");
    expect(photo.status).toBe("live");
    expect((await t.query(api.photos.totals, { key: KEY })).bytes).toBe(PHOTO_STORAGE_CAP_BYTES);
  });

  it("gives the bytes back when a photo is deleted, hidden or not", async () => {
    const t = db();
    const a = await addPhoto(t, "dev-a");
    const b = await addPhoto(t, "dev-a");
    await t.mutation(api.photos.hide, { key: KEY, id: b.id, by: "host", uploaderId: null });
    expect((await t.query(api.photos.totals, { key: KEY })).bytes).toBe(2000);

    await t.mutation(api.photos.remove, { key: KEY, id: a.id });
    await t.mutation(api.photos.remove, { key: KEY, id: b.id });
    expect(await t.query(api.photos.totals, { key: KEY })).toEqual({ live: 0, hidden: 0, bytes: 0 });
  });
});

const MB = 1024 * 1024;

describe("the in-flight budget", () => {
  const opener = (t: T, size: number) =>
    t.mutation(api.photos.openSession, { key: KEY, uploaderId: "dev-a", address: "203.0.113.9", size });

  it("lets a party's uploads through and stops what would pass the budget", async () => {
    const t = db();
    // A room's worth of originals in flight at once, well inside the budget.
    for (let i = 0; i < 100; i++) expect((await opener(t, 5 * MB)).ok).toBe(true);

    // Then one that would tip it over.
    const nearly = PHOTO_DRIVE_INFLIGHT_BUDGET_BYTES - 100 * 5 * MB;
    expect((await opener(t, nearly)).ok).toBe(true);
    expect((await opener(t, 1)).ok).toBe(false);
  });

  /** Record a Drive photo against a session, as the finalize route does. */
  async function recordWith(t: T, sessionId: Id<"driveSessions">, over: Record<string, unknown> = {}) {
    return t.mutation(api.photos.create, {
      key: KEY,
      uploaderId: "dev-a",
      webStorageId: await storeCopy(t),
      width: 10,
      height: 10,
      driveFileId: "drive-1",
      originalBytes: 5 * MB,
      driveCreatedAt: Date.now(),
      sessionId,
      ...over,
    });
  }

  it("gives the bytes back only when the photo is recorded against its own session", async () => {
    const t = db();
    const big = await opener(t, PHOTO_DRIVE_INFLIGHT_BUDGET_BYTES);
    if (!big.ok) throw new Error("expected room");
    expect((await opener(t, 1)).ok).toBe(false);

    const recorded = await recordWith(t, big.sessionId, { originalBytes: 100 });
    expect(recorded.ok).toBe(true);
    expect((await opener(t, 1)).ok).toBe(true);
  });

  it("refuses to consume a session that is another device's, already used, too small, or older than its file", async () => {
    const t = db();
    const session = await opener(t, 5 * MB);
    if (!session.ok) throw new Error("expected room");

    expect(await recordWith(t, session.sessionId, { uploaderId: "dev-b" })).toEqual({ ok: false, reason: "bad-session" });
    expect(await recordWith(t, session.sessionId, { originalBytes: 6 * MB })).toEqual({ ok: false, reason: "bad-session" });
    expect(await recordWith(t, session.sessionId, { driveCreatedAt: Date.now() - 10 * 60 * 1000 })).toEqual({ ok: false, reason: "bad-session" });

    expect((await recordWith(t, session.sessionId)).ok).toBe(true);
    // Used: a second photo cannot ride the same reservation.
    const opened = await opener(t, 5 * MB);
    if (!opened.ok) throw new Error("expected room");
    expect(await recordWith(t, session.sessionId, { driveFileId: "drive-2" })).toEqual({ ok: false, reason: "bad-session" });
    // And one Drive file cannot be recorded twice, whatever session it names.
    expect(await recordWith(t, opened.sessionId, { driveFileId: "drive-1" })).toEqual({ ok: false, reason: "bad-session" });
  });

  it("requires a session at all for a Drive original", async () => {
    const t = db();
    expect(await recordWith(t, undefined as unknown as Id<"driveSessions">, {})).toEqual({ ok: false, reason: "bad-session" });
  });

  it("does not count uploads opened before the window", async () => {
    const t = db();
    await t.run(async (ctx) => {
      await ctx.db.insert("driveSessions", {
        uploaderId: "dev-old",
        address: "x",
        size: PHOTO_DRIVE_INFLIGHT_BUDGET_BYTES,
        openedAt: Date.now() - 2 * 60 * 60 * 1000,
        finalized: false,
      });
    });
    expect((await opener(t, 1)).ok).toBe(true);
  });
});

describe("sweeping stored copies", () => {
  it("claims once per interval", async () => {
    const t = db();
    expect(await t.mutation(api.photos.claimSweep, { key: KEY, intervalMs: 60_000 })).toBe(true);
    expect(await t.mutation(api.photos.claimSweep, { key: KEY, intervalMs: 60_000 })).toBe(false);
    expect(await t.mutation(api.photos.claimSweep, { key: KEY, intervalMs: 0 })).toBe(true);
  });

  it("walks the whole store a page at a time, not the first page over and over", async () => {
    const t = db();
    // Three owned copies first, then an orphan: with a page of two, the
    // orphan is only reached on the second run.
    for (let i = 0; i < 3; i++) await addPhoto(t, "dev-a", { webStorageId: await storeCopy(t) });
    const orphan = await storeCopy(t);

    const first = await t.mutation(api.photos.sweepOrphanCopies, { key: KEY, olderThanMs: -1000, max: 2 });
    expect(first).toEqual({ deleted: 0, done: false });
    const second = await t.mutation(api.photos.sweepOrphanCopies, { key: KEY, olderThanMs: -1000, max: 2 });
    expect(second).toEqual({ deleted: 1, done: true });
    expect(await t.run(async (ctx) => ctx.storage.getUrl(orphan))).toBeNull();
  });

  it("deletes old copies no photo points at, and leaves owned and fresh ones", async () => {
    const t = db();
    const owned = await storeCopy(t);
    await addPhoto(t, "dev-a", { webStorageId: owned });
    const orphan = await storeCopy(t);

    // Nothing is old enough yet.
    expect(await t.mutation(api.photos.sweepOrphanCopies, { key: KEY, olderThanMs: 60_000, max: 100 })).toEqual({ deleted: 0, done: true });
    // With the cutoff a second in the future, only the orphan goes. (Not
    // zero: creation times are nudged forward to stay unique, so a file
    // stored in the same millisecond as the sweep can sit a hair past "now".)
    expect(await t.mutation(api.photos.sweepOrphanCopies, { key: KEY, olderThanMs: -1000, max: 100 })).toEqual({ deleted: 1, done: true });
    expect(await t.run(async (ctx) => ctx.storage.getUrl(orphan))).toBeNull();
    expect(await t.run(async (ctx) => ctx.storage.getUrl(owned))).not.toBeNull();
  });
});

describe("drive health", () => {
  const base = {
    key: KEY,
    account: "host@example.com",
    folderId: "f",
    folderName: "Photos",
    folderUrl: "https://drive.example/f",
    refreshTokenSealed: "sealed",
  };

  it("records a failure with when it started, and keeps that through repeats", async () => {
    const t = db();
    await t.mutation(api.drive.set, base);

    await t.mutation(api.drive.setHealth, { key: KEY, health: "failing", kind: "unavailable", message: "timeout" });
    const first = await t.query(api.drive.get, { key: KEY });
    await t.mutation(api.drive.setHealth, { key: KEY, health: "failing", kind: "unavailable", message: "again" });
    const second = await t.query(api.drive.get, { key: KEY });

    expect(first?.health).toBe("failing");
    expect(second?.failedAt).toBe(first?.failedAt);
    expect(second?.failureMessage).toBe("again");
  });

  it("hands the re-probe to one caller per interval, and never for a revoked grant", async () => {
    const t = db();
    await t.mutation(api.drive.set, base);
    await t.mutation(api.drive.setHealth, { key: KEY, health: "failing", kind: "unavailable" });

    // Recorded just now, so the interval has not passed.
    expect(await t.mutation(api.drive.claimProbe, { key: KEY, intervalMs: 60_000 })).toBe(false);
    // Any interval that has passed: the first claim wins, the next does not.
    expect(await t.mutation(api.drive.claimProbe, { key: KEY, intervalMs: 0 })).toBe(true);
    expect(await t.mutation(api.drive.claimProbe, { key: KEY, intervalMs: 60_000 })).toBe(false);

    await t.mutation(api.drive.setHealth, { key: KEY, health: "failing", kind: "revoked" });
    expect(await t.mutation(api.drive.claimProbe, { key: KEY, intervalMs: 0 })).toBe(false);

    await t.mutation(api.drive.setHealth, { key: KEY, health: "ok" });
    expect(await t.mutation(api.drive.claimProbe, { key: KEY, intervalMs: 0 })).toBe(false);
  });

  it("hands the folder reconcile to one caller per interval", async () => {
    const t = db();
    expect(await t.mutation(api.drive.claimReconcile, { key: KEY, intervalMs: 0 })).toBe(false);
    await t.mutation(api.drive.set, base);
    expect(await t.mutation(api.drive.claimReconcile, { key: KEY, intervalMs: 0 })).toBe(true);
    expect(await t.mutation(api.drive.claimReconcile, { key: KEY, intervalMs: 60_000 })).toBe(false);
  });

  it("says which Drive ids belong to a recorded photo, and refuses more than it will check", async () => {
    const t = db();
    const session = await t.mutation(api.photos.openSession, { key: KEY, uploaderId: "dev-a", address: "x", size: 10 });
    if (!session.ok) throw new Error("expected room");
    await t.mutation(api.photos.create, {
      key: KEY,
      uploaderId: "dev-a",
      webStorageId: await storeCopy(t),
      width: 10,
      height: 10,
      driveFileId: "drive-known",
      originalBytes: 10,
      driveCreatedAt: Date.now(),
      sessionId: session.sessionId,
    });
    const known = await t.query(api.photos.recordedDriveIds, {
      key: KEY,
      ids: ["drive-known", "drive-orphan"],
    });
    expect(known).toEqual(["drive-known"]);

    await expect(
      t.query(api.photos.recordedDriveIds, { key: KEY, ids: Array.from({ length: 501 }, (_, i) => `id${i}`) })
    ).rejects.toThrow(/At most 500/);
  });

  it("keeps the folder cursor between runs and clears it at the end", async () => {
    const t = db();
    await t.mutation(api.drive.set, base);
    await t.mutation(api.drive.setReconcileCursor, { key: KEY, cursor: "page-2" });
    expect((await t.query(api.drive.get, { key: KEY }))?.reconcileCursor).toBe("page-2");
    await t.mutation(api.drive.setReconcileCursor, { key: KEY, cursor: null });
    expect((await t.query(api.drive.get, { key: KEY }))?.reconcileCursor).toBeUndefined();
  });

  it("clears the failure on a healthy answer, and on a reconnect", async () => {
    const t = db();
    await t.mutation(api.drive.set, base);
    await t.mutation(api.drive.setHealth, { key: KEY, health: "failing", kind: "revoked" });

    await t.mutation(api.drive.setHealth, { key: KEY, health: "ok" });
    const healed = await t.query(api.drive.get, { key: KEY });
    expect(healed?.health).toBe("ok");
    expect(healed?.failureKind).toBeUndefined();
    expect(healed?.failedAt).toBeUndefined();

    await t.mutation(api.drive.setHealth, { key: KEY, health: "failing", kind: "revoked" });
    await t.mutation(api.drive.set, { ...base, refreshTokenSealed: "sealed-2" });
    expect((await t.query(api.drive.get, { key: KEY }))?.health).toBeUndefined();
  });
});

describe("wall", () => {
  it("never hands a browser the uploader id", async () => {
    const t = db();
    await addPhoto(t, "dev-secret");

    const page = await wall(t, "live", null);
    expect(JSON.stringify(page)).not.toContain("dev-secret");
  });

  it("answers mine only for the device that uploaded", async () => {
    const t = db();
    await addPhoto(t, "dev-a");
    await addPhoto(t, "dev-b");

    const seenByA = await wall(t, "live", "dev-a");
    expect(seenByA.page.map((p) => p.mine)).toEqual([false, true]);

    const seenByStranger = await wall(t, "live", null);
    expect(seenByStranger.page.every((p) => !p.mine)).toBe(true);
  });

  it("shows guests only live photos, newest first", async () => {
    const t = db();
    const first = await addPhoto(t, "dev-a");
    const second = await addPhoto(t, "dev-a");
    await t.mutation(api.photos.hide, { key: KEY, id: first.id, by: "guest", uploaderId: "dev-a" });

    const page = await wall(t, "live", null);
    expect(page.page.map((p) => p.id)).toEqual([second.id]);
  });

  it("lets a host see hidden photos, and everything at once", async () => {
    const t = db();
    const a = await addPhoto(t, "dev-a");
    const b = await addPhoto(t, "dev-a");
    await t.mutation(api.photos.hide, { key: KEY, id: a.id, by: "guest", uploaderId: "dev-a" });

    const hidden = await wall(t, "hidden", null);
    expect(hidden.page.map((p) => p.id)).toEqual([a.id]);
    expect(hidden.page[0].hiddenBy).toBe("guest");

    const all = await wall(t, "all", null);
    expect(all.page.map((p) => p.id)).toEqual([b.id, a.id]);
  });
});

describe("hide", () => {
  it("refuses a guest who did not upload the photo, and changes nothing", async () => {
    const t = db();
    const photo = await addPhoto(t, "dev-a");

    const result = await t.mutation(api.photos.hide, {
      key: KEY,
      id: photo.id,
      by: "guest",
      uploaderId: "dev-b",
    });

    expect(result.ok).toBe(false);
    expect((await wall(t, "live", null)).page).toHaveLength(1);
    expect(await t.query(api.photos.totals, { key: KEY })).toEqual({ live: 1, hidden: 0, bytes: 1000 });
  });

  it("refuses a guest with no device cookie at all", async () => {
    const t = db();
    const photo = await addPhoto(t, "dev-a");

    const result = await t.mutation(api.photos.hide, {
      key: KEY,
      id: photo.id,
      by: "guest",
      uploaderId: null,
    });

    expect(result.ok).toBe(false);
  });

  it("lets the uploader hide their own photo and moves the counters", async () => {
    const t = db();
    const photo = await addPhoto(t, "dev-a");

    const result = await t.mutation(api.photos.hide, {
      key: KEY,
      id: photo.id,
      by: "guest",
      uploaderId: "dev-a",
    });

    expect(result.ok).toBe(true);
    expect(await t.query(api.photos.totals, { key: KEY })).toEqual({ live: 0, hidden: 1, bytes: 1000 });
  });

  it("lets a host hide anyone's photo", async () => {
    const t = db();
    const photo = await addPhoto(t, "dev-a");

    const result = await t.mutation(api.photos.hide, {
      key: KEY,
      id: photo.id,
      by: "host",
      uploaderId: null,
    });

    expect(result.ok).toBe(true);
    expect((await wall(t, "hidden", null)).page[0].hiddenBy).toBe("host");
  });

  it("hiding twice does not count the photo twice", async () => {
    const t = db();
    const photo = await addPhoto(t, "dev-a");
    const args = { key: KEY, id: photo.id, by: "guest" as const, uploaderId: "dev-a" };

    await t.mutation(api.photos.hide, args);
    await t.mutation(api.photos.hide, args);

    expect(await t.query(api.photos.totals, { key: KEY })).toEqual({ live: 0, hidden: 1, bytes: 1000 });
  });
});

describe("restore", () => {
  it("puts a hidden photo back and undoes the counters", async () => {
    const t = db();
    const photo = await addPhoto(t, "dev-a");
    await t.mutation(api.photos.hide, { key: KEY, id: photo.id, by: "guest", uploaderId: "dev-a" });

    await t.mutation(api.photos.restore, { key: KEY, id: photo.id });

    const live = await wall(t, "live", null);
    expect(live.page.map((p) => p.id)).toEqual([photo.id]);
    expect(live.page[0].hiddenBy).toBeUndefined();
    expect(await t.query(api.photos.totals, { key: KEY })).toEqual({ live: 1, hidden: 0, bytes: 1000 });
  });
});

describe("discard", () => {
  it("deletes a stored copy no photo points at, and leaves one that a photo uses", async () => {
    const t = db();
    const orphan = await storeCopy(t);
    const used = await storeCopy(t);
    await addPhoto(t, "dev-a", { webStorageId: used });

    expect(await t.mutation(api.photos.discard, { key: KEY, storageId: orphan })).toEqual({ deleted: true });
    expect(await t.mutation(api.photos.discard, { key: KEY, storageId: used })).toEqual({ deleted: false });

    expect(await t.run(async (ctx) => ctx.storage.getUrl(orphan))).toBeNull();
    expect(await t.run(async (ctx) => ctx.storage.getUrl(used))).not.toBeNull();
  });
});

describe("remove", () => {
  it("deletes the row and the stored web copy together, and hands back the Drive id", async () => {
    const t = db();
    const storageId = await storeCopy(t);
    const session = await t.mutation(api.photos.openSession, { key: KEY, uploaderId: "dev-a", address: "x", size: 10 });
    if (!session.ok) throw new Error("expected room");
    const created = await t.mutation(api.photos.create, {
      key: KEY,
      uploaderId: "dev-a",
      webStorageId: storageId,
      width: 10,
      height: 10,
      driveFileId: "drive-123",
      originalBytes: 10,
      driveCreatedAt: Date.now(),
      sessionId: session.sessionId,
    });
    if (!created.ok) throw new Error(created.reason);
    const photo = created.photo;

    const result = await t.mutation(api.photos.remove, { key: KEY, id: photo.id });

    expect(result.driveFileId).toBe("drive-123");
    expect((await wall(t, "all", null)).page).toHaveLength(0);
    expect(await t.run(async (ctx) => ctx.storage.getUrl(storageId))).toBeNull();
    expect(await t.query(api.photos.totals, { key: KEY })).toEqual({ live: 0, hidden: 0, bytes: 0 });
  });

  it("takes a hidden photo out of the hidden count, not the live one", async () => {
    const t = db();
    const keep = await addPhoto(t, "dev-a");
    const gone = await addPhoto(t, "dev-a");
    await t.mutation(api.photos.hide, { key: KEY, id: gone.id, by: "host", uploaderId: null });

    await t.mutation(api.photos.remove, { key: KEY, id: gone.id });

    expect(await t.query(api.photos.totals, { key: KEY })).toEqual({ live: 1, hidden: 0, bytes: 1000 });
    expect((await wall(t, "all", null)).page.map((p) => p.id)).toEqual([keep.id]);
  });

  it("is a no-op for a photo that is already gone", async () => {
    const t = db();
    const photo = await addPhoto(t, "dev-a");
    await t.mutation(api.photos.remove, { key: KEY, id: photo.id });

    const again = await t.mutation(api.photos.remove, { key: KEY, id: photo.id });
    expect(again.driveFileId).toBeNull();
    expect(await t.query(api.photos.totals, { key: KEY })).toEqual({ live: 0, hidden: 0, bytes: 0 });
  });
});

describe("drive connection", () => {
  it("stores one connection and replaces it on reconnect", async () => {
    const t = db();
    const base = { key: KEY, folderName: "Photos", folderUrl: "https://drive.example/a" };

    await t.mutation(api.drive.set, {
      ...base,
      account: "first@example.com",
      folderId: "folder-1",
      refreshTokenSealed: "sealed-1",
    });
    await t.mutation(api.drive.set, {
      ...base,
      account: "second@example.com",
      folderId: "folder-2",
      refreshTokenSealed: "sealed-2",
    });

    const row = await t.query(api.drive.get, { key: KEY });
    expect(row?.account).toBe("second@example.com");
    expect(row?.folderId).toBe("folder-2");

    await t.mutation(api.drive.clear, { key: KEY });
    expect(await t.query(api.drive.get, { key: KEY })).toBeNull();
  });
});
