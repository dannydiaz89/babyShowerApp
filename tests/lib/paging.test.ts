import { describe, expect, it, vi } from "vitest";
import { collectPages, requestedRows, type Page } from "../../src/lib/paging";

/**
 * The dashboard table is where a host edits, merges and deletes a reply — the
 * CSV is read-only. A row this loop leaves behind is a guest who cannot be
 * managed at all, so "stops early" is a real failure, not a cosmetic one.
 */

/** A fake table of `total` rows, served `numItems` at a time. */
function tableOf(total: number) {
  const all = Array.from({ length: total }, (_, i) => `row-${i}`);
  return vi.fn(async (numItems: number, cursor: string | null): Promise<Page<string>> => {
    const from = cursor === null ? 0 : Number(cursor);
    const rows = all.slice(from, from + numItems);
    const next = from + rows.length;
    return { rows, cursor: String(next), done: next >= all.length };
  });
}

describe("requestedRows", () => {
  const bounds = { step: 200, max: 5000 };

  it("defaults to one page", () => {
    expect(requestedRows(undefined, bounds)).toBe(200);
    expect(requestedRows("", bounds)).toBe(200);
  });

  it("shows the newest replies rather than an empty table for junk input", () => {
    expect(requestedRows("all", bounds)).toBe(200);
    expect(requestedRows("-50", bounds)).toBe(200);
    expect(requestedRows("0", bounds)).toBe(200);
  });

  it("honours a larger request", () => {
    expect(requestedRows("400", bounds)).toBe(400);
    expect(requestedRows("1000", bounds)).toBe(1000);
  });

  it("clamps to a page that can still be rendered", () => {
    expect(requestedRows("999999", bounds)).toBe(5000);
    expect(requestedRows("Infinity", bounds)).toBe(200);
  });
});

describe("collectPages", () => {
  it("returns everything when the table is smaller than one page", async () => {
    const fetchPage = tableOf(30);
    const { rows, more } = await collectPages(fetchPage, 200, 200);

    expect(rows).toHaveLength(30);
    expect(more).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("walks several pages to reach what was asked for", async () => {
    const fetchPage = tableOf(1000);
    const { rows, more } = await collectPages(fetchPage, 400, 200);

    expect(rows).toHaveLength(400);
    expect(rows[0]).toBe("row-0");
    expect(rows[399]).toBe("row-399");
    expect(more).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("never reads more than a page at a time", async () => {
    const fetchPage = tableOf(1000);
    await collectPages(fetchPage, 600, 200);

    for (const [numItems] of fetchPage.mock.calls) expect(numItems).toBeLessThanOrEqual(200);
  });

  it("does not overshoot the last page it needs", async () => {
    const fetchPage = tableOf(1000);
    const { rows } = await collectPages(fetchPage, 250, 200);

    expect(rows).toHaveLength(250);
    // Second read asks for the 50 still missing, not another full page.
    expect(fetchPage.mock.calls[1][0]).toBe(50);
  });

  it("reports no more when the table ends exactly on a page boundary", async () => {
    const { rows, more } = await collectPages(tableOf(400), 400, 200);

    expect(rows).toHaveLength(400);
    expect(more).toBe(false);
  });

  it("reports more when the table ends one row past what was asked for", async () => {
    const { rows, more } = await collectPages(tableOf(401), 400, 200);

    expect(rows).toHaveLength(400);
    expect(more).toBe(true);
  });

  it("stops instead of spinning when a pager stops advancing", async () => {
    // Never done, never any rows — a loop with no guard would hang the page.
    const stuck = vi.fn(async () => ({ rows: [], cursor: "same", done: false }));
    const { rows, more } = await collectPages(stuck, 400, 200);

    expect(rows).toEqual([]);
    expect(more).toBe(true);
    expect(stuck).toHaveBeenCalledTimes(1);
  });

  it("stops when a pager keeps handing back the same cursor", async () => {
    const looping = vi.fn(async () => ({ rows: ["a"], cursor: null, done: false }));
    const { rows } = await collectPages(looping, 400, 200);

    expect(rows).toEqual(["a"]);
    expect(looping).toHaveBeenCalledTimes(1);
  });

  it("handles an empty table", async () => {
    const { rows, more } = await collectPages(tableOf(0), 200, 200);

    expect(rows).toEqual([]);
    expect(more).toBe(false);
  });
});
