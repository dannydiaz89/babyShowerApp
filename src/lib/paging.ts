/**
 * Walking a paginated Convex query.
 *
 * Kept separate from the page that uses it so the loop can be tested: it
 * decides how much of the guest list a host can actually see, and getting it
 * wrong hides replies rather than failing loudly.
 */

export type Page<T> = { rows: T[]; cursor: string | null; done: boolean };

/**
 * How many rows a request asked for, clamped to something renderable.
 *
 * Anything unreadable falls back to one page rather than to zero, so a
 * mangled URL shows the newest replies instead of an empty table.
 */
export function requestedRows(
  raw: string | undefined,
  { step, max }: { step: number; max: number }
): number {
  const asked = Number(raw);
  if (!Number.isFinite(asked)) return step;
  return Math.min(max, Math.max(step, Math.round(asked)));
}

/**
 * Read pages until `wanted` rows are in hand or the table runs out.
 *
 * `more` says whether anything was left behind, which is what decides if the
 * caller offers to load more. Each individual read stays bounded, so this
 * grows in round trips rather than in the size of any one query.
 */
export async function collectPages<T>(
  fetchPage: (numItems: number, cursor: string | null) => Promise<Page<T>>,
  wanted: number,
  pageSize: number
): Promise<{ rows: T[]; more: boolean }> {
  const rows: T[] = [];
  let cursor: string | null = null;

  while (rows.length < wanted) {
    const page = await fetchPage(Math.min(pageSize, wanted - rows.length), cursor);
    rows.push(...page.rows);

    if (page.done) return { rows, more: false };

    /*
     * A pager that reports neither progress nor completion would otherwise
     * spin forever. Stopping and offering "load more" is the safe answer: it
     * shows what was read rather than hanging the dashboard.
     */
    if (page.rows.length === 0 || page.cursor === null || page.cursor === cursor) {
      return { rows, more: true };
    }

    cursor = page.cursor;
  }

  return { rows, more: true };
}
