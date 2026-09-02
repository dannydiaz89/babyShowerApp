import { describe, expect, it } from "vitest";
import { fitWithin } from "../../src/lib/image-prep";

/**
 * The resize arithmetic. The canvas work around it needs a browser; this is
 * the part that decides how big a web copy is, and so how much every guest
 * downloads scrolling the wall.
 */
describe("fitWithin", () => {
  it("scales a landscape photo down to the long edge", () => {
    expect(fitWithin({ width: 4032, height: 3024 }, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales a portrait photo down to the long edge", () => {
    expect(fitWithin({ width: 3024, height: 4032 }, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("never scales up", () => {
    expect(fitWithin({ width: 800, height: 600 }, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("keeps a square square", () => {
    expect(fitWithin({ width: 3000, height: 3000 }, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it("never rounds a thin strip to nothing", () => {
    expect(fitWithin({ width: 10000, height: 2 }, 1600).height).toBe(1);
  });

  it("answers zero for a size that is not a size", () => {
    expect(fitWithin({ width: 0, height: 100 }, 1600)).toEqual({ width: 0, height: 0 });
  });
});
