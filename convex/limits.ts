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

/* ------------------------------------------------------------ photo wall */

/** How many photos one upload batch may hold. */
export const PHOTO_BATCH_MAX = 10;

/** The largest original the site will open a Drive upload for. */
export const PHOTO_ORIGINAL_MAX_BYTES = 25 * 1024 * 1024;

/**
 * The largest web copy accepted into Convex storage.
 *
 * A copy is ~1600px on its long edge and lands well under 300 KB; this is a
 * ceiling against a client that skips the resize, not a target.
 */
export const PHOTO_WEB_MAX_BYTES = 1.5 * 1024 * 1024;

/**
 * Long edge of a web copy, in pixels. The phone resizes to this.
 *
 * Two sizes, by where the original goes. With Google Drive keeping the
 * original, the copy only has to look good on a phone. With "this site"
 * the copy is all there is, so it is made large enough to print well up
 * to about 8x10 — roughly 350 KB instead of 150.
 */
export const PHOTO_WEB_MAX_EDGE_DRIVE = 1600;
export const PHOTO_WEB_MAX_EDGE_SITE = 2400;

/**
 * How much the site's own storage may hold in web copies, in bytes.
 *
 * Convex's free plan includes 1 GB of file storage; this keeps the wall
 * well inside it. At the cap, uploads stop and the hosts are told; deleting
 * photos makes room. Counted on the totals row, so checking it is one read.
 */
export const PHOTO_STORAGE_CAP_BYTES = 500 * 1024 * 1024;

/** A width or height past this is not a photo the wall can lay out. */
export const PHOTO_MAX_DIMENSION = 8000;

/** Photos per wall page, from the first server render and each scroll. */
export const PHOTO_PAGE_SIZE = 24;

/** The optional name shown under a guest's photos. */
export const PHOTO_UPLOADER_NAME_MAX = 60;

/**
 * How many bytes of originals may be on their way to Drive — opened and not
 * yet recorded — across the whole site, over the window below.
 *
 * This is what tells a party apart from a script. A hundred and fifty
 * guests with three 5 MB uploads in flight each hold about 2 GB open at
 * the busiest moment, and each upload leaves the count within seconds of
 * landing. A script that opens uploads and never records them holds its
 * bytes for the whole window, and stops at the budget: at most this much
 * of the hosts' Drive can ever be filled with unrecorded files, and the
 * folder reconcile takes those back.
 */
export const PHOTO_DRIVE_INFLIGHT_BUDGET_BYTES = 4 * 1024 * 1024 * 1024;
export const PHOTO_DRIVE_INFLIGHT_WINDOW_MS = 30 * 60 * 1000;
