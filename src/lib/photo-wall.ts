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
  /** The event's end, same shape; may be blank. The preset closing time counts from it. */
  endISO: string;
  /** When uploads stop, "YYYY-MM-DDTHH:mm" local. Blank means the preset: a week after the event. */
  closesISO: string;
};

/** How long after the event the wall keeps taking photos unless the hosts say otherwise. */
export const DEFAULT_CLOSE_AFTER_DAYS = 7;

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

/**
 * The preset closing time: a week after the event ends (or starts, when no
 * end is set), at the same time of day. Blank when neither is readable.
 *
 * Plain calendar arithmetic on the parts, not a Date in the server's time
 * zone: the value is a local wall-clock moment, and a week later is the
 * same clock time seven days on whatever the offset does in between.
 */
export function defaultClosesISO(startISO: string, endISO: string): string {
  const base = closesAtISO(endISO) ?? closesAtISO(startISO);
  if (!base) return "";
  const [date, time] = base.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const later = new Date(Date.UTC(y, m - 1, d + DEFAULT_CLOSE_AFTER_DAYS));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${later.getUTCFullYear()}-${pad(later.getUTCMonth() + 1)}-${pad(later.getUTCDate())}T${time}`;
}

/** The closing time in force: what the hosts set, or the preset when they set nothing. */
export function effectiveClosesISO({
  startISO,
  endISO,
  closesISO,
}: Pick<WallSettings, "startISO" | "endISO" | "closesISO">): string {
  return closesAtISO(closesISO) ?? defaultClosesISO(startISO, endISO);
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
  settings: WallSettings,
  now: Date,
  timeZone: string = EVENT_TIME_ZONE
): WallState {
  const { mode, startISO } = settings;
  /*
   * Closing is a moment, not a mode: the hosts set it once — or leave the
   * preset, a week after the event — and the wall looks after itself. After
   * it, uploads stop but the wall stays viewable: photos are the point of
   * it, and they are still there. Only an unreadable event date leaves no
   * closing time at all, and then nothing closes.
   */
  const closesAt = closesAtISO(effectiveClosesISO(settings));
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
