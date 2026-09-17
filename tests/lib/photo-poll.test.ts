import { describe, expect, it } from "vitest";
import { POLL_MAX_MS, POLL_MIN_MS, countFor, nextDelay } from "@/lib/photo-poll";

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
