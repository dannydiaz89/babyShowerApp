/**
 * The justified row layout behind the photo wall.
 *
 * Every row is flush left and right, like a magazine spread, and the photos
 * in it keep their own proportions: a row's height is whatever makes its
 * members exactly fill the width. Rows are closed as soon as they can be
 * fitted at or below the target height, so photos never stretch past it.
 *
 * Pure, so the arithmetic that decides what the wall looks like can be
 * tested without a browser.
 */

export type Box = { width: number; height: number };

export type Placed<T> = { item: T; width: number; height: number };

export type Row<T> = { items: Placed<T>[]; height: number };

export type JustifyOptions = {
  /** The width every completed row fills exactly. */
  containerWidth: number;
  /** Rows close once they fit at or below this. */
  targetHeight: number;
  /** Space between photos in a row, in the same units. */
  gap: number;
};

/**
 * A panorama or a tall crop would otherwise dominate or vanish: one 6:1
 * photo alone in a row would render sixty pixels tall. Aspect ratios are
 * clamped for the purpose of layout only; the image itself is shown
 * cropped to the box by the caller.
 */
const MIN_RATIO = 0.5;
const MAX_RATIO = 2.5;

function ratioOf(box: Box): number {
  const raw = box.width > 0 && box.height > 0 ? box.width / box.height : 1;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, raw));
}

/**
 * Size a row's members to fill `containerWidth` at `height`.
 *
 * Widths are rounded to whole units, and whatever the rounding leaves over
 * goes to the last photo, so the row's boxes plus gaps add up to the
 * container exactly rather than a pixel short.
 */
function place<T extends Box>(
  items: T[],
  height: number,
  { containerWidth, gap }: JustifyOptions,
  fill: boolean
): Placed<T>[] {
  const placed = items.map((item) => ({
    item,
    width: Math.round(ratioOf(item) * height),
    height: Math.round(height),
  }));

  if (fill && placed.length > 0) {
    const used = placed.reduce((sum, p) => sum + p.width, 0) + gap * (placed.length - 1);
    placed[placed.length - 1].width += containerWidth - used;
  }

  return placed;
}

export function justifyRows<T extends Box>(items: T[], options: JustifyOptions): Row<T>[] {
  const { containerWidth, targetHeight, gap } = options;
  if (containerWidth <= 0 || targetHeight <= 0 || items.length === 0) return [];

  const rows: Row<T>[] = [];
  let current: T[] = [];
  let ratioSum = 0;

  for (const item of items) {
    current.push(item);
    ratioSum += ratioOf(item);

    const height = (containerWidth - gap * (current.length - 1)) / ratioSum;
    if (height <= targetHeight) {
      rows.push({ items: place(current, height, options, true), height: Math.round(height) });
      current = [];
      ratioSum = 0;
    }
  }

  /*
   * Whatever is left did not reach the width on its own. It stays at the
   * target height and ragged on the right rather than being stretched to
   * fit: two photos blown up to fill a row look wrong, and this row is
   * usually the one still loading more.
   */
  if (current.length > 0) {
    const natural = (containerWidth - gap * (current.length - 1)) / ratioSum;
    const height = Math.min(targetHeight, natural);
    rows.push({
      items: place(current, height, options, natural <= targetHeight),
      height: Math.round(height),
    });
  }

  return rows;
}
