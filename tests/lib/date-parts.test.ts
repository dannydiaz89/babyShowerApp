import { describe, expect, it } from "vitest";
import { formatParts, fromISO, parseTyped, toISO } from "../../src/lib/date-parts";

/**
 * These decide what date the event is actually saved as. The runner is pinned
 * west of UTC (see vitest.config.mts), so a helper that leans on Date parsing
 * a bare "YYYY-MM-DD" fails here rather than in production.
 */

const US = "en-US";
const MX = "es-MX";

describe("fromISO", () => {
  it("reads a real date", () => {
    expect(fromISO("2026-10-18")).toEqual({ year: 2026, month: 9, day: 18 });
  });

  it("keeps the day it was given, west of Greenwich", () => {
    // The bug this guards: new Date("2026-11-07") is midnight UTC, which is
    // still November 6th in California.
    expect(fromISO("2026-11-07")?.day).toBe(7);
  });

  it("rejects a day that does not exist", () => {
    // Stored unchanged but displayed as March 3rd, so the hosts would save one
    // date and read another back.
    expect(fromISO("2026-02-31")).toBeNull();
    expect(fromISO("2025-02-29")).toBeNull();
    expect(fromISO("2026-04-31")).toBeNull();
    expect(fromISO("2026-13-01")).toBeNull();
    expect(fromISO("2026-00-10")).toBeNull();
    expect(fromISO("2026-01-00")).toBeNull();
  });

  it("accepts February 29th in a leap year", () => {
    expect(fromISO("2028-02-29")).toEqual({ year: 2028, month: 1, day: 29 });
  });

  it("rejects anything that isn't the ISO shape", () => {
    expect(fromISO("10/18/2026")).toBeNull();
    expect(fromISO("2026-1-8")).toBeNull();
    expect(fromISO("")).toBeNull();
  });
});

describe("parseTyped", () => {
  it("reads the locale's own order", () => {
    expect(parseTyped("11/07/2026", US)).toEqual({ year: 2026, month: 10, day: 7 });
    expect(parseTyped("07/11/2026", MX)).toEqual({ year: 2026, month: 10, day: 7 });
  });

  it("takes any of the usual separators", () => {
    for (const typed of ["10/18/2026", "10-18-2026", "10.18.2026", "10 18 2026"]) {
      expect(parseTyped(typed, US)).toEqual({ year: 2026, month: 9, day: 18 });
    }
  });

  it("takes plain ISO whatever the locale", () => {
    expect(parseTyped("2026-10-18", MX)).toEqual({ year: 2026, month: 9, day: 18 });
  });

  it("rejects an impossible day rather than rolling it into the next month", () => {
    expect(parseTyped("02/31/2026", US)).toBeNull();
    expect(parseTyped("31/02/2026", MX)).toBeNull();
    // Same rule for ISO input: the shape matching is not enough.
    expect(parseTyped("2026-02-31", US)).toBeNull();
  });

  it("does not reinterpret a broken ISO date as month-first", () => {
    // "2026-13-01" is not a date; reading it as some other order would accept
    // a value the host plainly mistyped.
    expect(parseTyped("2026-13-01", US)).toBeNull();
  });

  it("expands a two-digit year", () => {
    expect(parseTyped("10/18/26", US)).toEqual({ year: 2026, month: 9, day: 18 });
  });

  it("returns null for empty or unreadable input", () => {
    expect(parseTyped("", US)).toBeNull();
    expect(parseTyped("   ", US)).toBeNull();
    expect(parseTyped("next Tuesday", US)).toBeNull();
    expect(parseTyped("10/2026", US)).toBeNull();
  });
});

describe("toISO and formatParts round trip", () => {
  it("keeps what was typed", () => {
    const parts = parseTyped("10/18/2026", US);
    expect(parts && toISO(parts)).toBe("2026-10-18");
  });

  it("shows a stored value back in the locale's order", () => {
    expect(formatParts(fromISO("2026-10-18"), US)).toBe("10/18/2026");
    expect(formatParts(fromISO("2026-10-18"), MX)).toBe("18/10/2026");
  });

  it("shows nothing for a date that could not be read", () => {
    expect(formatParts(fromISO("2026-02-31"), US)).toBe("");
  });
});
