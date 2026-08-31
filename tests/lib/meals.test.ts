import { describe, expect, it } from "vitest";
import { MAX_TEXT, boundedText, isOfferedMeal, offeredMeals } from "../../src/lib/meals";
import type { Localized } from "../../src/lib/defaults";

/**
 * The RSVP form offers a <select>, but the Server Action behind it is a public
 * POST endpoint and the markup constrains nothing. Whatever arrives here ends
 * up as an entry in the dashboard's one shared totals document, so an
 * unchecked value is an availability problem, not a tidiness one: enough
 * distinct or long meals push that document past Convex's size limit and every
 * later RSVP write rolls back.
 */

const MENU: Localized[] = [
  { en: "No preference", es: "Sin preferencia" },
  { en: "Vegetarian", es: "Vegetariano" },
  { en: "Gluten-free", es: "Sin gluten" },
];

describe("offeredMeals", () => {
  it("lists both languages, because either may have been shown", () => {
    expect(offeredMeals(MENU)).toEqual([
      "No preference",
      "Sin preferencia",
      "Vegetarian",
      "Vegetariano",
      "Gluten-free",
      "Sin gluten",
    ]);
  });

  it("skips a language the hosts left blank", () => {
    expect(offeredMeals([{ en: "Vegan", es: "" }])).toEqual(["Vegan"]);
  });

  it("does not repeat a label the hosts wrote the same in both languages", () => {
    expect(offeredMeals([{ en: "Vegan", es: "Vegan" }])).toEqual(["Vegan"]);
  });

  it("is empty when nothing is on the menu", () => {
    expect(offeredMeals([])).toEqual([]);
  });
});

describe("isOfferedMeal", () => {
  it("accepts a label in either language", () => {
    expect(isOfferedMeal("Vegetarian", MENU)).toBe(true);
    expect(isOfferedMeal("Vegetariano", MENU)).toBe(true);
  });

  it("accepts a non-ASCII label the hosts configured", () => {
    expect(isOfferedMeal("Niños", [{ en: "Niños", es: "Niños" }])).toBe(true);
  });

  it("tolerates stray whitespace around a real choice", () => {
    expect(isOfferedMeal("  Vegetarian  ", MENU)).toBe(true);
  });

  it("refuses anything not on the menu", () => {
    expect(isOfferedMeal("Lobster thermidor", MENU)).toBe(false);
    expect(isOfferedMeal("vegetarian", MENU)).toBe(false);
  });

  it("refuses the flood a posted form could otherwise send", () => {
    // Each distinct value would append another entry to the shared aggregate.
    for (let i = 0; i < 5; i++) {
      expect(isOfferedMeal(`junk-meal-${i}`, MENU)).toBe(false);
    }
    expect(isOfferedMeal("X".repeat(4000), MENU)).toBe(false);
  });

  it("refuses everything when the hosts offer no meals", () => {
    expect(isOfferedMeal("Vegetarian", [])).toBe(false);
  });
});

describe("boundedText", () => {
  it("trims, the way the form always has", () => {
    expect(boundedText("  Elena Vargas  ")).toBe("Elena Vargas");
  });

  it("leaves anything a person would actually type alone", () => {
    const note = "Severe tree nut allergy — please keep it away from the table.";
    expect(boundedText(note)).toBe(note);
  });

  it("caps a value that would bloat a page of the guest list", () => {
    // The dashboard reads replies a page at a time, and a page has a byte
    // budget; one enormous message would take the whole page down with it.
    expect(boundedText("x".repeat(10_000))).toHaveLength(MAX_TEXT);
  });

  it("honours a caller's own limit", () => {
    expect(boundedText("abcdef", 3)).toBe("abc");
  });
});
