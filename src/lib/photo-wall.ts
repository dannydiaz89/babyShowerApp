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
 * before — UTC midnight — would confuse everyone. The closing time is read
 * the same way.
 *
 * A single constant rather than a setting, because this site is for one
 * event. Forking it for another time zone means changing this line.
 */
export const EVENT_TIME_ZONE = "America/Los_Angeles";

export type WallSettings = {
  mode: PhotoWallMode;
  /** The event's start, "YYYY-MM-DDTHH:mm" local. Its date is what opens the wall. */
  startISO: string;
  /** When uploads stop, "YYYY-MM-DDTHH:mm" local. Blank means never. */
  closesISO: string;
};

export type WallState = {
  /** Show the Photos tab and the wall. */
  visible: boolean;
  /** Accept uploads and show the day-of banner. */
  uploads: boolean;
};

const LOCAL_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

/** The "YYYY-MM-DD" part of a stored start, or null if it is unreadable. */
export function eventDateISO(startISO: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(startISO.trim());
  return match ? match[1] : null;
}

/** A well-formed "YYYY-MM-DDTHH:mm", or null. Blank and junk both read as null. */
export function closesAtISO(closesISO: string): string | null {
  const match = LOCAL_DATETIME.exec(closesISO.trim());
  return match ? `${match[1]}T${match[2]}` : null;
}

function parts(now: Date, timeZone: string): Record<string, string> {
  // en-CA formats the date as YYYY-MM-DD; h23 keeps midnight as 00, not 24.
  const list = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Object.fromEntries(list.map((p) => [p.type, p.value]));
}

/** The calendar date at `now` in `timeZone`, as "YYYY-MM-DD". */
export function localDateISO(now: Date, timeZone: string): string {
  const p = parts(now, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The local wall-clock moment at `now` in `timeZone`, as "YYYY-MM-DDTHH:mm". */
export function localDateTimeISO(now: Date, timeZone: string): string {
  const p = parts(now, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function photoWallState(
  { mode, startISO, closesISO }: WallSettings,
  now: Date,
  timeZone: string = EVENT_TIME_ZONE
): WallState {
  /*
   * Closing is a moment, not a mode: the hosts set it once and the wall
   * looks after itself on the night. After it, uploads stop but the wall
   * stays viewable — photos are the point of it, and they are still there.
   * A blank or unreadable value never closes anything.
   */
  const closesAt = closesAtISO(closesISO);
  const closed = closesAt !== null && localDateTimeISO(now, timeZone) >= closesAt;

  switch (mode) {
    case "open":
      return { visible: true, uploads: !closed };
    case "auto": {
      const eventDate = eventDateISO(startISO);
      // An unreadable date cannot open the wall on its own. The hosts can
      // still open it by hand.
      if (!eventDate) return { visible: false, uploads: false };
      const open = localDateISO(now, timeZone) >= eventDate;
      return { visible: open, uploads: open && !closed };
    }
  }
}
