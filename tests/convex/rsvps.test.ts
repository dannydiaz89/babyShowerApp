import { describe, expect, it } from "vitest";
import { toEmailKey, toPhoneKey } from "../../convex/rsvps";

/**
 * These two functions decide whether a second submission updates an existing
 * RSVP or creates a duplicate. Getting them wrong either double-counts a guest
 * or silently overwrites somebody else's reply, so the edges matter.
 */

describe("toEmailKey", () => {
  it("lowercases, so casing never splits one guest into two rows", () => {
    expect(toEmailKey("Elena.Vargas@Example.com")).toBe("elena.vargas@example.com");
  });

  it("trims stray whitespace from copy-paste and phone keyboards", () => {
    expect(toEmailKey("  elena@example.com  ")).toBe("elena@example.com");
  });

  it("treats missing or blank as no key, rather than an empty-string key", () => {
    // An empty key would match every other guest who left the field blank and
    // merge strangers together.
    expect(toEmailKey(undefined)).toBeUndefined();
    expect(toEmailKey("")).toBeUndefined();
    expect(toEmailKey("   ")).toBeUndefined();
  });
});

describe("toPhoneKey", () => {
  it("matches the same number typed three different ways", () => {
    const expected = "5625550177";
    expect(toPhoneKey("(562) 555-0177")).toBe(expected);
    expect(toPhoneKey("562-555-0177")).toBe(expected);
    expect(toPhoneKey("562.555.0177")).toBe(expected);
    expect(toPhoneKey(" 5625550177 ")).toBe(expected);
  });

  it("ignores a country code, which people vary between submissions", () => {
    expect(toPhoneKey("+1 (562) 555-0177")).toBe("5625550177");
    expect(toPhoneKey("1-562-555-0177")).toBe("5625550177");
  });

  it("treats too-short input as no key", () => {
    // Six digits is not a phone number; keying on it would collide guests.
    expect(toPhoneKey("555")).toBeUndefined();
    expect(toPhoneKey("555017")).toBeUndefined();
    expect(toPhoneKey(undefined)).toBeUndefined();
    expect(toPhoneKey("")).toBeUndefined();
    expect(toPhoneKey("not a phone")).toBeUndefined();
  });

  it("keeps a seven-digit local number as itself", () => {
    expect(toPhoneKey("555-0177")).toBe("5550177");
  });

  it("does not collapse two genuinely different numbers", () => {
    expect(toPhoneKey("(562) 555-0177")).not.toBe(toPhoneKey("(562) 555-0178"));
  });
});
