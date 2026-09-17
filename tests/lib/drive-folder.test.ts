import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finding the photo folder rather than making another one.
 *
 * `drive.file` lets the site see only what it created, so both lookups are
 * safe by construction — they cannot reach a folder of the hosts' own. What
 * they have to get right is narrower: a folder in the bin is not a folder to
 * put photos in, a failed lookup must fall through to creating one rather
 * than taking the whole connect down with it, and a name with an apostrophe
 * in it must not break the query it is interpolated into.
 */

process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.ADMIN_API_KEY = "test-key";
process.env.CONVEX_URL = "https://example.convex.cloud";

vi.mock("@/lib/convex", () => ({
  convexClient: () => ({ mutation: vi.fn(), query: vi.fn() }),
  convexKey: () => "test-key",
}));

const { existingFolder, findFolder } = await import("../../src/lib/google-drive");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

/** One Drive answer. */
function answer(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 404,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** The URL the last call went to, decoded. */
function calledUrl(): string {
  return decodeURIComponent(String(fetchMock.mock.calls.at(-1)?.[0]));
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("existingFolder", () => {
  it("returns the folder this connection was already using", async () => {
    fetchMock.mockResolvedValue(
      answer({ id: "folder-1", name: "Baby — photo wall — 2026-11-07", webViewLink: "https://drive.example/1" })
    );

    expect(await existingFolder("token", "folder-1")).toEqual({
      id: "folder-1",
      name: "Baby — photo wall — 2026-11-07",
      url: "https://drive.example/1",
    });
  });

  it("refuses a folder the hosts put in the bin", async () => {
    // Reusing it would file the shower's originals in the rubbish.
    fetchMock.mockResolvedValue(answer({ id: "folder-1", name: "gone", trashed: true }));

    expect(await existingFolder("token", "folder-1")).toBeNull();
  });

  it("is null when there is no previous folder to reuse", async () => {
    expect(await existingFolder("token", undefined)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is null when Google says it is gone, or will not say at all", async () => {
    fetchMock.mockResolvedValue(answer({}, false));
    expect(await existingFolder("token", "folder-1")).toBeNull();

    fetchMock.mockRejectedValue(new Error("network"));
    expect(await existingFolder("token", "folder-1")).toBeNull();
  });
});

describe("findFolder", () => {
  it("asks only for folders, and only ones not in the bin", async () => {
    fetchMock.mockResolvedValue(answer({ files: [] }));
    await findFolder("token", "Baby — photo wall — 2026-11-07");

    const url = calledUrl();
    expect(url).toContain("name = 'Baby — photo wall — 2026-11-07'");
    expect(url).toContain("mimeType = 'application/vnd.google-apps.folder'");
    expect(url).toContain("trashed = false");
  });

  it("escapes a quote in the name instead of breaking the query", async () => {
    // "Baby O'Brien" is a name a host can type into Settings.
    fetchMock.mockResolvedValue(answer({ files: [] }));
    await findFolder("token", "Baby O'Brien — photo wall");

    expect(calledUrl()).toContain("name = 'Baby O\\'Brien — photo wall'");
  });

  it("returns the first match", async () => {
    fetchMock.mockResolvedValue(
      answer({ files: [{ id: "folder-2", name: "Baby — photo wall", webViewLink: "https://drive.example/2" }] })
    );

    expect(await findFolder("token", "Baby — photo wall")).toEqual({
      id: "folder-2",
      name: "Baby — photo wall",
      url: "https://drive.example/2",
    });
  });

  it("is null when nothing matches, so the caller makes one", async () => {
    fetchMock.mockResolvedValue(answer({ files: [] }));
    expect(await findFolder("token", "Baby — photo wall")).toBeNull();
  });

  it("is null when the lookup itself fails, rather than failing the connect", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    expect(await findFolder("token", "Baby — photo wall")).toBeNull();
  });
});
