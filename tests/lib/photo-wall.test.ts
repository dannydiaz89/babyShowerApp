import { describe, expect, it } from "vitest";
import {
  closesAtISO,
  eventDateISO,
  localDateISO,
  localDateTimeISO,
  photoWallState,
} from "../../src/lib/photo-wall";

/**
 * The rule that opens the Photos tab and the day-of banner, and decides
 * whether an upload is accepted. It is tested with an explicit "now" and
 * time zone because the failure it guards against is a wall that opens at
 * UTC midnight — late afternoon the day before, where the shower is — or
 * closes an hour off for the same reason.
 */

const LA = "America/Los_Angeles";
const START = "2026-10-18T14:00";

function wall(mode: "auto" | "open", closesISO = "") {
  return { mode, startISO: START, closesISO };
}

describe("eventDateISO", () => {
  it("takes the date off a datetime-local value", () => {
    expect(eventDateISO("2026-10-18T14:00")).toBe("2026-10-18");
  });

  it("accepts a bare date", () => {
    expect(eventDateISO("2026-10-18")).toBe("2026-10-18");
  });

  it("refuses anything that is not a date", () => {
    expect(eventDateISO("")).toBeNull();
    expect(eventDateISO("soon")).toBeNull();
    expect(eventDateISO("18/10/2026")).toBeNull();
  });
});

describe("closesAtISO", () => {
  it("accepts a whole local datetime", () => {
    expect(closesAtISO("2026-10-18T22:00")).toBe("2026-10-18T22:00");
  });

  it("reads blank and junk as never", () => {
    expect(closesAtISO("")).toBeNull();
    expect(closesAtISO("2026-10-18")).toBeNull();
    expect(closesAtISO("tonight")).toBeNull();
  });
});

describe("local time", () => {
  it("reports the calendar date where the event is, not in UTC", () => {
    // 05:30 UTC on the 18th is still the evening of the 17th in Los Angeles.
    const now = new Date("2026-10-18T05:30:00Z");
    expect(localDateISO(now, "UTC")).toBe("2026-10-18");
    expect(localDateISO(now, LA)).toBe("2026-10-17");
  });

  it("writes midnight as 00, so it sorts before every other minute of the day", () => {
    expect(localDateTimeISO(new Date("2026-10-18T07:00:00Z"), LA)).toBe("2026-10-18T00:00");
  });
});

describe("photoWallState in auto mode", () => {
  it("stays closed the evening before, even once it is the event date in UTC", () => {
    const state = photoWallState(wall("auto"), new Date("2026-10-18T05:30:00Z"), LA);
    expect(state).toEqual({ visible: false, uploads: false });
  });

  it("opens at local midnight on the event date", () => {
    // 07:00 UTC is midnight PDT.
    const state = photoWallState(wall("auto"), new Date("2026-10-18T07:00:00Z"), LA);
    expect(state).toEqual({ visible: true, uploads: true });
  });

  it("stays open after the event when no close is set, so photos keep coming in", () => {
    const state = photoWallState(wall("auto"), new Date("2026-11-30T12:00:00Z"), LA);
    expect(state).toEqual({ visible: true, uploads: true });
  });

  it("cannot open on an unreadable start date", () => {
    const state = photoWallState(
      { mode: "auto", startISO: "whenever", closesISO: "" },
      new Date("2030-01-01T00:00:00Z"),
      LA
    );
    expect(state).toEqual({ visible: false, uploads: false });
  });
});

describe("photoWallState closing", () => {
  const closes = "2026-10-19T22:00";

  it("keeps taking photos until the closing moment", () => {
    // 04:59 UTC on the 20th is 21:59 PDT on the 19th.
    const state = photoWallState(wall("auto", closes), new Date("2026-10-20T04:59:00Z"), LA);
    expect(state).toEqual({ visible: true, uploads: true });
  });

  it("stops uploads at that moment where the event is, and keeps the wall viewable", () => {
    // 05:00 UTC on the 20th is 22:00 PDT on the 19th.
    const state = photoWallState(wall("auto", closes), new Date("2026-10-20T05:00:00Z"), LA);
    expect(state).toEqual({ visible: true, uploads: false });
  });

  it("does not read the closing time as UTC", () => {
    // 22:00 UTC on the 19th is 15:00 PDT — seven hours early.
    const state = photoWallState(wall("auto", closes), new Date("2026-10-19T22:00:00Z"), LA);
    expect(state).toEqual({ visible: true, uploads: true });
  });

  it("closes an opened-now wall the same way", () => {
    const state = photoWallState(wall("open", closes), new Date("2026-12-01T00:00:00Z"), LA);
    expect(state).toEqual({ visible: true, uploads: false });
  });

  it("never closes on a blank or unreadable time", () => {
    for (const bad of ["", "tonight", "2026-10-19"]) {
      const state = photoWallState(wall("open", bad), new Date("2030-01-01T00:00:00Z"), LA);
      expect(state).toEqual({ visible: true, uploads: true });
    }
  });

  it("a close set before the event date leaves the wall never open for uploads", () => {
    const state = photoWallState(
      wall("auto", "2026-10-01T00:00"),
      new Date("2026-10-18T20:00:00Z"),
      LA
    );
    expect(state).toEqual({ visible: true, uploads: false });
  });
});

describe("photoWallState open mode", () => {
  it("open means open now, whatever the date", () => {
    const state = photoWallState(wall("open"), new Date("2020-01-01T00:00:00Z"), LA);
    expect(state).toEqual({ visible: true, uploads: true });
  });
});
