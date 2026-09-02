// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";

/**
 * A counter that can be given back is what makes "sessions left open" a
 * measurable thing: opened counts up, finished counts down, and only what
 * was never finished stays.
 */

const KEY = "test-server-key";
process.env.ADMIN_API_KEY = KEY;

const modules = import.meta.glob("../../convex/**/*.ts");

describe("rateLimit.release", () => {
  it("gives one count back, so open-then-finish leaves the counter where it started", async () => {
    const t = convexTest(schema, modules);
    const id = "photos:outstanding:ip:203.0.113.9";
    const limit = 2;

    await t.mutation(api.rateLimit.consume, { key: KEY, id, limit, windowMs: 60_000 });
    await t.mutation(api.rateLimit.consume, { key: KEY, id, limit, windowMs: 60_000 });
    // Two open: the third is refused.
    const refused = await t.mutation(api.rateLimit.consume, { key: KEY, id, limit, windowMs: 60_000 });
    expect(refused.allowed).toBe(false);

    // One finished: there is room again.
    await t.mutation(api.rateLimit.release, { key: KEY, id });
    const allowed = await t.mutation(api.rateLimit.consume, { key: KEY, id, limit, windowMs: 60_000 });
    expect(allowed.allowed).toBe(true);
  });

  it("never goes below zero, and is a no-op for a counter that does not exist", async () => {
    const t = convexTest(schema, modules);
    const id = "photos:outstanding:ip:198.51.100.1";

    await t.mutation(api.rateLimit.release, { key: KEY, id });
    await t.mutation(api.rateLimit.consume, { key: KEY, id, limit: 1, windowMs: 60_000 });
    await t.mutation(api.rateLimit.release, { key: KEY, id });
    await t.mutation(api.rateLimit.release, { key: KEY, id });

    // Still one allowed, because the count is zero, not negative.
    const one = await t.mutation(api.rateLimit.consume, { key: KEY, id, limit: 1, windowMs: 60_000 });
    const two = await t.mutation(api.rateLimit.consume, { key: KEY, id, limit: 1, windowMs: 60_000 });
    expect(one.allowed).toBe(true);
    expect(two.allowed).toBe(false);
  });

  it("refuses a caller without the server key", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.rateLimit.release, { key: "wrong", id: "x" })).rejects.toThrow(/Not authorized/);
  });
});
