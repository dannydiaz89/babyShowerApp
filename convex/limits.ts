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

/**
 * How many meal tallies one rebuild may reconcile.
 *
 * A rebuild has to see every tally there is: one that reads only part of them
 * leaves the rest behind, and then inserts a fresh row for a meal that already
 * had one — two rows under the same name, after which every write for that
 * meal fails on the unique lookup. So this is a limit the rebuild checks
 * *before* it changes anything, and refuses rather than half-finishing.
 *
 * Distinct meals cannot exceed replies, and a menu is at most MAX_MEAL_LABELS
 * labels, so reaching this needs a long history of menu changes.
 */
export const MEAL_TALLY_REBUILD_LIMIT = 2048;
