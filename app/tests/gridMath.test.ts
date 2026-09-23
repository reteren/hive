import { describe, expect, it } from "vitest";
import { gridLineStride, isValidGridStep, snapToGrid } from "../src/board/gridMath";

describe("gridMath", () => {
  it("snaps both coordinates to the nearest step multiple", () => {
    expect(snapToGrid({ x: 13.2, y: -6.1 }, 5)).toEqual({ x: 15, y: -5 });
  });

  it("supports fractional custom steps and leaves the origin unchanged", () => {
    expect(snapToGrid({ x: 0.3, y: 0 }, 0.1).x).toBeCloseTo(0.3, 12);
    expect(snapToGrid({ x: 0, y: 0 }, 20)).toEqual({ x: 0, y: 0 });
  });

  it("rejects invalid grid steps", () => {
    for (const step of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isValidGridStep(step)).toBe(false);
      expect(() => snapToGrid({ x: 1, y: 2 }, step)).toThrow(RangeError);
    }
  });

  it("uses a coarser visual multiple at low zoom without changing the step", () => {
    expect(gridLineStride(10, 1)).toBe(1);
    expect(gridLineStride(10, 0.01)).toBe(8);
  });
});
