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
