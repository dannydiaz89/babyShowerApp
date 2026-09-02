import { describe, expect, it } from "vitest";
import { eventDateISO, localDateISO, photoWallState } from "../../src/lib/photo-wall";

/**
 * The rule that opens the Photos tab and the day-of banner, and decides
 * whether an upload is accepted. It is tested with an explicit "now" and
 * time zone because the failure it guards against is a wall that opens at
 * UTC midnight — late afternoon the day before, where the shower is.
 */

const LA = "America/Los_Angeles";
const START = "2026-10-18T14:00";

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

describe("localDateISO", () => {
  it("reports the calendar date where the event is, not in UTC", () => {
    // 05:30 UTC on the 18th is still the evening of the 17th in Los Angeles.
    const now = new Date("2026-10-18T05:30:00Z");
    expect(localDateISO(now, "UTC")).toBe("2026-10-18");
    expect(localDateISO(now, LA)).toBe("2026-10-17");
  });
});

describe("photoWallState in auto mode", () => {
  it("stays closed the evening before, even once it is the event date in UTC", () => {
    const state = photoWallState("auto", START, new Date("2026-10-18T05:30:00Z"), LA);
    expect(state).toEqual({ visible: false, uploads: false });
  });

  it("opens at local midnight on the event date", () => {
    // 07:00 UTC is midnight PDT.
    const state = photoWallState("auto", START, new Date("2026-10-18T07:00:00Z"), LA);
    expect(state).toEqual({ visible: true, uploads: true });
  });

  it("stays open after the event, so photos keep coming in", () => {
    const state = photoWallState("auto", START, new Date("2026-11-30T12:00:00Z"), LA);
    expect(state).toEqual({ visible: true, uploads: true });
  });

  it("cannot open on an unreadable start date", () => {
    const state = photoWallState("auto", "whenever", new Date("2030-01-01T00:00:00Z"), LA);
    expect(state).toEqual({ visible: false, uploads: false });
  });
});

describe("photoWallState overrides", () => {
  it("open means open now, whatever the date", () => {
    const state = photoWallState("open", START, new Date("2020-01-01T00:00:00Z"), LA);
    expect(state).toEqual({ visible: true, uploads: true });
  });

  it("closed stops uploads but keeps the wall viewable", () => {
    const state = photoWallState("closed", START, new Date("2026-10-18T20:00:00Z"), LA);
    expect(state).toEqual({ visible: true, uploads: false });
  });
});
