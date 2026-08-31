import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertServer } from "./guard";

const rsvpFields = {
  name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  attending: v.boolean(),
  adults: v.number(),
  kids: v.number(),
  guestNames: v.optional(v.string()),
  meal: v.optional(v.string()),
  dietaryNotes: v.optional(v.string()),
  message: v.optional(v.string()),
};

/** Lowercased, so casing never splits one guest into two rows. */
export function toEmailKey(email: string | undefined): string | undefined {
  const value = email?.trim().toLowerCase();
  return value ? value : undefined;
}

/**
 * Digits only, so the same number typed three different ways still matches.
 * Long-distance and country prefixes are dropped to the last ten digits, which
 * is what people actually vary between submissions.
 */
export function toPhoneKey(phone: string | undefined): string | undefined {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return undefined;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Create or update an RSVP. A guest is matched on whichever contact detail
 * they gave, so submitting twice corrects the answer instead of counting them
 * twice — including when they used a phone the first time and an email the
 * second.
 */
export const submit = mutation({
  args: { ...rsvpFields, key: v.string() },
  handler: async (ctx, { key, ...args }) => {
    assertServer(key);

    const emailKey = toEmailKey(args.email);
    const phoneKey = toPhoneKey(args.phone);
    const now = Date.now();

    // A "can't make it" answer should never carry a headcount.
    const adults = args.attending ? Math.max(1, Math.min(20, args.adults)) : 0;
    const kids = args.attending ? Math.max(0, Math.min(20, args.kids)) : 0;

    // Email first: it identifies one person, where a phone can be a household.
    let existing = emailKey
      ? await ctx.db
          .query("rsvps")
          .withIndex("by_email", (q) => q.eq("emailKey", emailKey))
          .first()
      : null;

    if (!existing && phoneKey) {
      existing = await ctx.db
        .query("rsvps")
        .withIndex("by_phone", (q) => q.eq("phoneKey", phoneKey))
        .first();
    }

    const doc = { ...args, adults, kids, emailKey, phoneKey, updatedAt: now };

    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return { updated: true };
    }

    await ctx.db.insert("rsvps", { ...doc, submittedAt: now });
    return { updated: false };
  },
});

/** Admin: every RSVP, newest first. */
export const list = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    assertServer(key);
    return ctx.db.query("rsvps").withIndex("by_submitted").order("desc").collect();
  },
});

/** Admin: the numbers you actually need for budgeting. */
export const stats = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    assertServer(key);

    const all = await ctx.db.query("rsvps").collect();
    const yes = all.filter((r) => r.attending);

    const adults = yes.reduce((sum, r) => sum + r.adults, 0);
    const kids = yes.reduce((sum, r) => sum + r.kids, 0);

    const mealCounts: Record<string, number> = {};
    for (const r of yes) {
      const meal = r.meal?.trim();
      if (!meal) continue;
      // A party's meal choice covers its adults; kids are counted separately.
      mealCounts[meal] = (mealCounts[meal] ?? 0) + r.adults;
    }

    return {
      responses: all.length,
      attendingParties: yes.length,
      decliningParties: all.length - yes.length,
      adults,
      kids,
      totalGuests: adults + kids,
      mealCounts,
      withDietaryNotes: yes.filter((r) => r.dietaryNotes?.trim()).length,
    };
  },
});

/** Admin: remove a duplicate or test entry. */
export const remove = mutation({
  args: { id: v.id("rsvps"), key: v.string() },
  handler: async (ctx, { id, key }) => {
    assertServer(key);
    await ctx.db.delete(id);
  },
});

/** Admin: remove several at once, from the dashboard's selection. */
export const removeMany = mutation({
  args: { ids: v.array(v.id("rsvps")), key: v.string() },
  handler: async (ctx, { ids, key }) => {
    assertServer(key);

    let deleted = 0;
    for (const id of ids) {
      // Skip anything already gone rather than failing the whole batch.
      if (await ctx.db.get(id)) {
        await ctx.db.delete(id);
        deleted += 1;
      }
    }
    return { deleted };
  },
});

/**
 * Fold duplicate RSVPs into one row.
 *
 * The combined record arrives already resolved: the hosts reviewed it on the
 * merge screen and corrected anything the automatic rules got wrong. This just
 * stores what they confirmed and deletes the rows it replaces — so what they
 * saw is exactly what is saved.
 */
export const merge = mutation({
  args: {
    ...rsvpFields,
    key: v.string(),
    keepId: v.id("rsvps"),
    removeIds: v.array(v.id("rsvps")),
  },
  handler: async (ctx, { key, keepId, removeIds, ...fields }) => {
    assertServer(key);

    const keep = await ctx.db.get(keepId);
    if (!keep) throw new Error("That RSVP no longer exists.");

    type Row = NonNullable<typeof keep>;
    const others: Row[] = [];
    for (const id of removeIds) {
      if (id === keepId) continue;
      const row = await ctx.db.get(id);
      if (row) others.push(row);
    }

    await ctx.db.patch(keepId, {
      ...fields,
      emailKey: toEmailKey(fields.email),
      phoneKey: toPhoneKey(fields.phone),
      adults: fields.attending ? Math.max(0, Math.min(40, fields.adults)) : 0,
      kids: fields.attending ? Math.max(0, Math.min(40, fields.kids)) : 0,
      // The party first replied when its earliest row did.
      submittedAt: Math.min(keep.submittedAt, ...others.map((r) => r.submittedAt)),
      updatedAt: Date.now(),
    });

    for (const row of others) await ctx.db.delete(row._id);

    return { merged: others.length };
  },
});

/**
 * Host edit of a single RSVP.
 *
 * Separate from `submit`, which is the guest path and looks for an existing
 * row to update. Here the row is already known, so the only real work is
 * recomputing the lookup keys: if a host corrects an email or phone, a later
 * reply from that guest still has to match this row rather than making a
 * second one.
 */
export const update = mutation({
  args: { ...rsvpFields, key: v.string(), id: v.id("rsvps") },
  handler: async (ctx, { key, id, ...args }) => {
    assertServer(key);

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("That RSVP no longer exists.");

    await ctx.db.patch(id, {
      ...args,
      emailKey: toEmailKey(args.email),
      phoneKey: toPhoneKey(args.phone),
      adults: args.attending ? Math.max(0, Math.min(40, args.adults)) : 0,
      kids: args.attending ? Math.max(0, Math.min(40, args.kids)) : 0,
      updatedAt: Date.now(),
    });
  },
});
