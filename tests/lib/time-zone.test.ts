import { describe, expect, it } from "vitest";
import { isTimeZone, TIME_ZONE_OPTIONS } from "../../src/lib/defaults";

/**
 * The event's time zone decides when the photo wall opens and closes, so
 * what the settings form accepts has to be a zone the runtime can use.
 */
describe("isTimeZone", () => {
  it("accepts every zone the form offers", () => {
    for (const zone of TIME_ZONE_OPTIONS) expect(isTimeZone(zone)).toBe(true);
  });

  it("accepts a valid zone the form does not list", () => {
    expect(isTimeZone("Europe/Madrid")).toBe(true);
  });

  it("refuses blanks, typos and non-strings", () => {
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone("America/Los Angeles")).toBe(false);
    expect(isTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isTimeZone(undefined)).toBe(false);
  });
});
