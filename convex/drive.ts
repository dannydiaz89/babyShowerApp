import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import schema from "./schema";
import { assertServer } from "./guard";

/**
 * The hosts' Google Drive connection: one row, or none.
 *
 * The refresh token arrives already sealed by the Next.js server and is
 * stored as given. Convex never sees the plaintext and never talks to
 * Google; both happen in src/lib/google-drive.ts.
 */

async function connectionRow(ctx: { db: import("./_generated/server").DatabaseReader }) {
  return ctx.db
    .query("driveConnection")
    .withIndex("by_singleton", (q) => q.eq("singleton", "drive"))
    .unique();
}

export const get = query({
  args: { key: v.string() },
  returns: v.union(schema.doc("driveConnection"), v.null()),
  handler: async (ctx, { key }) => {
    assertServer(key);
    return connectionRow(ctx);
  },
});

/** Connect, or reconnect: a second connection replaces the first. */
export const set = mutation({
  args: {
    key: v.string(),
    account: v.string(),
    folderId: v.string(),
    folderName: v.string(),
    folderUrl: v.string(),
    refreshTokenSealed: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { key, ...fields }) => {
    assertServer(key);

    const existing = await connectionRow(ctx);
    const doc = { ...fields, singleton: "drive" as const, connectedAt: Date.now() };

    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("driveConnection", doc);
    return null;
  },
});

/**
 * Record whether Google answered.
 *
 * A failure keeps the first `failedAt` so the hosts see when it started,
 * not merely when it was last noticed; a success clears everything but
 * the check time. Reconnecting (`set`) replaces the row and so clears it.
 */
export const setHealth = mutation({
  args: {
    key: v.string(),
    health: v.union(v.literal("ok"), v.literal("failing")),
    kind: v.optional(v.union(v.literal("unavailable"), v.literal("revoked"))),
    message: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { key, health, kind, message }) => {
    assertServer(key);
    const existing = await connectionRow(ctx);
    if (!existing) return null;

    const now = Date.now();
    if (health === "ok") {
      await ctx.db.patch(existing._id, {
        health: "ok",
        failureKind: undefined,
        failureMessage: undefined,
        failedAt: undefined,
        lastCheckedAt: now,
      });
    } else {
      await ctx.db.patch(existing._id, {
        health: "failing",
        failureKind: kind ?? "unavailable",
        failureMessage: message?.slice(0, 500),
        failedAt: existing.health === "failing" ? (existing.failedAt ?? now) : now,
        lastCheckedAt: now,
      });
    }
    return null;
  },
});

/**
 * Claim the right to re-probe a failing connection.
 *
 * Many page loads can notice the interval has passed at once; only the one
 * that moves `lastCheckedAt` forward here gets to probe, so Google sees a
 * single request rather than one per visitor. Only an "unavailable"
 * failure is worth re-probing; a revoked grant needs the hosts.
 */
export const claimProbe = mutation({
  args: { key: v.string(), intervalMs: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { key, intervalMs }) => {
    assertServer(key);
    const existing = await connectionRow(ctx);
    if (!existing || existing.health !== "failing" || existing.failureKind === "revoked") return false;

    const now = Date.now();
    if (now - (existing.lastCheckedAt ?? 0) < intervalMs) return false;

    await ctx.db.patch(existing._id, { lastCheckedAt: now });
    return true;
  },
});

/**
 * Claim the right to reconcile the folder, at most once per interval.
 * Same shape as `claimProbe`: many callers may notice, one gets to go.
 */
export const claimReconcile = mutation({
  args: { key: v.string(), intervalMs: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { key, intervalMs }) => {
    assertServer(key);
    const existing = await connectionRow(ctx);
    if (!existing) return false;
    const now = Date.now();
    if (now - (existing.lastReconciledAt ?? 0) < intervalMs) return false;
    await ctx.db.patch(existing._id, { lastReconciledAt: now });
    return true;
  },
});

/** Where the folder listing should continue next time; absent to start over. */
export const setReconcileCursor = mutation({
  args: { key: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { key, cursor }) => {
    assertServer(key);
    const existing = await connectionRow(ctx);
    if (existing) await ctx.db.patch(existing._id, { reconcileCursor: cursor ?? undefined });
    return null;
  },
});

export const clear = mutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    assertServer(key);
    const existing = await connectionRow(ctx);
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});
