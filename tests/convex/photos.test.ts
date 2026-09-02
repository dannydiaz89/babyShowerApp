// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PHOTO_STORAGE_CAP_BYTES, PHOTO_WEB_MAX_BYTES } from "../../convex/limits";

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
    const photo = await addPhoto(t, "dev-a", { webStorageId: storageId, driveFileId: "drive-123" });

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
