import { describe, expect, it } from "vitest";
import { MAX_MEAL_LABEL, MAX_MEAL_LABELS } from "../convex/limits";
import { mealDeltas } from "../convex/rsvps";
import { checkMealOptions, isOfferedMeal, offeredMeals } from "../src/lib/meals";
import type { Localized } from "../src/lib/defaults";

/**
 * The settings form, the RSVP action and the catering tally have to agree on
 * one thing: a meal the hosts are allowed to configure must reach the numbers
 * they order food against.
 *
 * They disagreed twice. First the tally silently ignored labels past a cap
 * while settings accepted any menu, so an option saved, guests picked it,
 * their replies were counted — and the catering breakdown left it out with
 * nothing on screen to say so. Aligning the two limits was not enough either:
 * labels from an earlier menu, still carried by older replies, took up room
 * under the same cap, so a configured meal could *still* be dropped. Meals are
 * one document each now and nothing turns them away. These tests sit above all
 * three pieces so they cannot drift apart again.
 */

/** A menu of `count` options, each label `length` characters long. */
function menu(count: number, length = 10, bilingual = true): Localized[] {
  return Array.from({ length: count }, (_, i) => {
    const tag = `-${i}`;
    const pad = (prefix: string) =>
      (prefix + "x".repeat(Math.max(0, length - prefix.length - tag.length)) + tag).slice(
        0,
        length
      );
    return { en: pad("en"), es: bilingual ? pad("es") : "" };
  });
}

/** Every label of a menu, submitted once, as the guest path would. */
function tally(options: Localized[], locales: ("en" | "es")[] = ["en"]) {
  const changes = [];

  for (const locale of locales) {
    for (const option of options) {
      const chosen = option[locale].trim();
      if (!chosen) continue;

      // What the RSVP action checks before storing a submitted meal.
      expect(isOfferedMeal(chosen, options)).toBe(true);

      changes.push({
        row: {
          attending: true,
          adults: 1,
          kids: 0,
          meal: chosen,
          dietaryNotes: undefined,
        },
        sign: 1 as const,
      });
    }
  }

  return mealDeltas(changes);
}

describe("every meal the settings accept reaches the catering totals", () => {
  it("counts a normal menu", () => {
    const options: Localized[] = [
      { en: "No preference", es: "Sin preferencia" },
      { en: "Vegetarian", es: "Vegetariano" },
      { en: "Niños", es: "Niños" },
    ];
    expect(checkMealOptions(options)).toBeNull();

    expect([...tally(options).keys()]).toEqual([
      "No preference",
      "Vegetarian",
      "Niños",
    ]);
  });

  it("counts the largest menu settings will accept, in both languages", () => {
    const options = menu(MAX_MEAL_LABELS / 2);
    expect(checkMealOptions(options)).toBeNull();

    const counted = tally(options, ["en", "es"]);
    // Every label from both languages, none dropped.
    expect(counted.size).toBe(offeredMeals(options).length);
    expect(counted.size).toBe(MAX_MEAL_LABELS);
    for (const count of counted.values()) expect(count).toBe(1);
  });

  it("counts a label of the greatest length settings will accept", () => {
    const options = menu(2, MAX_MEAL_LABEL);
    expect(checkMealOptions(options)).toBeNull();
    expect(options[0].en).toHaveLength(MAX_MEAL_LABEL);

    expect(tally(options).size).toBe(2);
  });

  /*
   * The regression that survived the first fix. Replies made under an earlier
   * menu still carry its labels, and those used to occupy the same capped
   * list — so a brand new configured option could be pushed out of the
   * catering numbers by meals nobody offers any more.
   */
  it("counts a new menu even when older replies still carry three old ones", () => {
    const menus = [menu(MAX_MEAL_LABELS / 2), menu(MAX_MEAL_LABELS / 2), menu(MAX_MEAL_LABELS / 2)]
      .map((options, revision) =>
        options.map((o) => ({ en: `r${revision}-${o.en}`, es: `r${revision}-${o.es}` }))
      );
    const current = menu(MAX_MEAL_LABELS / 2);

    const changes = [...menus.flat(), ...current].flatMap((option) =>
      [option.en, option.es].map((meal) => ({
        row: { attending: true, adults: 1, kids: 0, meal, dietaryNotes: undefined },
        sign: 1 as const,
      }))
    );

    const counted = mealDeltas(changes);
    // Every label of the current menu is present despite the history.
    for (const option of current) {
      expect(counted.get(option.en)).toBe(1);
      expect(counted.get(option.es)).toBe(1);
    }
    expect(counted.size).toBe(MAX_MEAL_LABELS * 4);
  });
});

describe("settings refuse a menu the settings document could not hold", () => {
  it("refuses one label past the length limit", () => {
    expect(checkMealOptions(menu(2, MAX_MEAL_LABEL + 1))).toMatchObject({
      kind: "too-long",
      max: MAX_MEAL_LABEL,
    });
  });

  it("refuses a long label even when it is only the Spanish one", () => {
    expect(
      checkMealOptions([{ en: "Vegan", es: "x".repeat(MAX_MEAL_LABEL + 1) }])
    ).toMatchObject({ kind: "too-long" });
  });

  it("refuses one label too many, counting both languages", () => {
    expect(checkMealOptions(menu(MAX_MEAL_LABELS / 2 + 1))).toMatchObject({
      kind: "too-many",
      labels: MAX_MEAL_LABELS + 2,
      max: MAX_MEAL_LABELS,
    });
  });

  it("allows twice as many options when the hosts write only one language", () => {
    expect(checkMealOptions(menu(MAX_MEAL_LABELS, 10, false))).toBeNull();
    expect(checkMealOptions(menu(MAX_MEAL_LABELS + 1, 10, false))).toMatchObject({
      kind: "too-many",
    });
  });

  it("accepts an empty menu", () => {
    expect(checkMealOptions([])).toBeNull();
  });
});
