import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import schema from "./schema";
import { assertServer } from "./guard";

const localized = v.object({ en: v.string(), es: v.string() });

/** Everything the admin config form can write. */
export const editable = v.object({
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
});

/** The one settings row, or null if the hosts have never saved. */
export const get = query({
  args: { key: v.string() },
  returns: v.union(schema.doc("settings"), v.null()),
  handler: async (ctx, { key }) => {
    assertServer(key);
    return ctx.db
      .query("settings")
      .withIndex("by_singleton", (q) => q.eq("singleton", "settings"))
      .unique();
  },
});

/**
 * Save one section of the settings.
 *
 * Only the fields in `fields` are written, and they are read-modify-written
 * inside this transaction rather than by the caller. Two hosts saving
 * different tabs from the same page load therefore each change only their own
 * section, instead of the second save restoring the snapshot the first one
 * replaced.
 *
 * `defaults` is used only when no row exists yet: a first save has to produce
 * a complete document, and the built-in defaults live in the Next.js app.
 */
export const update = mutation({
  args: { key: v.string(), fields: editable.partial(), defaults: editable },
  returns: v.null(),
  handler: async (ctx, { key, fields, defaults }) => {
    assertServer(key);

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_singleton", (q) => q.eq("singleton", "settings"))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { ...fields, updatedAt: Date.now() });
      return null;
    }

    await ctx.db.insert("settings", {
      ...defaults,
      ...fields,
      singleton: "settings" as const,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Store a new guest password. Hashing happens in Next.js; Convex only ever
 * sees the derived key, never the password itself.
 *
 * Also moves `guestSessionEpoch` forward, which is what makes a rotation take
 * effect. Guest cookies are signed rather than stored, so there is no session
 * row to delete: without this, everyone who signed in under the old password
 * would keep their access for the remaining 30 days of their cookie, and the
 * hosts would have no way to tell. Clearing the password (`hash: null`) counts
 * too — falling back to the environment variable is still a change of
 * credential, and anyone holding a cookie should have to prove they know it.
 */
export const setGuestPasswordHash = mutation({
  args: { key: v.string(), hash: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { key, hash }) => {
    assertServer(key);

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_singleton", (q) => q.eq("singleton", "settings"))
      .unique();

    if (!existing) {
      throw new Error("Save your event details before setting a guest password.");
    }

    const now = Date.now();
    await ctx.db.patch(existing._id, {
      guestPasswordHash: hash ?? undefined,
      guestSessionEpoch: now,
      updatedAt: now,
    });
    return null;
  },
});
