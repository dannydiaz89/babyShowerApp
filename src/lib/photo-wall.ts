/**
 * When the photo wall is open.
 *
 * Pure on purpose: the rule decides whether a guest sees the Photos tab and
 * the day-of banner, and whether an upload is accepted, so it is tested
 * directly with an explicit "now" rather than read off the wall clock inside.
 */
import type { PhotoWallMode } from "@/lib/defaults";

/**
 * Where the shower is. "The event date" means the calendar date there, not
 * on the server: Vercel runs in UTC, and a wall that opened at 5 pm the day
 * before — UTC midnight — would confuse everyone.
 *
 * A single constant rather than a setting, because this site is for one
 * event. Forking it for another time zone means changing this line.
 */
export const EVENT_TIME_ZONE = "America/Los_Angeles";

export type WallState = {
  /** Show the Photos tab and the wall. */
  visible: boolean;
  /** Accept uploads and show the day-of banner. */
  uploads: boolean;
};

/** The "YYYY-MM-DD" part of a stored start, or null if it is unreadable. */
export function eventDateISO(startISO: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(startISO.trim());
  return match ? match[1] : null;
}

/** The calendar date at `now` in `timeZone`, as "YYYY-MM-DD". */
export function localDateISO(now: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which is the one thing wanted from it.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function photoWallState(
  mode: PhotoWallMode,
  startISO: string,
  now: Date,
  timeZone: string = EVENT_TIME_ZONE
): WallState {
  switch (mode) {
    case "open":
      return { visible: true, uploads: true };
    case "closed":
      // Uploads are over; what was added stays viewable.
      return { visible: true, uploads: false };
    case "auto": {
      const eventDate = eventDateISO(startISO);
      // An unreadable date cannot open the wall on its own. The hosts can
      // still open it by hand.
      if (!eventDate) return { visible: false, uploads: false };
      const open = localDateISO(now, timeZone) >= eventDate;
      return { visible: open, uploads: open };
    }
  }
}
