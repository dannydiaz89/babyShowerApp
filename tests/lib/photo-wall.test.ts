import { describe, expect, it } from "vitest";
import {
  closesAtISO,
  defaultClosesISO,
  effectiveClosesISO,
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

const END = "2026-10-18T17:00";

function wall(mode: "auto" | "open", closesISO = "", endISO = END) {
  return { mode, startISO: START, endISO, closesISO };
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

describe("defaultClosesISO", () => {
  it("is a week after the event ends, at the same time of day", () => {
    expect(defaultClosesISO(START, END)).toBe("2026-10-25T17:00");
  });

  it("counts from the start when no end is set", () => {
    expect(defaultClosesISO(START, "")).toBe("2026-10-25T14:00");
  });

  it("rolls over a month end and a year end by the calendar", () => {
    expect(defaultClosesISO("2026-10-28T14:00", "")).toBe("2026-11-04T14:00");
    expect(defaultClosesISO("2026-12-28T20:00", "")).toBe("2027-01-04T20:00");
  });

  it("is blank when the event has no readable date", () => {
    expect(defaultClosesISO("someday", "")).toBe("");
  });
});

describe("effectiveClosesISO", () => {
  it("prefers what the hosts set", () => {
    expect(effectiveClosesISO(wall("auto", "2026-10-20T09:00"))).toBe("2026-10-20T09:00");
  });

  it("falls back to the preset when nothing, or nothing readable, is set", () => {
    expect(effectiveClosesISO(wall("auto"))).toBe("2026-10-25T17:00");
    expect(effectiveClosesISO(wall("auto", "tonight"))).toBe("2026-10-25T17:00");
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

  it("keeps taking photos in the week after the event when nothing is set", () => {
    // Three days on: the preset close is a week after the end.
    const state = photoWallState(wall("auto"), new Date("2026-10-21T12:00:00Z"), LA);
    expect(state).toEqual({ visible: true, uploads: true });
  });

  it("closes to new photos a week after the event ends, and stays viewable", () => {
    // 2026-10-25T17:00 PDT is 00:00 UTC on the 26th.
    const before = photoWallState(wall("auto"), new Date("2026-10-25T23:59:00Z"), LA);
    const after = photoWallState(wall("auto"), new Date("2026-10-26T00:00:00Z"), LA);
    expect(before).toEqual({ visible: true, uploads: true });
    expect(after).toEqual({ visible: true, uploads: false });
  });

  it("cannot open on an unreadable start date", () => {
    const state = photoWallState(
      { mode: "auto", startISO: "whenever", endISO: "", closesISO: "" },
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

  it("uses the preset when the set time is blank or unreadable", () => {
    for (const bad of ["", "tonight", "2026-10-19"]) {
      const during = photoWallState(wall("open", bad), new Date("2026-10-20T00:00:00Z"), LA);
      const later = photoWallState(wall("open", bad), new Date("2030-01-01T00:00:00Z"), LA);
      expect(during).toEqual({ visible: true, uploads: true });
      expect(later).toEqual({ visible: true, uploads: false });
    }
  });

  it("never closes when the event itself has no readable date to count from", () => {
    const state = photoWallState(
      { mode: "open", startISO: "", endISO: "", closesISO: "" },
      new Date("2030-01-01T00:00:00Z"),
      LA
    );
    expect(state).toEqual({ visible: true, uploads: true });
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
  it("open means open now, however early", () => {
    const state = photoWallState(wall("open"), new Date("2020-01-01T00:00:00Z"), LA);
    expect(state).toEqual({ visible: true, uploads: true });
  });
});
