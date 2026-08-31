import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertServer } from "./guard";

const localized = v.object({ en: v.string(), es: v.string() });

/** Everything the admin config form can write. */
export const editableFields = {
  babyName: v.string(),
  honorees: v.string(),
  venueName: v.string(),
  address: v.string(),
  mapsQuery: v.string(),
  startISO: v.string(),
  endISO: v.string(),
  rsvpDeadlineISO: v.string(),
  tagline: localized,
  dressCode: localized,
  notes: localized,
  contactName: v.string(),
  contactEmail: v.string(),
  giftShippingAddress: v.string(),
  registries: v.array(
    v.object({
      name: v.string(),
      url: v.string(),
      description: localized,
      accent: v.string(),
    })
  ),
  mealOptions: v.array(localized),
  askMeal: v.boolean(),
  allowKids: v.boolean(),
  collectPhone: v.boolean(),
};

/** The one settings row, or null if the hosts have never saved. */
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    assertServer(key);
    return ctx.db
      .query("settings")
      .withIndex("by_singleton", (q) => q.eq("singleton", "settings"))
      .unique();
  },
});

export const update = mutation({
  args: { ...editableFields, key: v.string() },
  handler: async (ctx, { key, ...fields }) => {
    assertServer(key);

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_singleton", (q) => q.eq("singleton", "settings"))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { ...fields, updatedAt: Date.now() });
      return;
    }

    await ctx.db.insert("settings", {
      ...fields,
      singleton: "settings" as const,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Store a new guest password. Hashing happens in Next.js; Convex only ever
 * sees the derived key, never the password itself.
 */
export const setGuestPasswordHash = mutation({
  args: { key: v.string(), hash: v.union(v.string(), v.null()) },
  handler: async (ctx, { key, hash }) => {
    assertServer(key);

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_singleton", (q) => q.eq("singleton", "settings"))
      .unique();

    if (!existing) {
      throw new Error("Save your event details before setting a guest password.");
    }

    await ctx.db.patch(existing._id, {
      guestPasswordHash: hash ?? undefined,
      updatedAt: Date.now(),
    });
  },
});
