import "server-only";
import { api } from "../../convex/_generated/api";
import { convexClient, convexKey } from "@/lib/convex";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/defaults";

export type StoredSettings = Settings & {
  /** Present once the hosts have set a password from the admin page. */
  guestPasswordHash?: string;
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
 */
export async function getSettings(): Promise<StoredSettings> {
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

    return {
      ...settings,
      guestPasswordHash: row.guestPasswordHash,
      isConfigured: true,
      available: true,
    };
  } catch (error) {
    // Convex not reachable yet (fresh clone, missing env) or down. Show the
    // defaults rather than a crash; the dashboard explains what to configure.
    console.error("Loading settings failed", error);
    return { ...DEFAULT_SETTINGS, isConfigured: false, available: false };
  }
}
