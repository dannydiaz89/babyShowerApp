import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/lib/defaults";

/**
 * Rotating the guest password has to actually revoke access.
 *
 * Guest cookies are signed rather than stored, so nothing on the server expires
 * when the hosts set a new password — the old cookie stays validly signed for
 * its full 30 days. `guestSessionEpoch` is what closes that: these are the
 * assertions that say a cookie minted before the change no longer works.
 */

process.env.AUTH_SECRET = "test-secret-not-a-real-one";

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined,
  }),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

let settings: Record<string, unknown>;
vi.mock("@/lib/settings", () => ({ getSettings: async () => settings }));

const { hasGuestAccess, isAdminSession, requireGuestAccess } = await import(
  "../../src/lib/session"
);
const { createToken, GUEST_COOKIE, ADMIN_COOKIE } = await import("../../src/lib/auth");

/** Settings as they read when the hosts changed the password at `epoch`. */
function withEpoch(epoch: number | undefined) {
  return {
    ...DEFAULT_SETTINGS,
    guestSessionEpoch: epoch,
    isConfigured: true,
    available: true,
  };
}

beforeEach(() => {
  cookieJar.clear();
  redirect.mockClear();
  settings = withEpoch(undefined);
});

describe("hasGuestAccess", () => {
  it("admits a guest whose cookie postdates the last password change", async () => {
    const before = Date.now() - 60_000;
    settings = withEpoch(before);
    cookieJar.set(GUEST_COOKIE, await createToken("guest"));
    expect(await hasGuestAccess()).toBe(true);
  });

  it("admits a guest when the password has never been changed", async () => {
    cookieJar.set(GUEST_COOKIE, await createToken("guest"));
    expect(await hasGuestAccess()).toBe(true);
  });

  it("refuses a cookie minted before the password changed", async () => {
    // The finding this exists for: the hosts rotate the password to cut
    // someone off, and without the epoch that person keeps access for 30 days.
    vi.useFakeTimers();
    try {
      const signedInAt = new Date("2026-01-01T00:00:00Z").getTime();
      vi.setSystemTime(signedInAt);
      cookieJar.set(GUEST_COOKIE, await createToken("guest"));

      // Still well inside the 30-day cookie lifetime.
      vi.setSystemTime(signedInAt + 24 * 60 * 60 * 1000);
      expect(await hasGuestAccess()).toBe(true);

      // The hosts change the password an hour after that guest signed in.
      settings = withEpoch(signedInAt + 60 * 60 * 1000);
      expect(await hasGuestAccess()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still admits a signed-in host after a guest password change", async () => {
    // Admin is the higher privilege and a separate credential; rotating the
    // guest password should not sign the hosts out of their own dashboard.
    settings = withEpoch(Date.now() + 60_000);
    cookieJar.set(ADMIN_COOKIE, await createToken("admin"));
    expect(await hasGuestAccess()).toBe(true);
  });

  it("fails closed when settings cannot be read", async () => {
    // An outage means we cannot tell whether the cookie predates a rotation.
    // Guessing "it doesn't" hands a revoked guest their access back.
    cookieJar.set(GUEST_COOKIE, await createToken("guest"));
    settings = { ...DEFAULT_SETTINGS, isConfigured: false, available: false };
    expect(await hasGuestAccess()).toBe(false);
  });

  it("refuses a visitor with no cookie at all", async () => {
    expect(await hasGuestAccess()).toBe(false);
  });
});

describe("isAdminSession", () => {
  it("is true only for a valid admin cookie", async () => {
    expect(await isAdminSession()).toBe(false);
    cookieJar.set(GUEST_COOKIE, await createToken("guest"));
    expect(await isAdminSession()).toBe(false);
    cookieJar.set(ADMIN_COOKIE, await createToken("admin"));
    expect(await isAdminSession()).toBe(true);
  });
});

describe("requireGuestAccess", () => {
  it("lets a current guest through without redirecting", async () => {
    cookieJar.set(GUEST_COOKIE, await createToken("guest"));
    await expect(requireGuestAccess("/rsvp")).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends a revoked guest back to the gate, remembering where they were", async () => {
    cookieJar.set(GUEST_COOKIE, await createToken("guest"));
    settings = withEpoch(Date.now() + 60_000);
    await expect(requireGuestAccess("/rsvp")).rejects.toThrow("REDIRECT:");
    expect(redirect).toHaveBeenCalledWith("/?next=%2Frsvp");
  });
});
