import { describe, expect, it } from "vitest";
import {
  POLL_MAX_MS,
  POLL_MIN_MS,
  changeSince,
  countFor,
  newHead,
  nextDelay,
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
  it("shows the live count above a guest's wall", () => {
    expect(countFor({ rev: 1, live: 12 }, "live")).toBe(12);
  });

  it("shows the hidden count when a host is looking at hidden photos", () => {
    expect(countFor({ rev: 1, live: 12, hidden: 3 }, "hidden")).toBe(3);
  });

  it("shows every photo that exists on the host's whole wall", () => {
    expect(countFor({ rev: 1, live: 12, hidden: 3 }, "all")).toBe(15);
  });

  it("treats a missing hidden count as none, which is what a guest is told", () => {
    expect(countFor({ rev: 1, live: 12 }, "all")).toBe(12);
    expect(countFor({ rev: 1, live: 12 }, "hidden")).toBe(0);
  });
});

/** Only the field the wall compares on. */
function photo(id: string): PhotoView {
  return { id, url: `https://example.invalid/${id}`, width: 100, height: 100, status: "live" } as PhotoView;
}

/**
 * What a check does about what it found.
 *
 * The revision answers "did anything happen" — the counts cannot, because a
 * photo added and another deleted between two checks leaves every tally
 * exactly where it was. The counts then answer the narrower question of
 * whether adding to the front is enough.
 */
describe("changeSince", () => {
  it("does nothing when no photo has been written", () => {
    // The counts are identical and so is the revision: a quiet wall.
    expect(changeSince({ rev: 9, live: 12, hidden: 3 }, { rev: 9, live: 12, hidden: 3 })).toBe(
      "none"
    );
  });

  it("adds to the front when the only writes were arrivals", () => {
    expect(changeSince({ rev: 9, live: 12 }, { rev: 12, live: 15 })).toBe("added");
  });

  it("rebuilds when a photo was deleted", () => {
    expect(changeSince({ rev: 9, live: 12 }, { rev: 10, live: 11 })).toBe("rebuild");
  });

  it("rebuilds when a photo was hidden, which no tally shows on the host's wall", () => {
    // live 12 → 11 and hidden 3 → 4: the sum is 15 either side of it.
    expect(changeSince({ rev: 9, live: 12, hidden: 3 }, { rev: 10, live: 11, hidden: 4 })).toBe(
      "rebuild"
    );
  });

  it("rebuilds an upload paired with a delete, where every count agrees", () => {
    /*
     * The case that defeats counting outright. Two writes, one photo added at
     * the top and one taken from the middle, and `live` is where it started.
     * Only the revision knows, and only a rebuild can show it.
     */
    expect(changeSince({ rev: 9, live: 12 }, { rev: 11, live: 12 })).toBe("rebuild");
  });

  it("rebuilds when more writes happened than photos arrived", () => {
    // Three writes, two more photos: something else happened in among them.
    expect(changeSince({ rev: 9, live: 12 }, { rev: 12, live: 14 })).toBe("rebuild");
  });

  it("rebuilds a restore, which changes a row already on screen", () => {
    expect(changeSince({ rev: 9, live: 11, hidden: 4 }, { rev: 10, live: 12, hidden: 3 })).toBe(
      "rebuild"
    );
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
