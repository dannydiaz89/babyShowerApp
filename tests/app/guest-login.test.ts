import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../../src/lib/i18n/dictionaries";

/**
 * The guest password can be rotated from the admin page, at which point the
 * stored hash is the only one that counts and SITE_PASSWORD is history. If a
 * Convex outage is read as "nothing stored", that retired password quietly
 * works again — and the session it issues lasts thirty days, so it keeps
 * working long after the database comes back.
 */

process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.SITE_PASSWORD = "the-old-retired-password";

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined,
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));

// redirect() is how a successful sign-in ends; in Next it throws to unwind the
// render, so it is recorded rather than run.
const redirected = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirected(to);
    throw new Error("NEXT_REDIRECT");
  },
}));

const mutation = vi.fn();
vi.mock("@/lib/convex", () => ({
  convexClient: () => ({ mutation, query: vi.fn() }),
  convexKey: () => "test-key",
}));

const settings = vi.fn();
vi.mock("@/lib/settings", () => ({ getSettings: () => settings() }));

const { guestLogin } = await import("../../src/app/actions");
const { hashPassword } = await import("../../src/lib/password");
const { DEFAULT_SETTINGS } = await import("../../src/lib/defaults");

const STORED_PASSWORD = "the-current-password";

function form(password: string): FormData {
  const data = new FormData();
  data.append("password", password);
  return data;
}

/** No lockout, and nothing recorded unless the action asks for it. */
function limiterIsHappy() {
  mutation.mockImplementation(async () => ({ blocked: false, retryAfterMs: 0 }));
}

beforeEach(() => {
  cookieJar.clear();
  mutation.mockReset();
  redirected.mockReset();
  limiterIsHappy();
});

describe("guestLogin when the settings cannot be read", () => {
  beforeEach(() => {
    settings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      isConfigured: false,
      available: false,
    });
  });

  it("refuses the retired environment password instead of falling back to it", async () => {
    const result = await guestLogin({}, form(process.env.SITE_PASSWORD!));

    expect(result.error).toBe(en.gate.unavailable);
    expect(redirected).not.toHaveBeenCalled();
    expect(cookieJar.size).toBe(0);
  });

  it("says the site is unavailable rather than that the password is wrong", async () => {
    const result = await guestLogin({}, form("anything at all"));

    expect(result.error).toBe(en.gate.unavailable);
    expect(result.error).not.toBe(en.gate.wrong);
  });

  it("does not count the attempt against the guest, whose fault it is not", async () => {
    await guestLogin({}, form("anything at all"));

    // Only the lockout check ran; no failure was recorded.
    expect(mutation).toHaveBeenCalledTimes(1);
  });
});

describe("guestLogin when the settings are readable", () => {
  beforeEach(async () => {
    settings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      guestPasswordHash: await hashPassword(STORED_PASSWORD),
      isConfigured: true,
      available: true,
    });
  });

  it("accepts the stored password", async () => {
    await expect(guestLogin({}, form(STORED_PASSWORD))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected).toHaveBeenCalledWith("/invitation");
  });

  it("refuses the environment password once one is stored", async () => {
    const result = await guestLogin({}, form(process.env.SITE_PASSWORD!));

    expect(result.error).toBe(en.gate.wrong);
    expect(redirected).not.toHaveBeenCalled();
  });

  it("falls back to the environment password only when none is stored", async () => {
    settings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      isConfigured: true,
      available: true,
    });

    await expect(
      guestLogin({}, form(process.env.SITE_PASSWORD!))
    ).rejects.toThrow("NEXT_REDIRECT");
  });

  it("sends the guest to a checked destination, never off-site", async () => {
    const data = form(STORED_PASSWORD);
    data.append("next", "https://attacker.example");

    await expect(guestLogin({}, data)).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected).toHaveBeenCalledWith("/invitation");
  });
});
