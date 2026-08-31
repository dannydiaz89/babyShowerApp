import { describe, expect, it, beforeAll, vi } from "vitest";
import {
  createToken,
  verifyToken,
  safeEqual,
  passwordMatches,
  sessionSeconds,
  cookieOptions,
  GUEST_SESSION_SECONDS,
  ADMIN_SESSION_SECONDS,
} from "@/lib/auth";

// The signing key. Every assertion below depends on it being set, since the
// module throws without one — which is itself the behaviour we want.
beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-not-the-real-one";
});

describe("session tokens", () => {
  it("accepts a token it just issued", async () => {
    expect(await verifyToken(await createToken("guest"), "guest")).toBe(true);
    expect(await verifyToken(await createToken("admin"), "admin")).toBe(true);
  });

  it("refuses a guest token presented as an admin one", async () => {
    // The whole admin boundary rests on this: a guest cookie must never open
    // the dashboard, even though both are signed with the same key.
    const guest = await createToken("guest");
    expect(await verifyToken(guest, "admin")).toBe(false);
  });

  it("refuses a token whose payload was edited", async () => {
    const token = await createToken("guest");
    const [, expires, signature] = token.split(".");
    // Promote the role but keep the original signature.
    expect(await verifyToken(`admin.${expires}.${signature}`, "admin")).toBe(false);
  });

  it("refuses a token whose expiry was pushed out", async () => {
    const token = await createToken("admin");
    const [role, expires, signature] = token.split(".");
    const later = Number(expires) + 60 * 60 * 1000;
    expect(await verifyToken(`${role}.${later}.${signature}`, "admin")).toBe(false);
  });

  it("refuses a genuinely signed token once it has expired", async () => {
    // Travel forward instead of forging a payload: pairing a real signature
    // with a different expiry only proves the signature check works, which is
    // already covered above. This is the only assertion that exercises the
    // expiry branch itself.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const token = await createToken("admin");
      expect(await verifyToken(token, "admin")).toBe(true);

      vi.setSystemTime(new Date("2026-01-01T00:00:00Z").getTime() + (ADMIN_SESSION_SECONDS + 1) * 1000);
      expect(await verifyToken(token, "admin")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a guest token valid over a span that expires an admin one", async () => {
    vi.useFakeTimers();
    try {
      const start = new Date("2026-01-01T00:00:00Z").getTime();
      vi.setSystemTime(start);
      const guest = await createToken("guest");
      const admin = await createToken("admin");

      // A day later: the admin session is gone, the guest one is not.
      vi.setSystemTime(start + 24 * 60 * 60 * 1000);
      expect(await verifyToken(admin, "admin")).toBe(false);
      expect(await verifyToken(guest, "guest")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses tokens signed with a different secret", async () => {
    const token = await createToken("admin");
    process.env.AUTH_SECRET = "a-different-secret";
    expect(await verifyToken(token, "admin")).toBe(false);
    process.env.AUTH_SECRET = "test-secret-not-the-real-one";
  });

  it("refuses malformed input rather than throwing", async () => {
    for (const bad of [undefined, "", "not-a-token", "a.b", "a.b.c.d", "guest..sig"]) {
      expect(await verifyToken(bad, "guest")).toBe(false);
    }
  });

  it("throws a directive error when AUTH_SECRET is missing", async () => {
    const saved = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    await expect(createToken("guest")).rejects.toThrow(/AUTH_SECRET/);
    process.env.AUTH_SECRET = saved;
  });
});

describe("session lengths", () => {
  it("keeps admin sessions far shorter than guest ones", () => {
    // The admin cookie is the only thing protecting the guest list, so a
    // forgotten laptop must not stay authorised for weeks.
    expect(sessionSeconds("admin")).toBe(ADMIN_SESSION_SECONDS);
    expect(sessionSeconds("guest")).toBe(GUEST_SESSION_SECONDS);
    expect(ADMIN_SESSION_SECONDS).toBeLessThan(GUEST_SESSION_SECONDS);
  });

  it("marks cookies httpOnly and same-site so they are not readable by script", () => {
    const opts = cookieOptions("admin");
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(ADMIN_SESSION_SECONDS);
  });
});

describe("safeEqual", () => {
  it("matches identical strings and rejects everything else", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("passwordMatches", () => {
  it("accepts the right password and rejects a near miss", async () => {
    expect(await passwordMatches("hunter2", "hunter2")).toBe(true);
    expect(await passwordMatches("hunter3", "hunter2")).toBe(false);
  });

  it("ignores surrounding whitespace, which phone keyboards add", async () => {
    expect(await passwordMatches("  hunter2 ", "hunter2")).toBe(true);
  });

  it("is case sensitive", async () => {
    expect(await passwordMatches("Hunter2", "hunter2")).toBe(false);
  });

  it("never matches when no password is configured", async () => {
    // Otherwise an unset env var would turn into an open door.
    expect(await passwordMatches("anything", undefined)).toBe(false);
    expect(await passwordMatches("", undefined)).toBe(false);
  });
});
