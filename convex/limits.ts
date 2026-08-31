/**
 * Limits shared by the backend and the admin form.
 *
 * Plain constants with no Convex imports, so the Next.js side can read the
 * same file. Two copies of these numbers would drift, and drift here is not
 * cosmetic: the settings form would accept a menu the dashboard cannot show.
 */

/**
 * How long one meal label may be, and how many the hosts may configure.
 *
 * These bound the settings document itself — the menu is an array inside it,
 * and Convex documents have a size limit. They deliberately do NOT bound the
 * catering tally: each meal is counted in its own document, so a tally can
 * never grow large enough to block a write, and no configured meal is ever
 * turned away from it.
 */
export const MAX_MEAL_LABEL = 120;
export const MAX_MEAL_LABELS = 64;

/**
 * How many meal tallies the dashboard reads at once.
 *
 * A bounded read rather than a cap on what may be stored. Every label a guest
 * can choose comes from the menu, so passing this needs many complete menu
 * changes with older replies kept; if it ever happens the dashboard says the
 * list is partial instead of quietly showing fewer meals than exist.
 */
export const MEAL_TALLY_READ_LIMIT = 500;
