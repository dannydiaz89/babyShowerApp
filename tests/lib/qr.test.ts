import { describe, expect, it } from "vitest";
import { qrCode } from "../../src/lib/qr";

/**
 * A QR nobody can scan is worse than no QR: it goes to the printer, comes back
 * on two hundred cards, and fails at the door. These check the parts of the
 * shape a scanner depends on.
 */

const URL = "https://shower.example/i/7QK4M2XR9T";

/** Whether the square at (col, row) is drawn. */
function isDark(path: string, col: number, row: number): boolean {
  return path.includes(`M${col} ${row}h1v1h-1z`);
}

describe("qrCode", () => {
  it("is a real QR version, plus a quiet zone on every side", () => {
    // Versions are 21, 25, 29 … modules; 8 more for the four-module border.
    const { size } = qrCode(URL);
    expect((size - 8 - 21) % 4).toBe(0);
    expect(size).toBeGreaterThanOrEqual(29);
  });

  it("leaves the quiet zone empty, which is how a scanner finds the code", () => {
    const { size, path } = qrCode(URL);
    for (let i = 0; i < size; i++) {
      for (const [col, row] of [
        [i, 0], [i, size - 1], [0, i], [size - 1, i],
        [i, 3], [i, size - 4], [3, i], [size - 4, i],
      ]) {
        expect(isDark(path, col, row)).toBe(false);
      }
    }
  });

  it("draws the three finder patterns", () => {
    const { size, path } = qrCode(URL);
    const q = 4;
    // Each corner marker is a 7x7 ring: dark at its outer edge, light just
    // inside it. Top-left, top-right, bottom-left — and nothing bottom-right.
    for (const [col, row] of [[q, q], [size - q - 7, q], [q, size - q - 7]]) {
      expect(isDark(path, col, row)).toBe(true);
      expect(isDark(path, col + 1, row + 1)).toBe(false);
      expect(isDark(path, col + 3, row + 3)).toBe(true);
    }
  });

  it("draws the alignment pattern, not a fourth finder, bottom right", () => {
    const { size, path } = qrCode(URL);
    // A 5x5 ring centred seven modules in from the bottom-right corner:
    // dark centre, light around it, dark again. A finder would be solid at
    // its centre three across, which is how these two tell each other apart.
    const centre = size - 4 - 7;
    expect(isDark(path, centre, centre)).toBe(true);
    expect(isDark(path, centre + 1, centre + 1)).toBe(false);
    expect(isDark(path, centre + 2, centre + 2)).toBe(true);
  });

  it("gives the same code for the same link, and a different one otherwise", () => {
    expect(qrCode(URL)).toEqual(qrCode(URL));
    expect(qrCode(`${URL}?next=%2Fphotos`).path).not.toBe(qrCode(URL).path);
  });

  it("grows rather than truncating when the link is longer", () => {
    const short = qrCode("https://a.example/i/7QK4M2XR9T");
    const long = qrCode(`https://a-rather-longer-domain-name.example/i/7QK4M2XR9T?next=%2Fphotos`);
    expect(long.size).toBeGreaterThan(short.size);
  });
});
