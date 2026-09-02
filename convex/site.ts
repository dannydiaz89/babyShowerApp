import { internalQuery, mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertServer } from "./guard";

/** Where the site is, recorded by the site itself. See the schema for why. */

/** Remember the site's origin. Cheap when nothing changed: one read, no write. */
export const register = mutation({
  args: { key: v.string(), url: v.string() },
  returns: v.null(),
  handler: async (ctx, { key, url }) => {
    assertServer(key);
    const existing = await ctx.db
      .query("site")
      .withIndex("by_singleton", (q) => q.eq("singleton", "site"))
      .unique();
    if (existing?.url === url) return null;
    if (existing) await ctx.db.patch(existing._id, { url, seenAt: Date.now() });
    else await ctx.db.insert("site", { singleton: "site", url, seenAt: Date.now() });
    return null;
  },
});

/** For the cron only; not part of the public API. */
export const get = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("site")
      .withIndex("by_singleton", (q) => q.eq("singleton", "site"))
      .unique();
    return row?.url ?? null;
  },
});
