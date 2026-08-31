import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import schema from "./schema";
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

/* ------------------------------------------------------------------ totals */

/**
 * The numbers the dashboard shows. Kept as a single row and adjusted by every
 * mutation below in the same transaction as the write it describes, so the two
 * cannot drift. Reading the whole table to add these up instead would be an
 * unbounded read that eventually exceeds Convex's per-query limits — and the
 * per-IP submission limiter caps the rate, not the total.
 */
export type MealCount = { meal: string; count: number };

export type Totals = {
  responses: number;
  attendingParties: number;
  adults: number;
  kids: number;
  withDietaryNotes: number;
  /*
   * An array, not a record keyed by meal name. Convex record keys must be
   * ASCII and the hosts write these labels themselves, so a menu with "Niños"
   * or "Entrée" on it would make every RSVP choosing that option fail to
   * save — and, before the totals exist, would fail the first rebuild instead.
   */
  mealCounts: MealCount[];
};

const ZERO_TOTALS: Totals = {
  responses: 0,
  attendingParties: 0,
  adults: 0,
  kids: 0,
  withDietaryNotes: 0,
  mealCounts: [],
};

const mealCountsValidator = v.array(
  v.object({ meal: v.string(), count: v.number() })
);

const totalsValidator = v.object({
  responses: v.number(),
  attendingParties: v.number(),
  adults: v.number(),
  kids: v.number(),
  withDietaryNotes: v.number(),
  mealCounts: mealCountsValidator,
});

/** Just the fields that move the totals. */
type Counted = Pick<
  Doc<"rsvps">,
  "attending" | "adults" | "kids" | "meal" | "dietaryNotes"
>;

/*
 * The tally lives in one shared document, and every RSVP write patches it. If
 * it can grow without limit it eventually passes Convex's document size and
 * array length caps, and from that point on *every* RSVP write rolls back —
 * one guest's input taking the whole form down.
 *
 * The RSVP action already refuses a meal that is not on the menu. These are
 * the structural limits underneath that: whatever any caller sends, this
 * aggregate stays small. Far above any real menu, so they only bite under
 * abuse — at which point an undercounted tally is a much better failure than
 * a form nobody can submit, and `rebuildTotals` puts it right.
 */
export const MAX_TRACKED_MEALS = 64;
export const MAX_MEAL_LABEL = 120;

/** Move one meal's tally by `delta`, adding or dropping the entry as needed. */
function withMeal(counts: MealCount[], meal: string, delta: number): MealCount[] {
  const known = counts.some((entry) => entry.meal === meal);

  if (!known) {
    // Taking back a meal that was never tracked is simply nothing to do.
    if (delta <= 0) return counts;
    if (meal.length > MAX_MEAL_LABEL) return counts;
    if (counts.length >= MAX_TRACKED_MEALS) return counts;
    return [...counts, { meal, count: delta }];
  }

  return counts
    .map((entry) => (entry.meal === meal ? { meal, count: entry.count + delta } : entry))
    // Drop a meal nobody has left, so this stays as short as the menu.
    .filter((entry) => entry.count > 0);
}

/** Add (`sign` 1) or take back (`sign` -1) one row's contribution. */
export function applyRow(totals: Totals, row: Counted, sign: 1 | -1): Totals {
  const next: Totals = { ...totals };

  next.responses += sign;
  if (!row.attending) return next;

  next.attendingParties += sign;
  next.adults += sign * row.adults;
  next.kids += sign * row.kids;
  if (row.dietaryNotes?.trim()) next.withDietaryNotes += sign;

  const meal = row.meal?.trim();
  // A party's meal choice covers its adults; kids are counted separately.
  if (meal) next.mealCounts = withMeal(next.mealCounts, meal, sign * row.adults);

  return next;
}

/** Starting totals, for a rebuild or a test. */
export function zeroTotals(): Totals {
  return { ...ZERO_TOTALS, mealCounts: [] };
}

async function totalsRow(ctx: MutationCtx) {
  return ctx.db
    .query("rsvpTotals")
    .withIndex("by_singleton", (q) => q.eq("singleton", "totals"))
    .unique();
}

/**
 * Fold a set of row changes into the running totals.
 *
 * No totals row means they have never been built. Creating a partial one here
 * would report every reply made before this moment as missing, so the write is
 * skipped and the first `rebuildTotals` counts these rows along with the rest.
 */
async function adjustTotals(
  ctx: MutationCtx,
  changes: { row: Counted; sign: 1 | -1 }[]
): Promise<void> {
  const existing = await totalsRow(ctx);
  if (!existing) return;

  let totals: Totals = {
    responses: existing.responses,
    attendingParties: existing.attendingParties,
    adults: existing.adults,
    kids: existing.kids,
    withDietaryNotes: existing.withDietaryNotes,
    mealCounts: existing.mealCounts,
  };
  for (const change of changes) totals = applyRow(totals, change.row, change.sign);

  await ctx.db.patch(existing._id, totals);
}

/* ---------------------------------------------------------------- writing */

type RsvpArgs = {
  name: string;
  email?: string;
  phone?: string;
  attending: boolean;
  guestNames?: string;
  meal?: string;
  dietaryNotes?: string;
  message?: string;
};

/**
 * Every column a reply owns, named rather than spread.
 *
 * `ctx.db.patch` leaves a key it is not given alone and removes one whose
 * value is `undefined` — and an empty form field arrives as a missing key, not
 * an empty one. Spreading the arguments would therefore keep an allergy note
 * or a message the host just deleted, and quietly disagree with the record
 * they were shown on the way to saving it.
 */
function storedFields(args: RsvpArgs) {
  return {
    name: args.name,
    email: args.email,
    phone: args.phone,
    attending: args.attending,
    guestNames: args.guestNames,
    meal: args.meal,
    dietaryNotes: args.dietaryNotes,
    message: args.message,
    emailKey: toEmailKey(args.email),
    phoneKey: toPhoneKey(args.phone),
  };
}

/**
 * Move the totals from `before` to whatever the row holds now.
 *
 * The stored document is read back rather than reusing the object just
 * written: a patch merges, so what is on disk is not always what was handed
 * to it, and totals computed from the intended write drift from the table
 * they claim to describe.
 */
async function retotal(
  ctx: MutationCtx,
  before: Counted | null,
  id: Id<"rsvps"> | null
): Promise<void> {
  const after = id ? await ctx.db.get(id) : null;
  const changes: { row: Counted; sign: 1 | -1 }[] = [];
  if (before) changes.push({ row: before, sign: -1 });
  if (after) changes.push({ row: after, sign: 1 });
  await adjustTotals(ctx, changes);
}

/* --------------------------------------------------------------- functions */

/**
 * Create or update an RSVP. A guest is matched on whichever contact detail
 * they gave, so submitting twice corrects the answer instead of counting them
 * twice — including when they used a phone the first time and an email the
 * second.
 */
export const submit = mutation({
  args: { ...rsvpFields, key: v.string() },
  returns: v.object({ updated: v.boolean() }),
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

    const doc = { ...storedFields(args), adults, kids, updatedAt: now };

    if (existing) {
      await ctx.db.patch(existing._id, doc);
      await retotal(ctx, existing, existing._id);
      return { updated: true };
    }

    const id = await ctx.db.insert("rsvps", { ...doc, submittedAt: now });
    await retotal(ctx, null, id);
    return { updated: false };
  },
});

/**
 * Admin: RSVPs newest first, one page at a time.
 *
 * Paginated rather than collected: the table has no upper bound, and the
 * dashboard and the CSV export both read it.
 */
export const page = query({
  args: { key: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("rsvps")),
  handler: async (ctx, { key, paginationOpts }) => {
    assertServer(key);
    return ctx.db
      .query("rsvps")
      .withIndex("by_submitted")
      .order("desc")
      .paginate(paginationOpts);
  },
});

/**
 * Admin: the numbers you actually need for budgeting.
 *
 * `ready` is false until the totals have been built once — see
 * `rebuildTotals`. The dashboard builds them on its first visit.
 */
export const stats = query({
  args: { key: v.string() },
  returns: v.object({
    ready: v.boolean(),
    responses: v.number(),
    attendingParties: v.number(),
    decliningParties: v.number(),
    adults: v.number(),
    kids: v.number(),
    totalGuests: v.number(),
    withDietaryNotes: v.number(),
    mealCounts: mealCountsValidator,
  }),
  handler: async (ctx, { key }) => {
    assertServer(key);

    const row = await ctx.db
      .query("rsvpTotals")
      .withIndex("by_singleton", (q) => q.eq("singleton", "totals"))
      .unique();

    const totals: Totals = row ?? ZERO_TOTALS;

    return {
      ready: row !== null,
      responses: totals.responses,
      attendingParties: totals.attendingParties,
      decliningParties: totals.responses - totals.attendingParties,
      adults: totals.adults,
      kids: totals.kids,
      totalGuests: totals.adults + totals.kids,
      withDietaryNotes: totals.withDietaryNotes,
      mealCounts: totals.mealCounts,
    };
  },
});

/**
 * Count the whole table once and store the result.
 *
 * Needed only to adopt an existing deployment, or after a restore: from then
 * on every write keeps the totals current. Deliberately one transaction, so it
 * cannot interleave with a concurrent write and count a row twice — which
 * bounds it at REBUILD_LIMIT rows. Past that, this app has outgrown a
 * denormalised counter and wants @convex-dev/aggregate.
 */
const REBUILD_LIMIT = 4096;

export const rebuildTotals = mutation({
  args: { key: v.string() },
  returns: totalsValidator,
  handler: async (ctx, { key }) => {
    assertServer(key);

    const rows = await ctx.db.query("rsvps").take(REBUILD_LIMIT + 1);
    if (rows.length > REBUILD_LIMIT) {
      throw new Error(
        `Too many RSVPs (over ${REBUILD_LIMIT}) to total in one transaction. ` +
          "Switch the dashboard totals to the @convex-dev/aggregate component."
      );
    }

    let totals = zeroTotals();
    for (const row of rows) totals = applyRow(totals, row, 1);

    const existing = await totalsRow(ctx);
    if (existing) await ctx.db.patch(existing._id, totals);
    else await ctx.db.insert("rsvpTotals", { singleton: "totals" as const, ...totals });

    return totals;
  },
});

/** Admin: remove a duplicate or test entry. */
export const remove = mutation({
  args: { id: v.id("rsvps"), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, key }) => {
    assertServer(key);

    const row = await ctx.db.get(id);
    if (!row) return null;

    await ctx.db.delete(id);
    await retotal(ctx, row, null);
    return null;
  },
});

/** Admin: remove several at once, from the dashboard's selection. */
export const removeMany = mutation({
  args: { ids: v.array(v.id("rsvps")), key: v.string() },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, { ids, key }) => {
    assertServer(key);

    const changes: { row: Counted; sign: -1 }[] = [];
    for (const id of ids) {
      // Skip anything already gone rather than failing the whole batch.
      const row = await ctx.db.get(id);
      if (!row) continue;
      await ctx.db.delete(id);
      changes.push({ row, sign: -1 });
    }

    await adjustTotals(ctx, changes);
    return { deleted: changes.length };
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
  returns: v.object({ merged: v.number() }),
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
      ...storedFields(fields),
      adults: fields.attending ? Math.max(0, Math.min(40, fields.adults)) : 0,
      kids: fields.attending ? Math.max(0, Math.min(40, fields.kids)) : 0,
      // The party first replied when its earliest row did.
      submittedAt: Math.min(keep.submittedAt, ...others.map((r) => r.submittedAt)),
      updatedAt: Date.now(),
    });
    for (const row of others) await ctx.db.delete(row._id);

    const stored = await ctx.db.get(keepId);
    await adjustTotals(ctx, [
      { row: keep, sign: -1 },
      ...others.map((row) => ({ row, sign: -1 as const })),
      ...(stored ? [{ row: stored, sign: 1 as const }] : []),
    ]);

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
  returns: v.null(),
  handler: async (ctx, { key, id, ...args }) => {
    assertServer(key);

    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("That RSVP no longer exists.");

    await ctx.db.patch(id, {
      ...storedFields(args),
      adults: args.attending ? Math.max(0, Math.min(40, args.adults)) : 0,
      kids: args.attending ? Math.max(0, Math.min(40, args.kids)) : 0,
      updatedAt: Date.now(),
    });
    await retotal(ctx, existing, id);
    return null;
  },
});
