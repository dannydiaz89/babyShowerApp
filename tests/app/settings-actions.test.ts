import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the settings form is told after a save. One click should produce one
 * answer: the access tab used to reply "Saved. The site is updated." and
 * "Guest password updated." together, two banners for the same click, the
 * vaguer one on top.
 */

process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.ADMIN_API_KEY = "test-key";
process.env.CONVEX_URL = "https://example.convex.cloud";

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined,
  }),
  headers: async () => new Headers(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mutation = vi.fn();
vi.mock("@/lib/convex", () => ({
  convexClient: () => ({ mutation, query: vi.fn() }),
  convexKey: () => "test-key",
}));

vi.mock("@/lib/settings", async () => {
  const { DEFAULT_SETTINGS } = await import("../../src/lib/defaults");
  return {
    getSettings: async () => ({ ...DEFAULT_SETTINGS, isConfigured: true, available: true }),
  };
});

const { saveSettings } = await import("../../src/app/admin/settings/actions");
const { createToken, ADMIN_COOKIE } = await import("../../src/lib/auth");
const { en } = await import("../../src/lib/i18n/dictionaries");

function save(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return saveSettings({ status: "idle" }, data);
}

beforeEach(async () => {
  cookieJar.clear();
  cookieJar.set(ADMIN_COOKIE, await createToken("admin"));
  mutation.mockReset();
  mutation.mockResolvedValue(null);
});

describe("saving the access tab", () => {
  it("answers a password change once, with the line about the password", async () => {
    const result = await save({ tab: "access", guestPassword: "a-long-enough-one" });

    expect(result.passwordMessage).toBe(en.settings.guestPasswordSaved);
    expect(result.passwordOk).toBe(true);
    // The generic line would be a second banner saying less than the first.
    expect(result.message).toBeUndefined();
  });

  it("still says something when the field was left blank", async () => {
    // Blank means "keep the current password", and the host who pressed Save
    // should not be left wondering whether it took.
    const result = await save({ tab: "access", guestPassword: "" });

    expect(result.status).toBe("saved");
    expect(result.message).toBe(en.settings.saved);
    expect(result.passwordMessage).toBeUndefined();
  });

  it("gives the password's own complaint, and no success beside it", async () => {
    const result = await save({ tab: "access", guestPassword: "short" });

    expect(result.status).toBe("error");
    expect(result.passwordMessage).toBe(en.settings.guestPasswordTooShort);
    expect(result.message).toBeUndefined();
  });
});

describe("saving any other tab", () => {
  it("still answers with the generic line", async () => {
    const result = await save({ tab: "wording" });

    expect(result.status).toBe("saved");
    expect(result.message).toBe(en.settings.saved);
    expect(result.passwordMessage).toBeUndefined();
  });
});
