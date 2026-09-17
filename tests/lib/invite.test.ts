import { describe, expect, it } from "vitest";

/**
 * The invite code is a bearer credential printed on paper: whoever scans the
 * card is admitted. These are the properties that keeps honest — that a code
 * is unguessable, that comparing one cannot be timed, and that the link works
 * however a phone or a mail client mangles it on the way in.
 */

process.env.AUTH_SECRET = "test-secret-not-a-real-one";

const {
  INVITE_CODE_LENGTH,
  newInviteCode,
  normalizeInviteCode,
  inviteCodeMatches,
  invitePath,
} = await import("../../src/lib/invite");

describe("newInviteCode", () => {
  it("is the advertised length, from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = newInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      // Crockford base32: no I, L, O or U, so nothing a guest reads off paper
      // is ambiguous and nothing the generator emits spells a word.
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
    }
  });

  it("does not repeat itself", () => {
    // 50 bits: a collision in a thousand draws would mean the randomness is
    // not random, which is the only way this assertion ever fires.
    const seen = new Set(Array.from({ length: 1000 }, () => newInviteCode()));
    expect(seen.size).toBe(1000);
  });

  it("uses the whole alphabet, rather than a biased slice of it", () => {
    const chars = new Set(Array.from({ length: 2000 }, newInviteCode).join(""));
    expect(chars.size).toBe(32);
  });
});

describe("normalizeInviteCode", () => {
  it("accepts the code however it arrives", () => {
    const code = "7QK4M2XR9T";
    for (const arrival of [
      code.toLowerCase(),
      ` ${code} `,
      "7QK4-M2XR-9T",
      "7qk4 m2xr 9t",
    ]) {
      expect(normalizeInviteCode(arrival)).toBe(code);
    }
  });

  it("bounds what it will compare, since this comes off the network", () => {
    expect(normalizeInviteCode("A".repeat(10_000))).toHaveLength(64);
  });
});

describe("inviteCodeMatches", () => {
  it("matches the stored code, in any casing", () => {
    expect(inviteCodeMatches("7qk4m2xr9t", "7QK4M2XR9T")).toBe(true);
  });

  it("refuses a different code", () => {
    expect(inviteCodeMatches("7QK4M2XR9U", "7QK4M2XR9T")).toBe(false);
    expect(inviteCodeMatches("7QK4M2XR9", "7QK4M2XR9T")).toBe(false);
  });

  it("refuses everything when no code is stored", () => {
    // The hosts have not made a link, or have revoked the one they made. An
    // empty stored value must not be something an empty submission matches.
    expect(inviteCodeMatches("", undefined)).toBe(false);
    expect(inviteCodeMatches("", "")).toBe(false);
    expect(inviteCodeMatches("anything", undefined)).toBe(false);
    expect(inviteCodeMatches("-", "  ")).toBe(false);
  });
});

describe("invitePath", () => {
  it("is where the route reads it from", () => {
    expect(invitePath("7QK4M2XR9T")).toBe("/i/7QK4M2XR9T");
  });

  it("carries a destination for a table card", () => {
    expect(invitePath("7QK4M2XR9T", "/photos")).toBe("/i/7QK4M2XR9T?next=%2Fphotos");
  });
});
