import { describe, expect, it } from "vitest";
import {
  MAX_MEAL_LABEL,
  MAX_TRACKED_MEALS,
  applyRow,
  zeroTotals,
  type Totals,
} from "../../convex/rsvps";

/**
 * The dashboard's numbers are a stored row rather than a scan of the table, so
 * this arithmetic is the only thing keeping them true. Every case here is one
 * a host would notice: a headcount that is wrong, or a reply that will not
 * save at all.
 */

type Row = Parameters<typeof applyRow>[1];

const attending = (over: Partial<Row> = {}): Row => ({
  attending: true,
  adults: 2,
  kids: 1,
  meal: undefined,
  dietaryNotes: undefined,
  ...over,
});

const declining: Row = {
  attending: false,
  adults: 0,
  kids: 0,
  meal: undefined,
  dietaryNotes: undefined,
};

/** Add rows, then take them all back; totals should return to zero. */
function roundTrip(rows: Row[]): Totals {
  let totals = zeroTotals();
  for (const row of rows) totals = applyRow(totals, row, 1);
  for (const row of rows) totals = applyRow(totals, row, -1);
  return totals;
}

describe("applyRow", () => {
  it("counts an attending party", () => {
    const totals = applyRow(zeroTotals(), attending(), 1);
    expect(totals).toMatchObject({
      responses: 1,
      attendingParties: 1,
      adults: 2,
      kids: 1,
    });
  });

  it("counts a declining party as a response and nothing else", () => {
    const totals = applyRow(zeroTotals(), declining, 1);
    expect(totals).toMatchObject({
      responses: 1,
      attendingParties: 0,
      adults: 0,
      kids: 0,
    });
    expect(totals.mealCounts).toEqual([]);
  });

  it("credits a meal to the party's adults, not its children", () => {
    const totals = applyRow(zeroTotals(), attending({ meal: "Vegan" }), 1);
    expect(totals.mealCounts).toEqual([{ meal: "Vegan", count: 2 }]);
  });

  it("drops a meal once nobody has it, rather than leaving a zero", () => {
    const row = attending({ meal: "Vegan" });
    expect(roundTrip([row]).mealCounts).toEqual([]);
  });

  it("returns to zero after every row is taken back", () => {
    expect(
      roundTrip([
        attending({ meal: "Vegan", dietaryNotes: "nut allergy" }),
        attending({ adults: 1, kids: 0, meal: "Gluten-free" }),
        declining,
      ])
    ).toEqual(zeroTotals());
  });

  it("counts a dietary note only for someone who is coming", () => {
    const coming = applyRow(zeroTotals(), attending({ dietaryNotes: "shellfish" }), 1);
    expect(coming.withDietaryNotes).toBe(1);

    const notComing = applyRow(
      zeroTotals(),
      { ...declining, dietaryNotes: "shellfish" },
      1
    );
    expect(notComing.withDietaryNotes).toBe(0);
  });

  it("ignores a meal that is only whitespace", () => {
    expect(applyRow(zeroTotals(), attending({ meal: "   " }), 1).mealCounts).toEqual([]);
  });

  /*
   * Convex record keys must be ASCII, and the hosts type the meal options
   * themselves. Keying the tally by meal name made "Niños" or "Entrée" reject
   * the whole RSVP mutation — the guest's reply was simply lost. Meal names
   * are values now, never keys, so the alphabet cannot matter.
   */
  it("handles a meal name that is not ASCII", () => {
    let totals = zeroTotals();
    totals = applyRow(totals, attending({ meal: "Niños" }), 1);
    totals = applyRow(totals, attending({ adults: 1, meal: "Entrée" }), 1);

    expect(totals.mealCounts).toEqual([
      { meal: "Niños", count: 2 },
      { meal: "Entrée", count: 1 },
    ]);
  });

  it("keeps meal names out of object keys entirely", () => {
    const totals = applyRow(zeroTotals(), attending({ meal: "Niños" }), 1);
    expect(Array.isArray(totals.mealCounts)).toBe(true);
    // Every key on the wire is one we chose, not one a host typed.
    for (const entry of totals.mealCounts) {
      expect(Object.keys(entry).sort()).toEqual(["count", "meal"]);
    }
  });

  it("does not share meal state between totals it derives", () => {
    const first = applyRow(zeroTotals(), attending({ meal: "Vegan" }), 1);
    const second = applyRow(first, attending({ meal: "Vegan" }), 1);

    expect(first.mealCounts).toEqual([{ meal: "Vegan", count: 2 }]);
    expect(second.mealCounts).toEqual([{ meal: "Vegan", count: 4 }]);
  });
});

/**
 * The tally lives in one document that every RSVP write patches. If it can
 * grow without limit it eventually passes Convex's document size and array
 * length caps, and from then on every RSVP write rolls back — one guest's
 * input taking the whole form down for everyone. The action refuses a meal
 * that is not on the menu; these are the limits underneath that.
 */
describe("applyRow keeps the shared aggregate bounded", () => {
  const withMeal = (meal: string) => ({
    attending: true,
    adults: 1,
    kids: 0,
    meal,
    dietaryNotes: undefined,
  });

  it("stops tracking new meals past the cap", () => {
    let totals = zeroTotals();
    for (let i = 0; i < MAX_TRACKED_MEALS + 50; i++) {
      totals = applyRow(totals, withMeal(`meal-${i}`), 1);
    }

    expect(totals.mealCounts).toHaveLength(MAX_TRACKED_MEALS);
    // The replies themselves are still counted; only the tally is capped.
    expect(totals.responses).toBe(MAX_TRACKED_MEALS + 50);
  });

  it("still counts a meal it is already tracking once the cap is reached", () => {
    let totals = zeroTotals();
    for (let i = 0; i < MAX_TRACKED_MEALS + 10; i++) {
      totals = applyRow(totals, withMeal(`meal-${i}`), 1);
    }
    totals = applyRow(totals, withMeal("meal-0"), 1);

    expect(totals.mealCounts.find((m) => m.meal === "meal-0")?.count).toBe(2);
    expect(totals.mealCounts).toHaveLength(MAX_TRACKED_MEALS);
  });

  it("refuses a label long enough to bloat the document on its own", () => {
    const huge = "X".repeat(MAX_MEAL_LABEL + 1);
    const totals = applyRow(zeroTotals(), withMeal(huge), 1);

    expect(totals.mealCounts).toEqual([]);
    expect(totals.responses).toBe(1);
  });

  it("accepts a label right at the limit", () => {
    const atLimit = "X".repeat(MAX_MEAL_LABEL);
    expect(applyRow(zeroTotals(), withMeal(atLimit), 1).mealCounts).toEqual([
      { meal: atLimit, count: 1 },
    ]);
  });

  it("does not invent an entry when taking back an untracked meal", () => {
    // Deleting a reply whose meal was never tracked must not create one, and
    // must never leave a negative count behind.
    const totals = applyRow(zeroTotals(), withMeal("never-tracked"), -1);

    expect(totals.mealCounts).toEqual([]);
    expect(totals.responses).toBe(-1);
  });

  it("stays bounded no matter how much junk is thrown at it", () => {
    let totals = zeroTotals();
    for (let i = 0; i < 500; i++) {
      totals = applyRow(totals, withMeal(`${"y".repeat(200)}-${i}`), 1);
    }

    expect(totals.mealCounts).toEqual([]);
    expect(JSON.stringify(totals).length).toBeLessThan(200);
  });
});
