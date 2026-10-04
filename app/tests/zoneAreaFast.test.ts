import { describe, expect, it } from "vitest";
import { normalizeShape, shapeAreaInRect, shapeAreaInRectByGrid, type ZoneShape } from "../src/zones/shape";

const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

const shapes: Record<string, ZoneShape> = {
  square: { parts: [rect(0, 0, 60, 60)], holes: [] },
  lShape: normalizeShape({ parts: [rect(0, 0, 90, 30), rect(0, 30, 30, 60)], holes: [] }),
  withHole: { parts: [rect(0, 0, 120, 120)], holes: [rect(40, 40, 40, 40).reverse()] },
  twoParts: { parts: [rect(0, 0, 40, 40), rect(100, 0, 40, 40)], holes: [] },
};

describe("zone area inside a rectangle (fast clip vs shape grid)", () => {
  it("matches the grid reference on many rectangles", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [name, shape] of Object.entries(shapes)) {
      for (let index = 0; index < 120; index += 1) {
        const box = { x: random() * 160 - 20, y: random() * 160 - 20, width: random() * 70 + 0.5, height: random() * 70 + 0.5 };
        expect(shapeAreaInRect(shape, box), `${name} ${JSON.stringify(box)}`).toBeCloseTo(shapeAreaInRectByGrid(shape, box), 6);
      }
    }
  });

  it("is zero for empty or disjoint rectangles", () => {
    expect(shapeAreaInRect(shapes.square!, { x: 100, y: 100, width: 10, height: 10 })).toBe(0);
    expect(shapeAreaInRect(shapes.square!, { x: 10, y: 10, width: 0, height: 10 })).toBe(0);
    expect(shapeAreaInRect(shapes.withHole!, { x: 50, y: 50, width: 10, height: 10 })).toBeCloseTo(0, 9);
  });
});
