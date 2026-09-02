import "server-only";
import { cache } from "react";
import { api } from "../../convex/_generated/api";
import { convexClient, convexKey } from "@/lib/convex";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/defaults";

export type StoredSettings = Settings & {
  /** Present once the hosts have set a password from the admin page. */
  guestPasswordHash?: string;
  /**
   * When guest sessions were last invalidated, as a timestamp.
   *
   * Bumped whenever the guest password changes. A guest cookie issued before
   * this moment was minted under a password the hosts have since replaced, so
   * it no longer grants access — see `hasGuestAccess` in lib/session.ts.
   * Absent on rows written before this existed, which reads as "never".
   */
  guestSessionEpoch?: number;
  /** False when nothing has been saved and the site is showing defaults. */
  isConfigured: boolean;
  /**
   * False when Convex could not be reached, so what is stored is unknown.
   *
   * The difference matters: `isConfigured: false` means "the hosts have saved
   * nothing", while `available: false` means "we cannot tell". Anything that
   * decides access must fail closed on the second — treating an outage as
   * "no stored password" would quietly re-enable whichever password the
   * environment still holds, including one the hosts already rotated away.
   */
  available: boolean;
};

/**
 * What the site should display. Falls back to the built-in defaults when the
 * hosts have not saved anything yet, so a fresh install still renders.
 *
 * Memoised for the life of one request. The root layout reads settings to build
 * the page metadata and the page itself reads them again, and the guest pages
 * add a third read to check the session against `guestSessionEpoch`. Without
 * this each of those is its own HTTP round trip to Convex for the same
 * singleton row. React's `cache` collapses them into one; it is per-request, so
 * two visitors never share an answer and a save is still visible immediately.
 */
export const getSettings = cache(async (): Promise<StoredSettings> => {
  try {
    const row = await convexClient().query(api.settings.get, { key: convexKey() });
    if (!row) return { ...DEFAULT_SETTINGS, isConfigured: false, available: true };

    /*
     * Pick fields by name rather than spreading the row. Convex bookkeeping
     * (_id, _creationTime) and any retired column stay out, so what comes back
     * always matches Settings — including when it is handed straight back to
     * the update mutation, which rejects unknown arguments.
     */
    const settings = {} as Settings;
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const value = (row as Record<string, unknown>)[key];
      (settings as Record<string, unknown>)[key] =
        value === undefined ? DEFAULT_SETTINGS[key] : value;
    }

    /*
     * "closed" was a manual photo-wall switch, retired in favour of a closing
     * time. A row that still holds it reads as the default, never closing;
     * the next save from the Photos tab writes the current shape.
     */
    if ((row.photoWall as string) === "closed") settings.photoWall = "auto";

    return {
      ...settings,
      guestPasswordHash: row.guestPasswordHash,
      guestSessionEpoch: row.guestSessionEpoch,
      isConfigured: true,
      available: true,
    };
  } catch (error) {
    // Convex not reachable yet (fresh clone, missing env) or down. Show the
    // defaults rather than a crash; the dashboard explains what to configure.
    console.error("Loading settings failed", error);
    return { ...DEFAULT_SETTINGS, isConfigured: false, available: false };
  }
});
