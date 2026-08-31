import type { Localized } from "@/lib/defaults";

/**
 * What a guest is allowed to put in the meal field.
 *
 * The RSVP form offers a <select> of the configured options, but a Server
 * Action is its own public POST endpoint — the browser's markup constrains
 * nothing. The submitted value becomes an entry in the dashboard's shared
 * totals document, so an unchecked one is not merely untidy: enough distinct
 * or long values push that document past Convex's size limit, and from then
 * on every RSVP write rolls back.
 */

/** The longest free-text value a guest may store in one field. */
export const MAX_TEXT = 500;

/**
 * Trim, and refuse to store more than a person would ever type.
 *
 * The guest list is read a page at a time, and a page has a byte budget, so
 * one enormous message would take the dashboard down with it.
 */
export function boundedText(value: string, max = MAX_TEXT): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Every label the hosts currently offer, in both languages. */
export function offeredMeals(options: Localized[]): string[] {
  const labels: string[] = [];
  for (const option of options) {
    for (const label of [option.en, option.es]) {
      const trimmed = label.trim();
      if (trimmed && !labels.includes(trimmed)) labels.push(trimmed);
    }
  }
  return labels;
}

/**
 * Is this one of the meals on offer?
 *
 * Either language counts: a guest may have opened the form in English and
 * switched, and the stored value is whichever label they were shown.
 */
export function isOfferedMeal(meal: string, options: Localized[]): boolean {
  return offeredMeals(options).includes(meal.trim());
}
