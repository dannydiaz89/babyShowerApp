import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../../src/lib/i18n/dictionaries";
import { MAX_TEXT } from "../../src/lib/meals";

/**
 * A Server Action is its own public POST endpoint. Middleware does not run for
 * it, so `/rsvp` being password-gated proves nothing about who can call
 * `submitRsvp` — it has to check for itself, and this is the test that says so.
 */

process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.ADMIN_API_KEY = "test-key";
process.env.CONVEX_URL = "https://example.convex.cloud";

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

const mutation = vi.fn();
vi.mock("@/lib/convex", () => ({
  convexClient: () => ({ mutation, query: vi.fn() }),
  convexKey: () => "test-key",
}));

vi.mock("@/lib/settings", async () => {
  const { DEFAULT_SETTINGS: defaults } = await import("../../src/lib/defaults");
  return {
    getSettings: async () => ({ ...defaults, isConfigured: true, available: true }),
  };
});

const { submitRsvp } = await import("../../src/app/rsvp/actions");
const { createToken, GUEST_COOKIE, ADMIN_COOKIE } = await import("../../src/lib/auth");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const VALID = {
  name: "Elena Vargas",
  email: "elena@example.com",
  attending: "yes",
  adults: "2",
  kids: "0",
};

beforeEach(() => {
  cookieJar.clear();
  mutation.mockReset();
  // The limiter and the write are the only two mutations on this path, and
  // only the limiter takes a window.
  mutation.mockImplementation(async (_fn: unknown, args: Record<string, unknown>) =>
    "windowMs" in args ? { allowed: true, retryAfterMs: 0 } : { updated: false }
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("submitRsvp authorization", () => {
  it("refuses a caller with no session and writes nothing", async () => {
    const result = await submitRsvp({ status: "idle" }, form(VALID));

    expect(result.status).toBe("error");
    expect(result.message).toBe(en.rsvp.errSignedOut);
    // The point of the finding: not one Convex call, so no fake RSVP and no
    // overwrite of a real guest's answer by their guessable email address.
    expect(mutation).not.toHaveBeenCalled();
  });

  it("refuses a guest cookie that has been tampered with", async () => {
    const token = await createToken("guest");
    cookieJar.set(GUEST_COOKIE, token.replace(/.$/, (c) => (c === "a" ? "b" : "a")));

    const result = await submitRsvp({ status: "idle" }, form(VALID));

    expect(result.message).toBe(en.rsvp.errSignedOut);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("refuses an admin token presented in the guest cookie", async () => {
    cookieJar.set(GUEST_COOKIE, await createToken("admin"));

    const result = await submitRsvp({ status: "idle" }, form(VALID));

    expect(result.message).toBe(en.rsvp.errSignedOut);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("refuses an expired guest session", async () => {
    const token = await createToken("guest");
    cookieJar.set(GUEST_COOKIE, token);

    // A month and a day later, past GUEST_SESSION_SECONDS.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);

    const result = await submitRsvp({ status: "idle" }, form(VALID));

    expect(result.message).toBe(en.rsvp.errSignedOut);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("accepts a signed-in guest", async () => {
    cookieJar.set(GUEST_COOKIE, await createToken("guest"));

    const result = await submitRsvp({ status: "idle" }, form(VALID));

    expect(result.status).toBe("success");
    // Rate limit, then the write.
    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it("accepts a host, who can already reach every guest page", async () => {
    cookieJar.set(ADMIN_COOKIE, await createToken("admin"));

    const result = await submitRsvp({ status: "idle" }, form(VALID));

    expect(result.status).toBe("success");
  });

  it("still rejects invalid input from a signed-in guest", async () => {
    cookieJar.set(GUEST_COOKIE, await createToken("guest"));

    const result = await submitRsvp({ status: "idle" }, form({ ...VALID, name: "" }));

    expect(result.status).toBe("error");
    expect(result.errors?.name).toBe(en.rsvp.errNameRequired);
    expect(mutation).not.toHaveBeenCalled();
  });
});

/**
 * The form renders a <select>, but this action is reachable by POST without
 * it. Whatever arrives becomes an entry in the dashboard's one shared totals
 * document, so an unchecked meal is an availability problem: enough distinct
 * or long values push that document past Convex's size limit, and from then
 * on every RSVP write — everyone's — rolls back.
 */
describe("submitRsvp meal validation", () => {
  beforeEach(async () => {
    cookieJar.set(GUEST_COOKIE, await createToken("guest"));
  });

  it("accepts a meal the hosts put on the menu", async () => {
    const result = await submitRsvp({ status: "idle" }, form({ ...VALID, meal: "Vegan" }));

    expect(result.status).toBe("success");
  });

  it("accepts the Spanish label for the same option", async () => {
    const result = await submitRsvp({ status: "idle" }, form({ ...VALID, meal: "Vegano" }));

    expect(result.status).toBe("success");
  });

  it("refuses a meal that is not on the menu, and writes nothing", async () => {
    const result = await submitRsvp(
      { status: "idle" },
      form({ ...VALID, meal: "junk-meal-0" })
    );

    expect(result.status).toBe("error");
    expect(result.errors?.meal).toBe(en.rsvp.errMealInvalid);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("refuses a label long enough to bloat the shared totals document", async () => {
    const result = await submitRsvp(
      { status: "idle" },
      form({ ...VALID, meal: "X".repeat(4000) })
    );

    expect(result.errors?.meal).toBe(en.rsvp.errMealInvalid);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("still accepts a reply with no meal chosen", async () => {
    const result = await submitRsvp({ status: "idle" }, form(VALID));

    expect(result.status).toBe("success");
  });

  it("caps free text a guest could otherwise use to bloat the guest list", async () => {
    await submitRsvp(
      { status: "idle" },
      form({ ...VALID, message: "x".repeat(10_000) })
    );

    const [, written] = mutation.mock.calls.at(-1)!;
    expect(String(written.message)).toHaveLength(MAX_TEXT);
  });
});
