import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cron's endpoint. It runs deletes against the hosts' Drive and the
 * site's storage, so the only caller it may answer is one holding the
 * server key.
 */

process.env.ADMIN_API_KEY = "test-key";
process.env.CONVEX_URL = "https://example.convex.cloud";

const sweepStoredCopies = vi.fn(async () => ({ deleted: 0, done: true }));
const reconcileDriveFolder = vi.fn(async () => ({ deleted: 0, done: true }));
vi.mock("@/lib/photos", () => ({ sweepStoredCopies: () => sweepStoredCopies() }));
vi.mock("@/lib/google-drive", () => ({
  googleConfigured: () => true,
  getDriveConnection: async () => ({ account: "a" }),
  reconcileDriveFolder: () => reconcileDriveFolder(),
}));
let storage = "site";
vi.mock("@/lib/settings", () => ({ getSettings: async () => ({ photoStorage: storage }) }));

const { POST } = await import("../../src/app/api/photos/tidy/route");

function request(auth?: string): Request {
  return new Request("http://localhost:3001/api/photos/tidy", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  sweepStoredCopies.mockClear();
  reconcileDriveFolder.mockClear();
  storage = "site";
});

describe("POST /api/photos/tidy", () => {
  it("refuses a caller without the server key, and does nothing", async () => {
    expect((await POST(request())).status).toBe(403);
    expect((await POST(request("Bearer wrong-key"))).status).toBe(403);
    expect(sweepStoredCopies).not.toHaveBeenCalled();
  });

  it("sweeps storage for the key holder, and the Drive folder only in Drive mode", async () => {
    const site = await POST(request("Bearer test-key"));
    expect(site.status).toBe(200);
    expect(sweepStoredCopies).toHaveBeenCalledTimes(1);
    expect(reconcileDriveFolder).not.toHaveBeenCalled();

    storage = "drive";
    await POST(request("Bearer test-key"));
    expect(reconcileDriveFolder).toHaveBeenCalledTimes(1);
  });
});
