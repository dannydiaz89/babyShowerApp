import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/lib/defaults";

/**
 * The QR route is a public GET that hands out a month-long session. Middleware
 * does not gate it — it cannot, since the whole point is admitting someone who
 * has no cookie yet — so every rule that keeps it honest lives in the handler,
 * and these are the assertions that say so.
 */

process.env.AUTH_SECRET = "test-secret-not-a-real-one";
process.env.ADMIN_API_KEY = "test-key";
process.env.CONVEX_URL = "https://example.convex.cloud";

const CODE = "7QK4M2XR9T";

const cookieJar = new Map<string, string>();
let address = "203.0.113.9";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined,
  }),
  headers: async () => new Headers({ "x-forwarded-for": address }),
}));

const mutation = vi.fn();
vi.mock("@/lib/convex", () => ({
  convexClient: () => ({ mutation, query: vi.fn() }),
  convexKey: () => "test-key",
}));

let settings: Record<string, unknown>;
vi.mock("@/lib/settings", () => ({ getSettings: async () => settings }));

const { GET } = await import("../../src/app/i/[code]/route");
const { api } = await import("../../convex/_generated/api");
const { getFunctionName } = await import("convex/server");
const { createToken, GUEST_COOKIE, verifyToken } = await import("../../src/lib/auth");

function scan(code: string, query = "") {
  return GET(new Request(`https://shower.example/i/${code}${query}`), {
    params: Promise.resolve({ code }),
  });
}

/** The guest cookie a response sets, if it sets one. */
function mintedCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${GUEST_COOKIE}=`));
}

/**
 * Calls to one Convex function. Compared by the name the reference resolves
 * to: the generated `api` is a proxy, so two reads of it are not the same
 * object and `===` would quietly match nothing.
 */
function callsTo(ref: Parameters<typeof getFunctionName>[0]): unknown[][] {
  const name = getFunctionName(ref);
  return mutation.mock.calls.filter(([called]) => getFunctionName(called) === name);
}

beforeEach(() => {
  cookieJar.clear();
  mutation.mockReset();
  mutation.mockResolvedValue({ blocked: false, retryAfterMs: 0 });
  address = "203.0.113.9";
  settings = {
    ...DEFAULT_SETTINGS,
    inviteCode: CODE,
    isConfigured: true,
    available: true,
  };
});

describe("a scanned invitation", () => {
  it("signs the guest in and sends them to the invitation", async () => {
    const response = await scan(CODE);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://shower.example/invitation");

    const cookie = mintedCookie(response);
    expect(cookie).toBeDefined();
    // Not just any string: a token this server will accept as a guest.
    const value = cookie!.slice(`${GUEST_COOKIE}=`.length).split(";")[0];
    expect(await verifyToken(decodeURIComponent(value), "guest")).not.toBeNull();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
  });

  it("is never cached, since the code can be revoked between two scans", async () => {
    const response = await scan(CODE);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("matches however the phone mangled the code", async () => {
    expect(mintedCookie(await scan(CODE.toLowerCase()))).toBeDefined();
  });

  it("takes a table card to the photo wall", async () => {
    const response = await scan(CODE, "?next=%2Fphotos");
    expect(response.headers.get("location")).toBe("https://shower.example/photos");
  });

  it("refuses to be an open redirect", async () => {
    const response = await scan(CODE, "?next=https%3A%2F%2Fevil.example%2Fsteal");
    expect(response.headers.get("location")).toBe("https://shower.example/invitation");
  });

  it("clears the failure counter, like a correct password does", async () => {
    await scan(CODE);
    expect(callsTo(api.rateLimit.succeed)).toHaveLength(1);
  });
});

describe("a code that does not work", () => {
  it("mints nothing and says so at the gate", async () => {
    const response = await scan("AAAAAAAAAA");

    expect(mintedCookie(response)).toBeUndefined();
    expect(response.headers.get("location")).toBe("https://shower.example/?link=stale");
  });

  it("counts against the lockout, in its own bucket", async () => {
    await scan("AAAAAAAAAA");

    const [fail] = callsTo(api.rateLimit.fail);
    expect(fail).toBeDefined();
    // Not the password's bucket: a guest with an out-of-date card must not
    // scan themselves out of the form they are about to be told to use.
    expect((fail[1] as { id: string }).id).toBe("invite:203.0.113.9");
  });

  it("remembers where a table card was headed", async () => {
    const response = await scan("AAAAAAAAAA", "?next=%2Fphotos");
    expect(response.headers.get("location")).toBe(
      "https://shower.example/?next=%2Fphotos&link=stale"
    );
  });

  it("admits nobody when the hosts have made no link", async () => {
    settings = { ...settings, inviteCode: undefined };

    expect(mintedCookie(await scan(""))).toBeUndefined();
    expect(mintedCookie(await scan("undefined"))).toBeUndefined();
    expect(mintedCookie(await scan(CODE))).toBeUndefined();
  });
});

describe("when the limiter has this address locked out", () => {
  beforeEach(() => {
    mutation.mockResolvedValue({ blocked: true, retryAfterMs: 60_000 });
  });

  it("refuses even the right code", async () => {
    const response = await scan(CODE);

    expect(mintedCookie(response)).toBeUndefined();
    expect(response.headers.get("location")).toBe("https://shower.example/?link=stale");
  });

  it("does not keep counting failures while locked", async () => {
    await scan("AAAAAAAAAA");
    expect(callsTo(api.rateLimit.fail)).toHaveLength(0);
  });
});

describe("when Convex cannot be reached", () => {
  it("fails closed rather than minting a month on a guess", async () => {
    settings = { ...DEFAULT_SETTINGS, isConfigured: false, available: false };

    const response = await scan(CODE);

    expect(mintedCookie(response)).toBeUndefined();
    // No accusation either: the link may well be fine, we just cannot tell.
    expect(response.headers.get("location")).toBe("https://shower.example/");
  });

  it("still admits a right code when only the limiter is down", async () => {
    mutation.mockRejectedValue(new Error("convex is down"));

    expect(mintedCookie(await scan(CODE))).toBeDefined();
  });
});

describe("a guest who is already signed in", () => {
  beforeEach(async () => {
    cookieJar.set(GUEST_COOKIE, await createToken("guest"));
  });

  it("is sent on when their card turns out to be out of date", async () => {
    const response = await scan("AAAAAAAAAA", "?next=%2Fphotos");

    expect(response.headers.get("location")).toBe("https://shower.example/photos");
    // The dead code granted them nothing they did not already have, so it is
    // not held against them.
    expect(callsTo(api.rateLimit.fail)).toHaveLength(0);
  });

  it("is still turned away once the hosts revoke their session", async () => {
    settings = { ...settings, guestSessionEpoch: Date.now() + 60_000 };

    const response = await scan("AAAAAAAAAA");
    expect(response.headers.get("location")).toBe("https://shower.example/?link=stale");
  });
});
