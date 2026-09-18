import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The endpoint the wall polls.
 *
 * Its job is to be cheap: one small document, shared by everyone looking at
 * the wall for a few seconds at a time. Without the cache the cost of the
 * wall scales with the number of guests watching it — thirty phones on a
 * fifteen-second timer is thirty Convex calls every fifteen seconds. With it,
 * the cost scales with time instead, which is the property worth a test.
 */

process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.ADMIN_API_KEY = "test-key";
process.env.CONVEX_URL = "https://example.convex.cloud";

const loadTotals = vi.fn();
let role: "host" | "guest" | null = "guest";
let visible = true;

vi.mock("@/lib/photos", () => ({
  loadTotals: () => loadTotals(),
  photoCaller: async () => ({ role, uploaderId: "device-1" }),
  wallState: async () => ({ visible, uploads: true, paused: false }),
}));

const { GET } = await import("../../src/app/api/photos/count/route");

/*
 * The cache lives in the route module, so it survives from one test to the
 * next. Each case starts ten minutes after the last rather than resetting the
 * clock — winding time backwards is a different test, below.
 */
let clock = new Date("2026-11-07T15:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  clock += 10 * 60 * 1000;
  vi.setSystemTime(clock);
  loadTotals.mockReset();
  loadTotals.mockResolvedValue({ live: 12, hidden: 3, bytes: 0, rev: 7 });
  role = "guest";
  visible = true;
});

afterEach(() => {
  vi.useRealTimers();
});

/** Move the clock, without waiting for it. */
function laterBySeconds(seconds: number) {
  clock += seconds * 1000;
  vi.setSystemTime(clock);
}

describe("the count endpoint", () => {
  it("answers a guest with the live count alone", async () => {
    const body = await (await GET()).json();

    // How many photos a guest cannot see is the hosts' business.
    expect(body).toEqual({ rev: 7, live: 12 });
  });

  it("answers a host with both, so their filters can tell what moved", async () => {
    role = "host";
    expect(await (await GET()).json()).toEqual({ rev: 7, live: 12, hidden: 3 });
  });

  it("reads Convex once for everyone who asks inside the window", async () => {
    // Thirty phones, one fifteen-second tick.
    for (let i = 0; i < 30; i++) await GET();

    expect(loadTotals).toHaveBeenCalledTimes(1);
  });

  it("reads once for thirty phones that arrive together on an expired cache", async () => {
    /*
     * The case a sequential loop cannot show. Phones that loaded the wall at
     * the same moment poll at the same moment, so they arrive together and
     * all find the cache a shade too old — the thundering herd the cache is
     * there to prevent.
     */
    let release: (value: { live: number; hidden: number; bytes: number; rev: number }) => void =
      () => {};
    loadTotals.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const inFlight = Array.from({ length: 30 }, () => GET());
    release({ live: 12, hidden: 3, bytes: 0, rev: 7 });
    const bodies = await Promise.all((await Promise.all(inFlight)).map((r) => r.json()));

    expect(loadTotals).toHaveBeenCalledTimes(1);
    // And every one of them is answered, not just the one that did the read.
    expect(bodies).toHaveLength(30);
    expect(bodies.every((b) => b.live === 12)).toBe(true);
  });

  it("lets the next caller retry after a read fails", async () => {
    loadTotals.mockRejectedValueOnce(new Error("convex is down"));
    expect((await GET()).status).toBe(500);

    loadTotals.mockResolvedValue({ live: 5, hidden: 0, bytes: 0, rev: 3 });
    expect(await (await GET()).json()).toEqual({ rev: 3, live: 5 });
  });

  it("reads again once the window has passed", async () => {
    await GET();
    laterBySeconds(11);
    await GET();

    expect(loadTotals).toHaveBeenCalledTimes(2);
  });

  it("serves the fresher number after the window, not the cached one", async () => {
    await GET();

    loadTotals.mockResolvedValue({ live: 20, hidden: 3, bytes: 0, rev: 9 });
    laterBySeconds(11);

    expect(await (await GET()).json()).toEqual({ rev: 9, live: 20 });
  });

  it("is never cached by the browser, whatever the server keeps", async () => {
    expect((await GET()).headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a caller with no session", async () => {
    role = null;
    const response = await GET();
    expect(response.status).toBe(401);
    expect(loadTotals).not.toHaveBeenCalled();
  });

  it("refuses a guest before the hosts open the wall", async () => {
    visible = false;
    expect((await GET()).status).toBe(403);
  });

  it("still answers a host while the wall is closed to guests", async () => {
    visible = false;
    role = "host";
    expect((await GET()).status).toBe(200);
  });
});

describe("a clock that moves backwards", () => {
  it("does not freeze the cache until it catches up", async () => {
    await GET();
    loadTotals.mockResolvedValue({ live: 99, hidden: 0, bytes: 0, rev: 40 });

    // An NTP correction on the host, mid-party.
    laterBySeconds(-120);

    expect(await (await GET()).json()).toEqual({ rev: 40, live: 99 });
  });
});
