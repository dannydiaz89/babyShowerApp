import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reconcile run against a mocked Google and a mocked Convex.
 *
 * The one thing this must never do is delete a recorded original. With
 * more files than one lookup batch, an id the lookup never checked would
 * read as unrecorded — which is exactly the case that once deleted real
 * photos, so it is the case pinned here: fifteen hundred files, every one
 * recorded, and not a single DELETE.
 */

process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.ADMIN_API_KEY = "test-key";
process.env.CONVEX_URL = "https://example.convex.cloud";
process.env.GOOGLE_CLIENT_ID = "client";
process.env.GOOGLE_CLIENT_SECRET = "secret";

const mutation = vi.fn();
const query = vi.fn();
vi.mock("@/lib/convex", () => ({
  convexClient: () => ({ mutation, query }),
  convexKey: () => "test-key",
}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

const { seal } = await import("../../src/lib/seal");
const { getFunctionName } = await import("convex/server");
const { reconcileDriveFolder } = await import("../../src/lib/google-drive");

const FOLDER = "folder-1";
const requests: { method: string; url: string }[] = [];
let folder: { id: string; createdTime: string }[] = [];
let recordedIds: Set<string> = new Set();
let savedCursor: string | null = null;
let rejectTokens = false;

beforeEach(async () => {
  requests.length = 0;
  savedCursor = null;
  rejectTokens = false;
  mutation.mockReset();
  query.mockReset();

  mutation.mockImplementation(async (fn: unknown) => {
    switch (getFunctionName(fn as Parameters<typeof getFunctionName>[0])) {
      case "drive:setReconcileCursor":
      case "drive:setHealth":
        return null;
      default:
        throw new Error("unexpected mutation");
    }
  });
  query.mockImplementation(async (fn: unknown, args: Record<string, unknown>) => {
    switch (getFunctionName(fn as Parameters<typeof getFunctionName>[0])) {
      case "drive:get":
        return {
          account: "host@example.com",
          folderId: FOLDER,
          folderName: "Photos",
          folderUrl: "https://drive.example",
          connectedAt: 0,
          reconcileCursor: savedCursor ?? undefined,
          refreshTokenSealed: await seal("refresh-token", process.env.AUTH_SECRET!),
        };
      case "photos:recordedDriveIds": {
        const ids = args.ids as string[];
        // The real query refuses more than its batch; mirror that here.
        if (ids.length > 500) throw new Error(`At most 500 ids per call.`);
        return ids.filter((id) => recordedIds.has(id));
      }
      default:
        throw new Error("unexpected query");
    }
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ method, url });
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
      }
      if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
        const params = new URL(url).searchParams;
        if (rejectTokens && params.get("pageToken")) {
          return new Response(JSON.stringify({ error: { message: "Invalid Value" } }), { status: 400 });
        }
        const start = Number(params.get("pageToken") ?? 0);
        const page = folder.slice(start, start + 1000);
        const next = start + 1000 < folder.length ? String(start + 1000) : undefined;
        return new Response(JSON.stringify({ files: page, nextPageToken: next }), { status: 200 });
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      return new Response("not found", { status: 404 });
    })
  );
});

const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

describe("reconcileDriveFolder", () => {
  it("deletes nothing when every file in a large folder is recorded", async () => {
    folder = Array.from({ length: 1500 }, (_, i) => ({ id: `f${i}`, createdTime: old }));
    recordedIds = new Set(folder.map((f) => f.id));

    const result = await reconcileDriveFolder();

    expect(result).toEqual({ deleted: 0, done: true });
    expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(0);
    // Every id was checked, in batches the query accepts.
    const checked = query.mock.calls
      .filter(([fn]) => getFunctionName(fn) === "photos:recordedDriveIds")
      .flatMap(([, args]) => args.ids as string[]);
    expect(new Set(checked).size).toBe(1500);
  });

  it("deletes only the unrecorded old files, wherever in the folder they sit", async () => {
    folder = Array.from({ length: 1500 }, (_, i) => ({ id: `f${i}`, createdTime: old }));
    recordedIds = new Set(folder.map((f) => f.id).filter((id) => id !== "f3" && id !== "f1400"));

    const result = await reconcileDriveFolder();

    expect(result.deleted).toBe(2);
    const deleted = requests.filter((r) => r.method === "DELETE").map((r) => r.url);
    expect(deleted.some((u) => u.endsWith("/files/f3"))).toBe(true);
    expect(deleted.some((u) => u.endsWith("/files/f1400"))).toBe(true);
  });

  it("keeps the page token it stops on, so the next run continues rather than restarting", async () => {
    // More pages than one run reads.
    folder = Array.from({ length: 7000 }, (_, i) => ({ id: `f${i}`, createdTime: old }));
    recordedIds = new Set(folder.map((f) => f.id));

    const result = await reconcileDriveFolder();

    expect(result.done).toBe(false);
    const cursorCalls = mutation.mock.calls.filter(([fn]) => getFunctionName(fn) === "drive:setReconcileCursor");
    expect(cursorCalls.at(-1)?.[1]).toMatchObject({ cursor: "5000" });
    // Saved after every page, not only at the end.
    expect(cursorCalls.length).toBe(5);
  });

  it("stops at its delete budget, keeps the unfinished page, and resumes it next run", async () => {
    // 300 orphans on the first page: over one run's budget of 200.
    folder = Array.from({ length: 1500 }, (_, i) => ({ id: `f${i}`, createdTime: old }));
    recordedIds = new Set(folder.map((f) => f.id).filter((_, i) => i >= 300));

    const first = await reconcileDriveFolder();
    expect(first).toEqual({ deleted: 200, done: false });
    const cursorCalls = mutation.mock.calls.filter(([fn]) => getFunctionName(fn) === "drive:setReconcileCursor");
    // The page it did not finish is the one it comes back to: the first, cursor null.
    expect(cursorCalls.at(-1)?.[1]).toMatchObject({ cursor: null });
  });

  it("throws away a rejected page token and starts the folder over, once", async () => {
    folder = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, createdTime: old }));
    recordedIds = new Set(folder.map((f) => f.id));
    savedCursor = "stale-token";
    rejectTokens = true;

    const result = await reconcileDriveFolder();

    expect(result).toEqual({ deleted: 0, done: true });
    const listings = requests.filter((r) => r.method === "GET" && r.url.includes("/files?"));
    expect(listings[0].url).toContain("pageToken=stale-token");
    expect(listings[1].url).not.toContain("pageToken");
    // No Drive failure was recorded for a stale token: that is not an outage.
    expect(mutation.mock.calls.some(([fn]) => getFunctionName(fn) === "drive:setHealth")).toBe(false);
  });
});
