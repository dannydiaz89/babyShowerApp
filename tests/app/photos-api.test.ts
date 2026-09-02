import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { DEFAULT_SETTINGS } from "../../src/lib/defaults";
import { PHOTO_ORIGINAL_MAX_BYTES } from "../../convex/limits";

/**
 * The photo Route Handlers are public POST endpoints outside the middleware
 * gate, exactly like Server Actions. These say that each one checks who is
 * calling for itself: no session gets nothing, a guest cannot hide another
 * device's photo or reach the host-only routes, and the wall being closed
 * closes uploads.
 */

process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.ADMIN_API_KEY = "test-key";
process.env.CONVEX_URL = "https://example.convex.cloud";

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined,
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));

const mutation = vi.fn();
const query = vi.fn();
vi.mock("@/lib/convex", () => ({
  convexClient: () => ({ mutation, query }),
  convexKey: () => "test-key",
}));

let settings: Record<string, unknown>;
vi.mock("@/lib/settings", () => ({ getSettings: async () => settings }));

const openUploadSession = vi.fn();
const verifyUploadedFile = vi.fn();
const deleteFile = vi.fn();
vi.mock("@/lib/google-drive", () => ({
  DriveError: class DriveError extends Error {
    constructor(message: string, public readonly kind = "unavailable") {
      super(message);
    }
  },
  openUploadSession: (...args: unknown[]) => openUploadSession(...args),
  verifyUploadedFile: (...args: unknown[]) => verifyUploadedFile(...args),
  deleteFile: (...args: unknown[]) => deleteFile(...args),
}));

// The web copy upload posts to a Convex URL; nothing here should reach the network.
const fetchMock = vi.fn(async () =>
  new Response(JSON.stringify({ storageId: "storage-1" }), { status: 200 })
);
vi.stubGlobal("fetch", fetchMock);

const { createToken, GUEST_COOKIE, ADMIN_COOKIE } = await import("../../src/lib/auth");
const { UPLOADER_COOKIE } = await import("../../src/lib/photos");
const session = await import("../../src/app/api/photos/session/route");
const photos = await import("../../src/app/api/photos/route");
const one = await import("../../src/app/api/photos/[id]/route");
const hide = await import("../../src/app/api/photos/[id]/hide/route");
const restore = await import("../../src/app/api/photos/[id]/restore/route");

const DEVICE = "0123456789abcdef0123456789abcdef";
const OTHER = "ffffffffffffffffffffffffffffffff";
const BASE = "http://localhost:3001";

function open(mode: "auto" | "open" | "closed") {
  // "closed" is an open wall whose closing time has passed.
  return {
    ...DEFAULT_SETTINGS,
    photoWall: mode === "closed" ? "open" : mode,
    photoWallClosesISO: mode === "closed" ? "2000-01-01T00:00" : "",
    isConfigured: true,
    available: true,
  };
}

function json(path: string, body: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** The mutations this route called, by Convex function name. */
function called(name: string) {
  return mutation.mock.calls.filter(([fn]) => getFunctionName(fn) === name);
}

async function asGuest() {
  cookieJar.set(GUEST_COOKIE, await createToken("guest"));
}

async function asHost() {
  cookieJar.set(ADMIN_COOKIE, await createToken("admin"));
}

beforeEach(() => {
  cookieJar.clear();
  settings = open("open");
  mutation.mockReset();
  query.mockReset();
  openUploadSession.mockReset();
  verifyUploadedFile.mockReset();
  deleteFile.mockReset();
  fetchMock.mockClear();

  mutation.mockImplementation(async (fn: unknown) => {
    switch (getFunctionName(fn as Parameters<typeof getFunctionName>[0])) {
      case "rateLimit:consume":
        return { allowed: true, retryAfterMs: 0 };
      case "photos:generateUploadUrl":
        return "https://example.convex.cloud/upload";
      case "photos:create":
        return { ok: true, photo: { id: "p1" } };
      case "photos:hide":
      case "photos:restore":
        return { ok: true };
      case "photos:remove":
        return { driveFileId: "drive-1" };
      default:
        throw new Error("unexpected mutation");
    }
  });
  query.mockResolvedValue({ page: [], continueCursor: "", isDone: true });
  openUploadSession.mockResolvedValue({ sessionUrl: "https://www.googleapis.com/upload/x" });
  verifyUploadedFile.mockResolvedValue({ ok: true, size: 100 });
  deleteFile.mockResolvedValue(true);
});

const SESSION_BODY = { name: "IMG_1.jpg", type: "image/jpeg", size: 4_000_000 };

describe("POST /api/photos/session", () => {
  it("refuses a caller with no session and opens nothing", async () => {
    const response = await session.POST(json("/api/photos/session", SESSION_BODY));

    expect(response.status).toBe(401);
    expect(openUploadSession).not.toHaveBeenCalled();
    expect(cookieJar.has(UPLOADER_COOKIE)).toBe(false);
  });

  it("refuses a guest while uploads are closed", async () => {
    settings = open("closed");
    await asGuest();

    const response = await session.POST(json("/api/photos/session", SESSION_BODY));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "closed" });
    expect(openUploadSession).not.toHaveBeenCalled();
  });

  it("refuses a guest before the event date in auto mode", async () => {
    settings = { ...open("auto"), startISO: "2999-01-01T14:00" };
    await asGuest();

    const response = await session.POST(json("/api/photos/session", SESSION_BODY));
    expect(response.status).toBe(403);
  });

  it("lets a host upload even while the wall is closed, for a test run", async () => {
    settings = open("closed");
    await asHost();

    const response = await session.POST(json("/api/photos/session", SESSION_BODY));
    expect(response.status).toBe(200);
  });

  it("mints the device cookie on first use and passes the page origin to Drive", async () => {
    await asGuest();

    const response = await session.POST(json("/api/photos/session", SESSION_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionUrl: "https://www.googleapis.com/upload/x" });
    expect(cookieJar.get(UPLOADER_COOKIE)).toMatch(/^[a-f0-9]{32}$/);
    expect(openUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({ name: "IMG_1.jpg", mimeType: "image/jpeg", origin: BASE })
    );
  });

  it("keeps the device cookie it already has", async () => {
    await asGuest();
    cookieJar.set(UPLOADER_COOKIE, DEVICE);

    await session.POST(json("/api/photos/session", SESSION_BODY));
    expect(cookieJar.get(UPLOADER_COOKIE)).toBe(DEVICE);
  });

  it("refuses an original over the size limit", async () => {
    await asGuest();

    const response = await session.POST(
      json("/api/photos/session", { ...SESSION_BODY, size: PHOTO_ORIGINAL_MAX_BYTES + 1 })
    );
    expect(response.status).toBe(413);
    expect(openUploadSession).not.toHaveBeenCalled();
  });

  it("refuses something that is not an image", async () => {
    await asGuest();

    const response = await session.POST(
      json("/api/photos/session", { ...SESSION_BODY, type: "application/pdf" })
    );
    expect(response.status).toBe(400);
  });

  it("answers null when Drive is not connected, so the wall still works", async () => {
    await asGuest();
    openUploadSession.mockResolvedValue(null);

    const response = await session.POST(json("/api/photos/session", SESSION_BODY));
    expect(await response.json()).toEqual({ sessionUrl: null });
  });

  it("stops at the rate limit", async () => {
    await asGuest();
    mutation.mockResolvedValueOnce({ allowed: false, retryAfterMs: 1000 });

    const response = await session.POST(json("/api/photos/session", SESSION_BODY));
    expect(response.status).toBe(429);
  });
});

function finalizeForm(fields: Record<string, string> = {}): Request {
  const form = new FormData();
  form.append("web", new Blob([new Uint8Array(1000)], { type: "image/webp" }), "web.webp");
  form.append("width", "1600");
  form.append("height", "1200");
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request(`${BASE}/api/photos`, { method: "POST", body: form });
}

describe("POST /api/photos", () => {
  it("refuses a caller with no session and stores nothing", async () => {
    const response = await photos.POST(finalizeForm());

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(called("photos:create")).toHaveLength(0);
  });

  it("records the photo under the device cookie", async () => {
    await asGuest();
    cookieJar.set(UPLOADER_COOKIE, DEVICE);

    const response = await photos.POST(finalizeForm({ uploaderName: " Tía Rosa " }));

    expect(response.status).toBe(201);
    const [, args] = called("photos:create")[0];
    expect(args).toMatchObject({
      uploaderId: DEVICE,
      uploaderName: "Tía Rosa",
      webStorageId: "storage-1",
      width: 1600,
      height: 1200,
    });
    expect(args.driveFileId).toBeUndefined();
  });

  it("checks a claimed Drive file against the folder before recording it", async () => {
    await asGuest();
    verifyUploadedFile.mockResolvedValue({ ok: false });

    const response = await photos.POST(finalizeForm({ driveFileId: "made-up" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "drive" });
    expect(called("photos:create")).toHaveLength(0);
  });

  it("keeps a verified Drive id on the row", async () => {
    await asGuest();

    await photos.POST(finalizeForm({ driveFileId: "drive-9" }));

    expect(verifyUploadedFile).toHaveBeenCalledWith("drive-9");
    expect(called("photos:create")[0][1]).toMatchObject({ driveFileId: "drive-9" });
  });

  it("refuses a request with no web copy", async () => {
    await asGuest();
    const form = new FormData();
    form.append("width", "10");
    form.append("height", "10");

    const response = await photos.POST(new Request(`${BASE}/api/photos`, { method: "POST", body: form }));
    expect(response.status).toBe(400);
  });

  it("refuses a guest while uploads are closed", async () => {
    settings = open("closed");
    await asGuest();

    const response = await photos.POST(finalizeForm());
    expect(response.status).toBe(403);
  });
});

describe("GET /api/photos", () => {
  it("shows a guest the live wall whatever filter they ask for", async () => {
    await asGuest();
    cookieJar.set(UPLOADER_COOKIE, DEVICE);

    const response = await photos.GET(new Request(`${BASE}/api/photos?filter=hidden`));

    expect(response.status).toBe(200);
    expect(query.mock.calls[0][1]).toMatchObject({ filter: "live", viewerId: DEVICE });
  });

  it("lets a host ask for hidden photos", async () => {
    await asHost();

    await photos.GET(new Request(`${BASE}/api/photos?filter=hidden`));
    expect(query.mock.calls[0][1]).toMatchObject({ filter: "hidden" });
  });

  it("refuses a caller with no session", async () => {
    const response = await photos.GET(new Request(`${BASE}/api/photos`));
    expect(response.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("hides the wall from guests before it opens", async () => {
    settings = { ...open("auto"), startISO: "2999-01-01T14:00" };
    await asGuest();

    const response = await photos.GET(new Request(`${BASE}/api/photos`));
    expect(response.status).toBe(403);
  });
});

describe("POST /api/photos/:id/hide", () => {
  it("refuses a guest with no device cookie without asking the database", async () => {
    await asGuest();

    const response = await hide.POST(new Request(`${BASE}/api/photos/p1/hide`, { method: "POST" }), params("p1"));

    expect(response.status).toBe(403);
    expect(called("photos:hide")).toHaveLength(0);
  });

  it("hides as the device, and lets the mutation decide ownership", async () => {
    await asGuest();
    cookieJar.set(UPLOADER_COOKIE, DEVICE);

    const response = await hide.POST(new Request(`${BASE}/api/photos/p1/hide`, { method: "POST" }), params("p1"));

    expect(response.status).toBe(200);
    expect(called("photos:hide")[0][1]).toMatchObject({ id: "p1", by: "guest", uploaderId: DEVICE });
  });

  it("turns the mutation's refusal into forbidden", async () => {
    await asGuest();
    cookieJar.set(UPLOADER_COOKIE, OTHER);
    mutation.mockImplementation(async (fn: unknown) =>
      getFunctionName(fn as Parameters<typeof getFunctionName>[0]) === "photos:hide"
        ? { ok: false }
        : { allowed: true, retryAfterMs: 0 }
    );

    const response = await hide.POST(new Request(`${BASE}/api/photos/p1/hide`, { method: "POST" }), params("p1"));
    expect(response.status).toBe(403);
  });

  it("hides as the host without a device cookie", async () => {
    await asHost();

    const response = await hide.POST(new Request(`${BASE}/api/photos/p1/hide`, { method: "POST" }), params("p1"));

    expect(response.status).toBe(200);
    expect(called("photos:hide")[0][1]).toMatchObject({ by: "host", uploaderId: null });
  });

  it("refuses an id that could not be a Convex id", async () => {
    await asHost();
    const response = await hide.POST(new Request(`${BASE}/api/photos/x/hide`, { method: "POST" }), params("../x"));
    expect(response.status).toBe(404);
  });
});

describe("host-only routes", () => {
  it("restore refuses a guest, even one with a device cookie", async () => {
    await asGuest();
    cookieJar.set(UPLOADER_COOKIE, DEVICE);

    const response = await restore.POST(new Request(`${BASE}/api/photos/p1/restore`, { method: "POST" }), params("p1"));

    expect(response.status).toBe(403);
    expect(called("photos:restore")).toHaveLength(0);
  });

  it("restore works for a host", async () => {
    await asHost();
    const response = await restore.POST(new Request(`${BASE}/api/photos/p1/restore`, { method: "POST" }), params("p1"));
    expect(response.status).toBe(200);
  });

  it("delete refuses a guest and touches nothing", async () => {
    await asGuest();
    cookieJar.set(UPLOADER_COOKIE, DEVICE);

    const response = await one.DELETE(new Request(`${BASE}/api/photos/p1`, { method: "DELETE" }), params("p1"));

    expect(response.status).toBe(403);
    expect(called("photos:remove")).toHaveLength(0);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("delete refuses nobody-in-particular with signed-out, not forbidden", async () => {
    const response = await one.DELETE(new Request(`${BASE}/api/photos/p1`, { method: "DELETE" }), params("p1"));
    expect(response.status).toBe(401);
  });

  it("delete removes the row first, then the Drive original it named", async () => {
    await asHost();

    const response = await one.DELETE(new Request(`${BASE}/api/photos/p1`, { method: "DELETE" }), params("p1"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, driveDeleted: true });
    expect(called("photos:remove")[0][1]).toMatchObject({ id: "p1" });
    expect(deleteFile).toHaveBeenCalledWith("drive-1");
  });

  it("delete still succeeds when the Drive original cannot be removed, and says so", async () => {
    await asHost();
    deleteFile.mockRejectedValue(new Error("Google is down"));

    const response = await one.DELETE(new Request(`${BASE}/api/photos/p1`, { method: "DELETE" }), params("p1"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, driveDeleted: false });
  });

  it("delete skips Drive for a photo that had no original there", async () => {
    await asHost();
    mutation.mockImplementation(async () => ({ driveFileId: null }));

    const response = await one.DELETE(new Request(`${BASE}/api/photos/p1`, { method: "DELETE" }), params("p1"));

    expect(await response.json()).toEqual({ ok: true, driveDeleted: null });
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
