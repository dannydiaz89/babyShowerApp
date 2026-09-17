/**
 * How the wall notices that it is out of date, and what it does about it.
 *
 * Pure, so the pacing and the reconciling can be read and tested without a
 * browser or a clock. The effect that uses it lives in PhotoWall.
 */

import type { PhotoView, WallFilter } from "@/lib/photo-client";

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
 * How far the wall will walk from the newest photo to find one it already
 * has. Ten guests emptying a ten-photo batch each between two checks is 100
 * photos; five pages covers that. Past it the wall rebuilds instead, which is
 * correct where walking further is merely thorough.
 */
export const MAX_HEAD_PAGES = 5;

/**
 * How much of a deeply scrolled wall is rebuilt when photos disappear. A
 * guest who has scrolled through six pages and then sees a photo removed
 * gets those six pages re-read; one who has scrolled through fifty gets the
 * first eight and scrolls again for the rest. Removals are rare — a host
 * moderating, a guest taking back their own — so this trades a cost nobody
 * pays often against a wall that would otherwise show a hidden photo until
 * someone reloaded.
 */
export const MAX_REBUILD_PAGES = 8;

export type Counts = { live: number; hidden?: number };

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
 * What the wall compares between checks.
 *
 * Both numbers, not the one this filter happens to show. A hide moves a
 * photo from live to hidden: on the host's "all" wall neither the sum nor
 * the visible tally moves, and the photo has quietly changed underneath. A
 * guest is only ever told `live`, which is the only number that can change
 * anything they can see.
 */
export function signature(counts: Counts): string {
  return counts.hidden === undefined ? `${counts.live}` : `${counts.live}:${counts.hidden}`;
}

/** How many photos this filter says exist, for the header above the wall. */
export function countFor(counts: Counts, filter: WallFilter): number {
  if (filter === "hidden") return counts.hidden ?? 0;
  if (filter === "all") return counts.live + (counts.hidden ?? 0);
  return counts.live;
}

/** What the wall has to do to catch up. */
export type Change = "none" | "added" | "rebuild";

/**
 * Whether the wall can catch up by adding to the front, or has to be read
 * again.
 *
 * Adding is the common case and costs a page: photos arrive, and everything
 * already on screen is still there, still in the same order. Anything else —
 * a photo hidden, deleted, or restored — can only be seen by reading the wall
 * again, because what changed is a photo already on screen and a page fetched
 * from the head may never reach it.
 *
 * `before` is null on the first check after the page loads: there is no pair
 * of counts to compare yet, only the tally the server rendered with, so the
 * decision falls back to whether that tally went up or down.
 */
export function changeSince(
  before: Counts | null,
  after: Counts,
  visible: { before: number; after: number }
): Change {
  if (before) {
    if (signature(before) === signature(after)) return "none";
    const gone = after.live < before.live || (after.hidden ?? 0) !== (before.hidden ?? 0);
    return gone ? "rebuild" : "added";
  }

  if (visible.after === visible.before) return "none";
  return visible.after < visible.before ? "rebuild" : "added";
}

/**
 * The photos in `page` that are not on the wall yet, in the order Drive gave
 * them, and whether the walk can stop.
 *
 * Stopping at the first photo the wall already has is what keeps a burst
 * from being missed: a page entirely of new photos means there may be more
 * beyond it, so the caller asks for the next one.
 */
export function newHead(
  known: ReadonlySet<string>,
  page: readonly PhotoView[]
): { added: PhotoView[]; reachedKnown: boolean } {
  const added: PhotoView[] = [];
  for (const photo of page) {
    if (known.has(photo.id)) return { added, reachedKnown: true };
    added.push(photo);
  }
  // An empty page is the end of the wall, not a burst that outran us.
  return { added, reachedKnown: page.length === 0 };
}
