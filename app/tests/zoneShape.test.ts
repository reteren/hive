import { describe, expect, it } from "vitest";
import { rectContour, type ZoneBounds } from "../src/model/zone";
import {
  hasThinPiece,
  MIN_ZONE_PART,
  normalizeShape,
  pruneThin,
  scaleShape,
  shapeArea,
  shapeAreaInRect,
  shapeBounds,
  shapeContainsPoint,
  shapesOverlap,
  subtractRect,
  translateShape,
  type ZoneShape,
} from "../src/zones/shape";

function rectangle(x: number, y: number, width: number, height: number): ZoneShape {
  return { parts: [rectContour(x, y, width, height)], holes: [] };
}

function bounds(shape: ZoneShape): ZoneBounds {
  return shapeBounds(shape);
}

function signedArea(ring: readonly { x: number; y: number }[]): number {
  return ring.reduce((area, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

describe("orthogonal zone shape geometry", () => {
  it("round-trips a rectangle in canonical clockwise screen-space order", () => {
    const shape = rectangle(10, 20, 40, 30);
    expect(normalizeShape(shape)).toEqual(shape);
    expect(shapeArea(shape)).toBe(1_200);
    expect(bounds(shape)).toEqual({ x: 10, y: 20, width: 40, height: 30 });
  });

  it("normalizes L and U contours without filling their cut-outs", () => {
    const lShape: ZoneShape = {
      parts: [[
        { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 },
        { x: 10, y: 10 }, { x: 10, y: 40 }, { x: 0, y: 40 },
      ]],
      holes: [],
    };
    const uShape: ZoneShape = {
      parts: [[
        { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 40, y: 50 },
        { x: 40, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 50 }, { x: 0, y: 50 },
      ]],
      holes: [],
    };
    expect(shapeArea(normalizeShape(lShape))).toBe(700);
    expect(shapeContainsPoint(lShape, { x: 5, y: 30 })).toBe(true);
    expect(shapeContainsPoint(lShape, { x: 30, y: 30 })).toBe(false);
    expect(shapeArea(normalizeShape(uShape))).toBe(1_300);
    expect(shapeContainsPoint(uShape, { x: 25, y: 30 })).toBe(false);
    expect(shapeContainsPoint(uShape, { x: 5, y: 30 })).toBe(true);
  });

  it("preserves a hole, its edge, and its counter-clockwise orientation", () => {
    const shape: ZoneShape = {
      parts: [rectContour(0, 0, 100, 100)],
      holes: [rectContour(30, 30, 40, 40).reverse()],
    };
    const normalized = normalizeShape(shape);
    expect(normalized.parts).toHaveLength(1);
    expect(normalized.holes).toHaveLength(1);
    expect(shapeArea(normalized)).toBe(8_400);
    expect(signedArea(normalized.parts[0])).toBeGreaterThan(0);
    expect(signedArea(normalized.holes[0])).toBeLessThan(0);
    expect(shapeContainsPoint(normalized, { x: 10, y: 10 })).toBe(true);
    expect(shapeContainsPoint(normalized, { x: 50, y: 50 })).toBe(false);
    expect(shapeContainsPoint(normalized, { x: 30, y: 50 })).toBe(true);
  });

  it("merges edge-touching parts and treats near-equal coordinates as equal", () => {
    const normalized = normalizeShape({
      parts: [rectContour(0, 0, 10, 10), rectContour(10.0000004, 0, 10, 10)],
      holes: [],
    });
    expect(normalized.parts).toHaveLength(1);
    expect(normalized.parts[0]).toHaveLength(4);
    expect(shapeArea(normalized)).toBe(200);
    expect(bounds(normalized)).toEqual({ x: 0, y: 0, width: 20, height: 10 });
    expect(shapeArea(normalizeShape(rectangle(0, 0, 0.000001, 0.000001)))).toBeCloseTo(1e-12, 18);
  });

  it("removes duplicate and collinear vertices and fixes outer orientation", () => {
    const normalized = normalizeShape({
      parts: [[
        { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 },
        { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 0 },
      ]],
      holes: [],
    });
    expect(normalized.parts[0]).toEqual(rectContour(0, 0, 10, 10));
    expect(signedArea(normalized.parts[0])).toBeGreaterThan(0);
  });

  it("subtracts a cut that splits one zone into two parts", () => {
    const result = subtractRect(rectangle(0, 0, 100, 100), { x: 40, y: 0, width: 20, height: 100 });
    expect(result?.parts).toHaveLength(2);
    expect(result?.holes).toHaveLength(0);
    expect(shapeArea(result!)).toBe(8_000);
    expect(result?.parts.every((part) => signedArea(part) > 0)).toBe(true);
  });

  it("turns an edge cut into a notch rather than a hole", () => {
    const result = subtractRect(rectangle(0, 0, 100, 100), { x: 0, y: 30, width: 30, height: 40 });
    expect(result?.parts).toHaveLength(1);
    expect(result?.holes).toHaveLength(0);
    expect(shapeArea(result!)).toBe(8_800);
  });

  it("removes all of a covered shape and prunes narrow residual strips", () => {
    expect(subtractRect(rectangle(0, 0, 100, 100), { x: -10, y: -10, width: 120, height: 120 })).toBeNull();
    expect(subtractRect(rectangle(0, 0, 100, 100), { x: 10, y: 0, width: 80, height: 100 })).toBeNull();
  });

  it("keeps a frame whose strips are exactly the minimum thickness", () => {
    const frame = subtractRect(rectangle(0, 0, 100, 100), { x: 30, y: 30, width: 40, height: 40 });
    expect(frame?.parts).toHaveLength(1);
    expect(frame?.holes).toHaveLength(1);
    expect(shapeArea(frame!)).toBe(8_400);
    expect(hasThinPiece(frame!)).toBe(false);
    expect(MIN_ZONE_PART).toBe(30);
  });

  it("prunes thin parts and reports thin maximal horizontal or vertical runs", () => {
    const thinAndWide: ZoneShape = {
      parts: [rectContour(0, 0, 100, 100), rectContour(120, 0, 20, 20)],
      holes: [],
    };
    expect(hasThinPiece(thinAndWide)).toBe(true);
    const pruned = pruneThin(thinAndWide);
    expect(pruned?.parts).toHaveLength(1);
    expect(shapeArea(pruned!)).toBe(10_000);
    expect(pruneThin(rectangle(0, 0, 20, 100))).toBeNull();
  });

  it("counts partial area while respecting holes", () => {
    const shape: ZoneShape = {
      parts: [rectContour(0, 0, 100, 100)],
      holes: [rectContour(30, 30, 40, 40).reverse()],
    };
    expect(shapeAreaInRect(shape, { x: 0, y: 0, width: 50, height: 50 })).toBe(2_100);
    expect(shapeAreaInRect(shape, { x: 40, y: 40, width: 20, height: 20 })).toBe(0);
    expect(shapeAreaInRect(shape, { x: 100, y: 20, width: 10, height: 10 })).toBe(0);
  });

  it("detects positive-area overlap, but not touching edges or a shape inside a hole", () => {
    const outer = rectangle(0, 0, 100, 100);
    const ring: ZoneShape = {
      parts: outer.parts,
      holes: [rectContour(30, 30, 40, 40).reverse()],
    };
    expect(shapesOverlap(outer, rectangle(90, 90, 20, 20))).toBe(true);
    expect(shapesOverlap(outer, rectangle(100, 20, 10, 10))).toBe(false);
    expect(shapesOverlap(ring, rectangle(40, 40, 20, 20))).toBe(false);
    expect(shapesOverlap(ring, rectangle(20, 40, 20, 20))).toBe(true);
  });

  it("translates and scales all contours while keeping canonical geometry", () => {
    const original = rectangle(10, 20, 20, 10);
    expect(translateShape(original, { x: -5, y: 7 })).toEqual(rectangle(5, 27, 20, 10));
    const scaled = scaleShape(original, { x: 10, y: 20 }, 2, 3);
    expect(bounds(scaled)).toEqual({ x: 10, y: 20, width: 40, height: 30 });
    expect(shapeArea(scaled)).toBe(1_200);
    expect(shapeArea(scaleShape(original, { x: 10, y: 20 }, -1, 1))).toBe(200);
  });
});
