import { NextResponse } from "next/server";
import { loadTotals, photoCaller, wallState, type PhotoTotals } from "@/lib/photos";
import { refuse } from "@/lib/photo-routes";

/*
 * GET /api/photos/count — "are there new photos?", and nothing else.
 *
 * The wall asks this on a timer so photos appear without a reload. Answering
 * with the page itself would mean reading two dozen photo documents and
 * building a storage URL for each, every few seconds, for every phone at the
 * party. The totals row is one small document that every photo write already
 * keeps current, so this is the cheapest question the wall can ask — and the
 * page is fetched only when the answer changes.
 */

export const dynamic = "force-dynamic";

/**
 * How long one read of the totals serves every caller.
 *
 * Without this the cost of the wall scales with the number of guests looking
 * at it: thirty phones on a fifteen-second timer is thirty Convex calls every
 * fifteen seconds. With it, it scales with time instead — one call per window
 * per server instance, whether two people are watching or two hundred. The
 * window is well under the poll interval, so nobody waits longer for a photo
 * because of it.
 *
 * Per instance, like the Drive token cache: there is no shared cache to go
 * stale, and a cold start simply reads again.
 */
const CACHE_MS = 10_000;

let cached: { at: number; totals: PhotoTotals } | null = null;

async function totals(): Promise<PhotoTotals> {
  const now = Date.now();
  const age = cached ? now - cached.at : Infinity;
  /*
   * A negative age means the clock moved backwards — an NTP correction on the
   * host, say. Treating that as "very fresh" would serve one answer until the
   * clock caught up, so it counts as expired instead.
   */
  if (cached && age >= 0 && age < CACHE_MS) return cached.totals;

  const fresh = await loadTotals();
  cached = { at: now, totals: fresh };
  return fresh;
}

export async function GET() {
  const caller = await photoCaller();
  if (!caller.role) return refuse("signed-out", 401);

  const state = await wallState();
  if (!state.visible && caller.role !== "host") return refuse("closed", 403);

  try {
    const { live, hidden } = await totals();
    return NextResponse.json(
      // How many photos a guest cannot see is the hosts' business, and a
      // guest's wall has no use for it.
      caller.role === "host" ? { live, hidden } : { live },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Reading the photo count failed", error);
    return refuse("failed", 500);
  }
}
