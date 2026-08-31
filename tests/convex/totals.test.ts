import { describe, expect, it } from "vitest";
import {
  applyRow,
  mealDelta,
  mealDeltas,
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
  });

  it("returns to zero after every row is taken back", () => {
    // Deleting or editing a reply must undo exactly what adding it did, or the
    // dashboard drifts a little further from the table with every change.
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

});

/**
 * Meal tallies are their own documents, so nothing caps them and no configured
 * meal can be turned away from the catering numbers. These cover the
 * arithmetic that decides what each write moves.
 */
describe("mealDelta", () => {
  const row = (over: Partial<Row> = {}): Row => attending({ meal: "Vegan", ...over });

  it("credits a meal to the party's adults, not its children", () => {
    expect(mealDelta(row({ adults: 3, kids: 2 }), 1)).toEqual({ meal: "Vegan", delta: 3 });
  });

  it("takes the same amount back", () => {
    expect(mealDelta(row({ adults: 3 }), -1)).toEqual({ meal: "Vegan", delta: -3 });
  });

  it("counts nothing for a party that is not coming", () => {
    expect(mealDelta({ ...declining, meal: "Vegan" }, 1)).toBeNull();
  });

  it("counts nothing when no meal was chosen", () => {
    expect(mealDelta(attending(), 1)).toBeNull();
    expect(mealDelta(row({ meal: "   " }), 1)).toBeNull();
  });

  it("trims, so one meal is not tracked twice", () => {
    expect(mealDelta(row({ meal: "  Vegan  " }), 1)?.meal).toBe("Vegan");
  });

  it("handles a label that is not ASCII", () => {
    // Convex record keys must be ASCII; a meal is a value here, never a key.
    expect(mealDelta(row({ meal: "Niños", adults: 2 }), 1)).toEqual({
      meal: "Niños",
      delta: 2,
    });
  });

  it("has no length or cardinality limit to turn a meal away", () => {
    const huge = "X".repeat(5000);
    expect(mealDelta(row({ meal: huge, adults: 1 }), 1)).toEqual({ meal: huge, delta: 1 });
  });
});

describe("mealDeltas", () => {
  it("writes one movement per meal rather than one per row", () => {
    const deltas = mealDeltas([
      { row: attending({ meal: "Vegan", adults: 2 }), sign: 1 },
      { row: attending({ meal: "Vegan", adults: 1 }), sign: 1 },
      { row: attending({ meal: "Gluten-free", adults: 4 }), sign: 1 },
    ]);

    expect([...deltas]).toEqual([
      ["Vegan", 3],
      ["Gluten-free", 4],
    ]);
  });

  it("nets an edit that keeps the same meal down to the difference", () => {
    // Replacing a party of 2 with a party of 3 moves the tally by one.
    const deltas = mealDeltas([
      { row: attending({ meal: "Vegan", adults: 2 }), sign: -1 },
      { row: attending({ meal: "Vegan", adults: 3 }), sign: 1 },
    ]);

    expect(deltas.get("Vegan")).toBe(1);
  });

  it("moves both meals when a party changes its choice", () => {
    const deltas = mealDeltas([
      { row: attending({ meal: "Vegan", adults: 2 }), sign: -1 },
      { row: attending({ meal: "Gluten-free", adults: 2 }), sign: 1 },
    ]);

    expect(deltas.get("Vegan")).toBe(-2);
    expect(deltas.get("Gluten-free")).toBe(2);
  });

  it("keeps every distinct meal, however many there are", () => {
    const changes = Array.from({ length: 300 }, (_, i) => ({
      row: attending({ meal: `meal-${i}`, adults: 1 }),
      sign: 1 as const,
    }));

    expect(mealDeltas(changes).size).toBe(300);
  });

  it("is empty when nothing chose a meal", () => {
    expect(mealDeltas([{ row: declining, sign: 1 }]).size).toBe(0);
  });
});
