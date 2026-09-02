/**
 * When the photo wall is open.
 *
 * Pure on purpose: the rule decides whether a guest sees the Photos tab and
 * the day-of banner, and whether an upload is accepted, so it is tested
 * directly with an explicit "now" rather than read off the wall clock inside.
 */
import type { PhotoWallMode } from "@/lib/defaults";

/**
 * The zone used when the settings do not name one. "The event date" means
 * the calendar date where the shower is, not on the server: Vercel runs in
 * UTC, and a wall that opened at 5 pm the day before — UTC midnight — would
 * confuse everyone. The hosts set the real zone on the Event tab; this is
 * only the fallback, and matches the sample event in lib/defaults.ts.
 */
export const DEFAULT_TIME_ZONE = "America/Chicago";

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
  /**
   * Why uploads are off while the wall would otherwise be taking them, or
   * null. A closed or not-yet-open wall is not a pause; this is only for
   * the storage behind it not being ready.
   */
  paused: PauseReason | null;
};

export type PauseReason =
  /** Drive is the chosen storage and no Google account is connected. */
  | "drive-unconnected"
  /** Google stopped answering; a later probe may bring it back. */
  | "drive-failing"
  /** Google refused the grant; only reconnecting helps. */
  | "drive-revoked"
  /** The site's storage for web copies is at its cap. */
  | "storage-full";

export type StorageStatus = {
  storage: "site" | "drive";
  /** Drive as connected, or null. Health is null when it has never failed. */
  drive: { health: "ok" | "failing"; failureKind: "unavailable" | "revoked" | null } | null;
  /** Web-copy bytes in the site's storage, and the cap. */
  bytes: number;
  cap: number;
};

/**
 * What stops uploads even when the wall is open.
 *
 * The site's storage is checked whichever original store is chosen: the
 * web copy always lands there. Drive is only a reason when Drive is chosen —
 * a host who picked "this site" is not held up by a Google outage.
 */
export function pauseReason(status: StorageStatus): PauseReason | null {
  if (status.bytes >= status.cap) return "storage-full";
  if (status.storage === "drive") {
    if (!status.drive) return "drive-unconnected";
    if (status.drive.health === "failing") {
      return status.drive.failureKind === "revoked" ? "drive-revoked" : "drive-failing";
    }
  }
  return null;
}

/** The open/closed rule with the storage's readiness folded in. */
export function withStorage(state: WallState, status: StorageStatus): WallState {
  const paused = state.uploads ? pauseReason(status) : null;
  return { ...state, uploads: state.uploads && paused === null, paused };
}

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
  timeZone: string = DEFAULT_TIME_ZONE
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
      return { visible: true, uploads: !closed, paused: null };
    case "auto": {
      const eventDate = eventDateISO(startISO);
      // An unreadable date cannot open the wall on its own. The hosts can
      // still open it by hand.
      if (!eventDate) return { visible: false, uploads: false, paused: null };
      const open = localDateISO(now, timeZone) >= eventDate;
      return { visible: open, uploads: open && !closed, paused: null };
    }
  }
}
