import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertServer } from "./guard";

const MINUTE = 60 * 1000;

/**
 * A shared password is only as strong as the number of guesses an attacker
 * gets. The admin limit is tighter because that password is the only thing
 * standing between a stranger and the whole guest list.
 */
const POLICY = {
  guest: { window: 15 * MINUTE, maxFailures: 10, baseLock: 15 * MINUTE },
  admin: { window: 15 * MINUTE, maxFailures: 5, baseLock: 30 * MINUTE },
} as const;

export type Role = keyof typeof POLICY;

const verdict = v.object({ blocked: v.boolean(), retryAfterMs: v.number() });

function policyFor(role: string) {
  return POLICY[role as Role] ?? POLICY.admin;
}

/**
 * Is this client currently locked out?
 *
 * A mutation rather than a query on purpose. Convex reruns a query when the
 * data it read changes, never merely because time has passed, so a cached
 * `{blocked: true}` would outlive the lock it describes — and nothing on the
 * sign-in path writes to the row while a client is locked out, so nothing
 * would ever invalidate it. Reading the clock here also lets an expired lock
 * be cleared the moment it is noticed, instead of lingering on the row.
 */
export const check = mutation({
  args: { key: v.string(), id: v.string() },
  returns: verdict,
  handler: async (ctx, { key, id }) => {
    assertServer(key);

    const row = await ctx.db
      .query("loginAttempts")
      .withIndex("by_key", (q) => q.eq("key", id))
      .unique();

    if (!row?.lockedUntil) return { blocked: false, retryAfterMs: 0 };

    const now = Date.now();
    if (row.lockedUntil <= now) {
      await ctx.db.patch(row._id, { lockedUntil: undefined });
      return { blocked: false, retryAfterMs: 0 };
    }

    return { blocked: true, retryAfterMs: row.lockedUntil - now };
  },
});

/** Record a wrong password and lock the client out once it gets suspicious. */
export const fail = mutation({
  args: { key: v.string(), id: v.string(), role: v.string() },
  returns: verdict,
  handler: async (ctx, { key, id, role }) => {
    assertServer(key);

    const { window, maxFailures, baseLock } = policyFor(role);
    const now = Date.now();

    const row = await ctx.db
      .query("loginAttempts")
      .withIndex("by_key", (q) => q.eq("key", id))
      .unique();

    if (!row) {
      await ctx.db.insert("loginAttempts", { key: id, failures: 1, windowStart: now });
      return { blocked: false, retryAfterMs: 0 };
    }

    // A quiet period wipes the slate, so an honest typo months ago doesn't count.
    const expired = now - row.windowStart > window;
    const failures = expired ? 1 : row.failures + 1;
    const windowStart = expired ? now : row.windowStart;

    if (failures < maxFailures) {
      await ctx.db.patch(row._id, { failures, windowStart, lockedUntil: undefined });
      return { blocked: false, retryAfterMs: 0 };
    }

    // Each failure past the threshold doubles the wait, up to 8x.
    const overage = Math.min(failures - maxFailures, 3);
    const lockMs = baseLock * Math.pow(2, overage);
    const lockedUntil = now + lockMs;

    await ctx.db.patch(row._id, { failures, windowStart, lockedUntil });
    return { blocked: true, retryAfterMs: lockMs };
  },
});

/** A correct password clears the counter. */
export const succeed = mutation({
  args: { key: v.string(), id: v.string() },
  returns: v.null(),
  handler: async (ctx, { key, id }) => {
    assertServer(key);

    const row = await ctx.db
      .query("loginAttempts")
      .withIndex("by_key", (q) => q.eq("key", id))
      .unique();

    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

/**
 * Give one count back, for a counter that measures things left open.
 *
 * The photo routes count Drive sessions opened per address and hand the
 * count back when the upload is finished, so what the limit measures is
 * sessions opened and never finished — which honest guests never
 * accumulate, however many share the venue's Wi-Fi, and a script that
 * uploads originals without recording them accumulates at once.
 */
export const release = mutation({
  args: { key: v.string(), id: v.string() },
  returns: v.null(),
  handler: async (ctx, { key, id }) => {
    assertServer(key);

    const row = await ctx.db
      .query("loginAttempts")
      .withIndex("by_key", (q) => q.eq("key", id))
      .unique();

    if (row && row.failures > 0) await ctx.db.patch(row._id, { failures: row.failures - 1 });
    return null;
  },
});

/**
 * A generic "how many times in a window" counter, used to stop someone with
 * the guest password from flooding the RSVP list and wrecking the headcount.
 * Unlike `fail`, this counts every call, not just failures.
 */
export const consume = mutation({
  args: {
    key: v.string(),
    id: v.string(),
    limit: v.number(),
    windowMs: v.number(),
  },
  returns: v.object({ allowed: v.boolean(), retryAfterMs: v.number() }),
  handler: async (ctx, { key, id, limit, windowMs }) => {
    assertServer(key);

    const now = Date.now();
    const row = await ctx.db
      .query("loginAttempts")
      .withIndex("by_key", (q) => q.eq("key", id))
      .unique();

    if (!row) {
      await ctx.db.insert("loginAttempts", { key: id, failures: 1, windowStart: now });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (now - row.windowStart > windowMs) {
      await ctx.db.patch(row._id, { failures: 1, windowStart: now });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (row.failures >= limit) {
      return { allowed: false, retryAfterMs: row.windowStart + windowMs - now };
    }

    await ctx.db.patch(row._id, { failures: row.failures + 1 });
    return { allowed: true, retryAfterMs: 0 };
  },
});
