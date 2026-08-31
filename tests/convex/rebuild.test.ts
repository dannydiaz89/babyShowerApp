// @vitest-environment edge-runtime
import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import {
  MEAL_TALLY_READ_LIMIT,
  MEAL_TALLY_REBUILD_LIMIT,
} from "../../convex/limits";

/**
 * These run the real mutations against a real database, unlike the pure
 * arithmetic tests next door. The cleanup inside `rebuildTotals` is only
 * reachable this way — it reads and deletes documents, so no amount of
 * testing `applyRow` in isolation ever executes it, which is exactly how a
 * partial delete survived review.
 */

const KEY = "test-server-key";

// Every function starts with assertServer, which compares against this.
process.env.ADMIN_API_KEY = KEY;

const modules = import.meta.glob("../../convex/**/*.ts");

function db() {
  return convexTest(schema, modules);
}

type Reply = {
  name: string;
  email: string;
  attending: boolean;
  adults: number;
  kids: number;
  meal?: string;
};

function reply(i: number, over: Partial<Reply> = {}): Reply {
  return {
    name: `Guest ${i}`,
    email: `guest-${i}@example.invalid`,
    attending: true,
    adults: 1,
    kids: 0,
    ...over,
  };
}

describe("rebuildTotals", () => {
  it("counts an empty table", async () => {
    const t = db();
    const totals = await t.mutation(api.rsvps.rebuildTotals, { key: KEY });

    expect(totals.responses).toBe(0);
    expect(totals.mealCounts).toEqual([]);
  });

  it("counts the replies that are there", async () => {
    const t = db();
    await t.mutation(api.rsvps.submit, { key: KEY, ...reply(1, { meal: "Vegan", adults: 2 }) });
    await t.mutation(api.rsvps.submit, { key: KEY, ...reply(2, { meal: "Vegan" }) });
    await t.mutation(api.rsvps.submit, { key: KEY, ...reply(3, { attending: false, adults: 0 }) });

    const totals = await t.mutation(api.rsvps.rebuildTotals, { key: KEY });

    expect(totals.responses).toBe(3);
    expect(totals.attendingParties).toBe(2);
    expect(totals.adults).toBe(3);
    expect(totals.mealCounts).toEqual([{ meal: "Vegan", count: 3 }]);
  });

  it("is idempotent", async () => {
    const t = db();
    for (let i = 0; i < 5; i++) {
      await t.mutation(api.rsvps.submit, { key: KEY, ...reply(i, { meal: `meal-${i % 2}` }) });
    }

    const first = await t.mutation(api.rsvps.rebuildTotals, { key: KEY });
    const second = await t.mutation(api.rsvps.rebuildTotals, { key: KEY });

    expect(second).toEqual(first);
  });

  it("drops a tally for a meal no reply carries any more", async () => {
    const t = db();
    await t.mutation(api.rsvps.submit, { key: KEY, ...reply(1, { meal: "Retired" }) });
    await t.mutation(api.rsvps.rebuildTotals, { key: KEY });

    // The host changes that reply to a different meal.
    const rows = await t.query(api.rsvps.page, {
      key: KEY,
      paginationOpts: { numItems: 10, cursor: null },
    });
    await t.mutation(api.rsvps.update, {
      key: KEY,
      id: rows.page[0]._id,
      ...reply(1, { meal: "Current" }),
    });

    const totals = await t.mutation(api.rsvps.rebuildTotals, { key: KEY });
    expect(totals.mealCounts).toEqual([{ meal: "Current", count: 1 }]);
  });

  /*
   * The finding. Cleanup used to read a bounded page of tallies and delete
   * only those, then insert a row for every meal in the table. Past that
   * bound the leftovers stayed, and a meal that was both left over and still
   * current ended up with two by_meal rows — after which every later write
   * for that meal threw, because adjustMealTally reads it with .unique().
   */
  it("leaves no duplicate rows when more tallies exist than one page holds", async () => {
    const t = db();
    const OVER = MEAL_TALLY_READ_LIMIT + 2;

    // Build up more distinct meals than the old cleanup could see. Each is a
    // real reply, so a rebuild legitimately wants every one of them.
    for (let i = 0; i < OVER; i++) {
      await t.mutation(api.rsvps.submit, { key: KEY, ...reply(i, { meal: `meal-${i}` }) });
    }
    await t.mutation(api.rsvps.rebuildTotals, { key: KEY });

    const totals = await t.mutation(api.rsvps.rebuildTotals, { key: KEY });
    expect(totals.mealCounts).toHaveLength(OVER);

    // One row per meal, not two.
    const tallies = await t.run(async (ctx) => ctx.db.query("mealTallies").collect());
    expect(tallies).toHaveLength(OVER);
    expect(new Set(tallies.map((row) => row.meal)).size).toBe(OVER);

    /*
     * The consequence that made this worth fixing: a duplicate row makes
     * .unique() throw, so the guest whose meal it is can never reply again.
     */
    await expect(
      t.mutation(api.rsvps.submit, {
        key: KEY,
        ...reply(0, { meal: "meal-0", adults: 2 }),
      })
    ).resolves.toBeDefined();

    const after = await t.query(api.rsvps.stats, { key: KEY });
    expect(after.responses).toBe(OVER);
  });

  it("refuses, without changing anything, when it cannot see every tally", async () => {
    const t = db();
    await t.mutation(api.rsvps.submit, { key: KEY, ...reply(1, { meal: "Vegan" }) });
    await t.mutation(api.rsvps.rebuildTotals, { key: KEY });

    // More tallies than one transaction may reconcile.
    await t.run(async (ctx) => {
      for (let i = 0; i < MEAL_TALLY_REBUILD_LIMIT; i++) {
        await ctx.db.insert("mealTallies", { meal: `stale-${i}`, count: 1 });
      }
    });
    const before = await t.run(async (ctx) => ctx.db.query("mealTallies").collect());

    await expect(t.mutation(api.rsvps.rebuildTotals, { key: KEY })).rejects.toThrow(
      /Nothing was changed/
    );

    // Refusing has to mean refusing: a half-done rebuild is what produces the
    // duplicate rows in the first place.
    const after = await t.run(async (ctx) => ctx.db.query("mealTallies").collect());
    expect(after).toHaveLength(before.length);
    expect(new Set(after.map((r) => r._id))).toEqual(new Set(before.map((r) => r._id)));
  });

  it("heals duplicate rows an interrupted rebuild already left behind", async () => {
    const t = db();
    await t.mutation(api.rsvps.submit, { key: KEY, ...reply(1, { meal: "Vegan" }) });
    await t.mutation(api.rsvps.rebuildTotals, { key: KEY });

    // Exactly the state the old cleanup could produce.
    await t.run(async (ctx) => {
      await ctx.db.insert("mealTallies", { meal: "Vegan", count: 99 });
    });
    expect(
      await t.run(async (ctx) => ctx.db.query("mealTallies").collect())
    ).toHaveLength(2);

    await t.mutation(api.rsvps.rebuildTotals, { key: KEY });

    const tallies = await t.run(async (ctx) => ctx.db.query("mealTallies").collect());
    expect(tallies).toEqual([expect.objectContaining({ meal: "Vegan", count: 1 })]);

    // And writes for that meal work again.
    await t.mutation(api.rsvps.submit, { key: KEY, ...reply(2, { meal: "Vegan" }) });
    const stats = await t.query(api.rsvps.stats, { key: KEY });
    expect(stats.mealCounts).toEqual([{ meal: "Vegan", count: 2 }]);
  });
});

describe("meal tallies through the real mutations", () => {
  let t: ReturnType<typeof db>;

  beforeEach(async () => {
    t = db();
    await t.mutation(api.rsvps.rebuildTotals, { key: KEY });
  });

  it("creates a row on the first reply and removes it on the last delete", async () => {
    await t.mutation(api.rsvps.submit, { key: KEY, ...reply(1, { meal: "Vegan", adults: 2 }) });
    expect((await t.query(api.rsvps.stats, { key: KEY })).mealCounts).toEqual([
      { meal: "Vegan", count: 2 },
    ]);

    const rows = await t.query(api.rsvps.page, {
      key: KEY,
      paginationOpts: { numItems: 10, cursor: null },
    });
    await t.mutation(api.rsvps.removeMany, { key: KEY, ids: [rows.page[0]._id] });

    const stats = await t.query(api.rsvps.stats, { key: KEY });
    expect(stats.mealCounts).toEqual([]);
    expect(await t.run(async (ctx) => ctx.db.query("mealTallies").collect())).toEqual([]);
  });

  it("moves both meals when a host changes a party's choice", async () => {
    await t.mutation(api.rsvps.submit, { key: KEY, ...reply(1, { meal: "Vegan", adults: 2 }) });
    const rows = await t.query(api.rsvps.page, {
      key: KEY,
      paginationOpts: { numItems: 10, cursor: null },
    });

    await t.mutation(api.rsvps.update, {
      key: KEY,
      id: rows.page[0]._id,
      ...reply(1, { meal: "Gluten-free", adults: 2 }),
    });

    const stats = await t.query(api.rsvps.stats, { key: KEY });
    expect(stats.mealCounts).toEqual([{ meal: "Gluten-free", count: 2 }]);
  });

  it("reports a partial list rather than showing fewer meals than exist", async () => {
    for (let i = 0; i < MEAL_TALLY_READ_LIMIT + 1; i++) {
      await t.mutation(api.rsvps.submit, { key: KEY, ...reply(i, { meal: `meal-${i}` }) });
    }

    const stats = await t.query(api.rsvps.stats, { key: KEY });
    expect(stats.mealCounts).toHaveLength(MEAL_TALLY_READ_LIMIT);
    expect(stats.mealCountsPartial).toBe(true);
  });

  it("does not report a partial list at exactly the limit", async () => {
    for (let i = 0; i < MEAL_TALLY_READ_LIMIT; i++) {
      await t.mutation(api.rsvps.submit, { key: KEY, ...reply(i, { meal: `meal-${i}` }) });
    }

    const stats = await t.query(api.rsvps.stats, { key: KEY });
    expect(stats.mealCounts).toHaveLength(MEAL_TALLY_READ_LIMIT);
    expect(stats.mealCountsPartial).toBe(false);
  });
});
