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

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string, type?: string) => revalidatePath(path, type) }));

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
const { en } = await import("../../src/lib/i18n/dictionaries");
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

/** The action takes the previous state, the way `useActionState` calls it. */
function run(intent: string) {
  return setInviteLink({ status: "idle" }, form(intent));
}

beforeEach(() => {
  cookieJar.clear();
  mutation.mockReset();
  mutation.mockResolvedValue(null);
  revalidatePath.mockClear();
});

describe("setInviteLink authorization", () => {
  it("refuses a caller with no session and writes nothing", async () => {
    await expect(run("create")).rejects.toThrow("Not authorized");
    expect(mutation).not.toHaveBeenCalled();
  });

  it("refuses a guest, who may hold the password but not the dashboard", async () => {
    cookieJar.set(GUEST_COOKIE, await createToken("guest"));

    await expect(run("create")).rejects.toThrow("Not authorized");
    expect(mutation).not.toHaveBeenCalled();
  });

  it("refuses an admin token presented in the guest cookie", async () => {
    cookieJar.set(GUEST_COOKIE, await createToken("admin"));

    await expect(run("create")).rejects.toThrow("Not authorized");
    expect(mutation).not.toHaveBeenCalled();
  });
});

describe("setInviteLink", () => {
  beforeEach(async () => {
    cookieJar.set(ADMIN_COOKIE, await createToken("admin"));
  });

  it("makes a code of the advertised strength", async () => {
    await run("create");
    expect(written()?.code).toHaveLength(INVITE_CODE_LENGTH);
  });

  it("replaces with a different code, so printed cards stop working", async () => {
    await run("create");
    const first = written()?.code;

    mutation.mockClear();
    await run("replace");

    expect(written()?.code).not.toBe(first);
  });

  it("clears the code on remove", async () => {
    await run("remove");
    expect(written()?.code).toBeNull();
  });

  it("treats anything else as a request for a code, never a silent revoke", async () => {
    // The intent arrives in a hidden field, which is to say from the network.
    await run("../remove");
    expect(written()?.code).toHaveLength(INVITE_CODE_LENGTH);
  });
});

/**
 * The finding this exists for: the write was wrapped in a try/catch that
 * logged and returned as though it had worked. A host clicking "remove the
 * link" during an outage was told nothing, the page re-rendered from defaults
 * that carry no code — which reads exactly like "there is no link" — and every
 * printed card went on opening the invitation.
 */
describe("when the write does not go through", () => {
  beforeEach(async () => {
    cookieJar.set(ADMIN_COOKIE, await createToken("admin"));
    mutation.mockRejectedValue(new Error("convex is down"));
  });

  it("says so instead of reporting a revocation that did not happen", async () => {
    const result = await run("remove");

    expect(result.status).toBe("error");
    expect(result.message).toBe(en.settings.inviteFailed);
  });

  it("leaves the page alone, so nothing re-renders as though the link were gone", async () => {
    await run("remove");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a failed create too, rather than an empty panel", async () => {
    expect((await run("create")).status).toBe("error");
  });

  it("still reports failure when only the second write fails", async () => {
    // The row is patched first, then the code is written. Losing the second
    // leaves the stored code exactly as it was — which is the case the host
    // most needs to hear about.
    mutation.mockReset();
    mutation.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("lost"));

    expect((await run("replace")).status).toBe("error");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("a write that goes through", () => {
  beforeEach(async () => {
    cookieJar.set(ADMIN_COOKIE, await createToken("admin"));
  });

  it("reports success and refreshes the page that shows the link", async () => {
    expect((await run("create")).status).toBe("done");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
