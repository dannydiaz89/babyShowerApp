/**
 * How often the wall asks whether there are new photos.
 *
 * Pure, so the pacing can be read and tested without a browser or a clock.
 * The effect that uses it lives in PhotoWall.
 */

import type { WallFilter } from "@/lib/photo-client";

/** Fast enough that a photo taken at the table appears while people look. */
export const POLL_MIN_MS = 15_000;

/**
 * Slow enough that a tab left open all evening on a phone that never locks
 * costs a request a minute. It gets there in a few steps, so a wall that has
 * been quiet for a minute is still checked four times before it settles.
 */
export const POLL_MAX_MS = 60_000;

/** Gentle: 15s, 22s, 33s, 50s, then a minute. */
const GROWTH = 1.5;

/**
 * The wait after a check.
 *
 * A check that found something resets to the floor — photos arrive in
 * bursts, so the one that just landed is a reason to look again soon. One
 * that found nothing waits a little longer than last time.
 */
export function nextDelay(current: number, changed: boolean): number {
  if (changed) return POLL_MIN_MS;
  return Math.min(POLL_MAX_MS, Math.round(current * GROWTH));
}

/**
 * The number that tells this wall something has changed.
 *
 * A guest's wall shows live photos, so the live count is the whole story. A
 * host looking at hidden photos watches that count instead, or a restore
 * would leave their view stale. On "all" it is the sum: every photo that
 * exists, so an upload registers.
 *
 * A hide does not move that sum — it moves one photo from live to hidden —
 * and on "all" it should not: the photo is on screen either way, and the
 * host who hid it has already seen their own click take effect. What this
 * watches for is photos arriving, not photos changing.
 */
export function countFor(
  counts: { live: number; hidden?: number },
  filter: WallFilter
): number {
  if (filter === "hidden") return counts.hidden ?? 0;
  if (filter === "all") return counts.live + (counts.hidden ?? 0);
  return counts.live;
}
