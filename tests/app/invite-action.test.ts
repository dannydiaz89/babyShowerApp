import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Making a link writes a credential, and a Server Action is a public POST that
 * middleware never sees. If this one did not check the admin cookie for
 * itself, anyone who guessed the action's id could mint themselves an invite
 * link — or revoke the hosts' one the night before the shower.
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

const { setInviteLink } = await import("../../src/app/admin/settings/actions");
const { createToken, ADMIN_COOKIE, GUEST_COOKIE } = await import("../../src/lib/auth");
const { api } = await import("../../convex/_generated/api");
const { getFunctionName } = await import("convex/server");
const { INVITE_CODE_LENGTH } = await import("../../src/lib/invite");

function form(intent: string): FormData {
  const data = new FormData();
  data.append("intent", intent);
  return data;
}

/** What was written to the invite code, if anything. */
function written(): { code: string | null } | undefined {
  const call = mutation.mock.calls.find(
    ([ref]) => getFunctionName(ref) === getFunctionName(api.settings.setInviteCode)
  );
  return call?.[1] as { code: string | null } | undefined;
}

beforeEach(() => {
  cookieJar.clear();
  mutation.mockReset();
  mutation.mockResolvedValue(null);
});

describe("setInviteLink authorization", () => {
  it("refuses a caller with no session and writes nothing", async () => {
    await expect(setInviteLink(form("create"))).rejects.toThrow("Not authorized");
    expect(mutation).not.toHaveBeenCalled();
  });

  it("refuses a guest, who may hold the password but not the dashboard", async () => {
    cookieJar.set(GUEST_COOKIE, await createToken("guest"));

    await expect(setInviteLink(form("create"))).rejects.toThrow("Not authorized");
    expect(mutation).not.toHaveBeenCalled();
  });

  it("refuses an admin token presented in the guest cookie", async () => {
    cookieJar.set(GUEST_COOKIE, await createToken("admin"));

    await expect(setInviteLink(form("create"))).rejects.toThrow("Not authorized");
    expect(mutation).not.toHaveBeenCalled();
  });
});

describe("setInviteLink", () => {
  beforeEach(async () => {
    cookieJar.set(ADMIN_COOKIE, await createToken("admin"));
  });

  it("makes a code of the advertised strength", async () => {
    await setInviteLink(form("create"));
    expect(written()?.code).toHaveLength(INVITE_CODE_LENGTH);
  });

  it("replaces with a different code, so printed cards stop working", async () => {
    await setInviteLink(form("create"));
    const first = written()?.code;

    mutation.mockClear();
    await setInviteLink(form("replace"));

    expect(written()?.code).not.toBe(first);
  });

  it("clears the code on remove", async () => {
    await setInviteLink(form("remove"));
    expect(written()?.code).toBeNull();
  });

  it("treats anything else as a request for a code, never a silent revoke", async () => {
    // The intent arrives in a hidden field, which is to say from the network.
    await setInviteLink(form("../remove"));
    expect(written()?.code).toHaveLength(INVITE_CODE_LENGTH);
  });
});
