import { describe, expect, it } from "vitest";
import {
  POLL_MAX_MS,
  POLL_MIN_MS,
  changeSince,
  countFor,
  newHead,
  nextDelay,
  signature,
} from "@/lib/photo-poll";
import type { PhotoView } from "@/lib/photo-client";

/**
 * The wall asks a server how many photos there are, on a timer, on every
 * phone at the party. This is the arithmetic that decides how often — the
 * difference between a wall that feels live and one that quietly spends a
 * quota all evening.
 */

describe("nextDelay", () => {
  it("returns to the floor the moment something arrives", () => {
    // Photos come in bursts: one landing is a reason to look again soon.
    expect(nextDelay(POLL_MAX_MS, true)).toBe(POLL_MIN_MS);
  });

  it("waits longer each time nothing has changed", () => {
    const first = nextDelay(POLL_MIN_MS, false);
    expect(first).toBeGreaterThan(POLL_MIN_MS);
    expect(nextDelay(first, false)).toBeGreaterThan(first);
  });

  it("settles at a minute rather than growing for ever", () => {
    // The case that matters: a tab left open on a phone that never locks.
    let delay = POLL_MIN_MS;
    for (let i = 0; i < 50; i++) delay = nextDelay(delay, false);
    expect(delay).toBe(POLL_MAX_MS);
  });

  it("gets there in a few steps, not one and not twenty", () => {
    let delay = POLL_MIN_MS;
    let steps = 0;
    while (delay < POLL_MAX_MS) {
      delay = nextDelay(delay, false);
      steps += 1;
    }
    expect(steps).toBeGreaterThanOrEqual(3);
    expect(steps).toBeLessThanOrEqual(6);
  });
});

describe("countFor", () => {
  it("watches the live count on a guest's wall", () => {
    expect(countFor({ live: 12 }, "live")).toBe(12);
  });

  it("watches the hidden count when a host is looking at hidden photos", () => {
    // Restoring a photo changes this and nothing else; watching `live` would
    // leave the host's view stale until they reloaded.
    expect(countFor({ live: 12, hidden: 3 }, "hidden")).toBe(3);
  });

  it("counts every photo that exists on the host's whole wall", () => {
    expect(countFor({ live: 12, hidden: 3 }, "all")).toBe(15);
  });

  it("does not read a hide as an arrival", () => {
    // A hide moves one photo from live to hidden, so the sum is unchanged —
    // and on "all" that is right: the photo is on screen either way, and the
    // host who hid it watched their own click take effect.
    expect(countFor({ live: 11, hidden: 4 }, "all")).toBe(
      countFor({ live: 12, hidden: 3 }, "all")
    );
  });

  it("treats a missing hidden count as none, which is what a guest gets", () => {
    // The route answers guests with `live` alone; nothing here should read
    // an absent number as a change.
    expect(countFor({ live: 12 }, "all")).toBe(12);
    expect(countFor({ live: 12 }, "hidden")).toBe(0);
  });
});

/** Only the field the wall compares on. */
function photo(id: string): PhotoView {
  return { id, url: `https://example.invalid/${id}`, width: 100, height: 100, status: "live" } as PhotoView;
}

describe("signature", () => {
  it("tells a hide from nothing happening, which a sum cannot", () => {
    // A hide moves one photo from live to hidden. The host's "all" tally is
    // identical either side of it, and so is any single number.
    expect(signature({ live: 11, hidden: 4 })).not.toBe(signature({ live: 12, hidden: 3 }));
  });

  it("is just the live count for a guest, who is told nothing else", () => {
    expect(signature({ live: 12 })).toBe("12");
  });
});

describe("changeSince", () => {
  const visible = { before: 12, after: 12 };

  it("does nothing when neither number moved", () => {
    expect(changeSince({ live: 12, hidden: 3 }, { live: 12, hidden: 3 }, visible)).toBe("none");
  });

  it("adds to the front when photos arrived", () => {
    expect(
      changeSince({ live: 12, hidden: 3 }, { live: 15, hidden: 3 }, { before: 12, after: 15 })
    ).toBe("added");
  });

  it("rebuilds when a photo was deleted", () => {
    // Prepending cannot express a photo that is gone; only reading the wall
    // again can, so a guest stops seeing what a host removed.
    expect(
      changeSince({ live: 12, hidden: 3 }, { live: 11, hidden: 3 }, { before: 12, after: 11 })
    ).toBe("rebuild");
  });

  it("rebuilds when a photo was hidden, even though the sum is unchanged", () => {
    expect(
      changeSince({ live: 12, hidden: 3 }, { live: 11, hidden: 4 }, { before: 15, after: 15 })
    ).toBe("rebuild");
  });

  it("rebuilds when a host restores one, which changes a row already on screen", () => {
    expect(
      changeSince({ live: 11, hidden: 4 }, { live: 12, hidden: 3 }, { before: 15, after: 15 })
    ).toBe("rebuild");
  });

  describe("on the first check, with only the server's tally to go on", () => {
    it("does nothing when the tally still matches", () => {
      expect(changeSince(null, { live: 12 }, { before: 12, after: 12 })).toBe("none");
    });

    it("adds when it has gone up", () => {
      expect(changeSince(null, { live: 14 }, { before: 12, after: 14 })).toBe("added");
    });

    it("rebuilds when it has gone down", () => {
      expect(changeSince(null, { live: 10 }, { before: 12, after: 10 })).toBe("rebuild");
    });
  });
});

describe("newHead", () => {
  it("stops at the first photo the wall already has", () => {
    const known = new Set(["c", "b", "a"]);
    const { added, reachedKnown } = newHead(known, [photo("e"), photo("d"), photo("c")]);

    expect(added.map((p) => p.id)).toEqual(["e", "d"]);
    expect(reachedKnown).toBe(true);
  });

  it("asks for another page when every photo on this one is new", () => {
    // Three phones emptying their camera rolls between two checks. Stopping
    // here would strand the rest behind a cursor that has moved past them.
    const { added, reachedKnown } = newHead(new Set(["a"]), [photo("z"), photo("y")]);

    expect(added.map((p) => p.id)).toEqual(["z", "y"]);
    expect(reachedKnown).toBe(false);
  });

  it("stops at the end of the wall", () => {
    expect(newHead(new Set(["a"]), []).reachedKnown).toBe(true);
  });

  it("keeps the order the server gave, newest first", () => {
    const { added } = newHead(new Set(["a"]), [photo("z"), photo("y"), photo("a")]);
    expect(added.map((p) => p.id)).toEqual(["z", "y"]);
  });
});
