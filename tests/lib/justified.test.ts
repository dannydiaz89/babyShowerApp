import { describe, expect, it } from "vitest";
import { justifyRows } from "../../src/lib/justified";

/**
 * The arithmetic behind the wall's rows. What the wall looks like is
 * whatever this returns, so the properties are checked rather than eyeballed:
 * a full row spans the container to the pixel, photos keep their shape, and
 * the ragged last row is never blown up to fit.
 */

const OPTIONS = { containerWidth: 1000, targetHeight: 200, gap: 10 };

function photo(width: number, height: number) {
  return { width, height };
}

function rowWidth(row: { items: { width: number }[] }, gap: number): number {
  return row.items.reduce((sum, p) => sum + p.width, 0) + gap * (row.items.length - 1);
}

describe("justifyRows", () => {
  it("returns nothing for nothing", () => {
    expect(justifyRows([], OPTIONS)).toEqual([]);
    expect(justifyRows([photo(4, 3)], { ...OPTIONS, containerWidth: 0 })).toEqual([]);
  });

  it("fills every completed row to the container width exactly", () => {
    const photos = Array.from({ length: 12 }, (_, i) =>
      i % 3 === 0 ? photo(3, 4) : i % 3 === 1 ? photo(4, 3) : photo(1, 1)
    );
    const rows = justifyRows(photos, OPTIONS);

    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.slice(0, -1)) {
      expect(rowWidth(row, OPTIONS.gap)).toBe(OPTIONS.containerWidth);
    }
  });

  it("never renders a completed row taller than the target", () => {
    const photos = Array.from({ length: 20 }, (_, i) => photo(4 + (i % 5), 3));
    const rows = justifyRows(photos, OPTIONS);

    for (const row of rows) expect(row.height).toBeLessThanOrEqual(OPTIONS.targetHeight);
  });

  it("keeps each photo's proportions", () => {
    const rows = justifyRows([photo(3000, 2000), photo(2000, 3000), photo(1000, 1000)], OPTIONS);

    for (const row of rows) {
      for (const placed of row.items) {
        const wanted = placed.item.width / placed.item.height;
        // Rounding to whole pixels, plus the last box absorbing the remainder.
        expect(placed.width / placed.height).toBeCloseTo(wanted, 1);
      }
    }
  });

  it("leaves a short last row at the target height instead of stretching it", () => {
    // One landscape photo alone would need to be ~750px tall to fill 1000px.
    const rows = justifyRows([photo(4, 3)], OPTIONS);

    expect(rows).toHaveLength(1);
    expect(rows[0].height).toBe(OPTIONS.targetHeight);
    expect(rows[0].items[0].width).toBeLessThan(OPTIONS.containerWidth);
  });

  it("does not let a panorama collapse its row", () => {
    const rows = justifyRows([photo(6000, 1000), photo(1, 1)], OPTIONS);

    // Unclamped, 6:1 alone would already be a 166px row; clamped to 2.5:1 the
    // square joins it and both stay readable.
    for (const row of rows) expect(row.height).toBeGreaterThanOrEqual(150);
  });

  it("keeps the photos in order across rows", () => {
    const photos = Array.from({ length: 9 }, (_, i) => ({ ...photo(4, 3), id: i }));
    const rows = justifyRows(photos, OPTIONS);

    const ids = rows.flatMap((row) => row.items.map((p) => p.item.id));
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
