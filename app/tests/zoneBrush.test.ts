import { describe, expect, it } from "vitest";
import { rectContour } from "../src/model/zone";
import {
  BRUSH_MAX,
  BRUSH_MIN,
  BRUSH_STEP,
  brushSegmentShape,
  brushSquare,
  eraseStroke,
  normalizeBrushSize,
  paintStroke,
  subtractShapes,
  unionShapes,
  ZONE_MIN_THICKNESS,
} from "../src/zones/brush";
import { shapeArea, shapeBounds, shapeContainsPoint, type ZoneShape } from "../src/zones/shape";

function rectangle(x: number, y: number, width: number, height: number): ZoneShape {
  return { parts: [rectContour(x, y, width, height)], holes: [] };
}

describe("zone brush geometry", () => {
  it("normalizes brush size to 20-unit steps and clamps it", () => {
    expect(normalizeBrushSize(Number.NaN)).toBe(BRUSH_MIN);
    expect(normalizeBrushSize(-50)).toBe(BRUSH_MIN);
    expect(normalizeBrushSize(21)).toBe(20);
    expect(normalizeBrushSize(30)).toBe(40);
    expect(normalizeBrushSize(287)).toBe(280);
    expect(normalizeBrushSize(BRUSH_MAX + 20)).toBe(BRUSH_MAX);
    expect(BRUSH_STEP).toBe(20);
  });

  it("snaps the square top-left to the 10-unit grid", () => {
    expect(brushSquare({ x: 14, y: -14 }, 20)).toEqual({ x: 0, y: -20, width: 20, height: 20 });
    // Math.round(-0.5) is negative zero, so an exact negative half-step resolves to zero.
    expect(brushSquare({ x: 5, y: 5 }, 20)).toEqual({ x: 0, y: 0, width: 20, height: 20 });
  });

  it("leaves no gaps on a long fast pointer move", () => {
    const stroke = brushSegmentShape({ x: 0, y: 0 }, { x: 2_000, y: 0 }, 20);
    expect(stroke.parts).toHaveLength(1);
    expect(stroke.holes).toHaveLength(0);
    expect(shapeBounds(stroke)).toEqual({ x: -10, y: -10, width: 2_020, height: 20 });
    expect(shapeArea(stroke)).toBe(40_400);
    expect(shapeContainsPoint(stroke, { x: 1_000, y: 0 })).toBe(true);
  });

  it("keeps diagonal fast moves covered after snapping stamps to the grid", () => {
    const stroke = brushSegmentShape({ x: 0, y: 0 }, { x: 200, y: 200 }, 20);
    for (let position = 0; position <= 200; position += 10) {
      expect(shapeContainsPoint(stroke, { x: position, y: position })).toBe(true);
    }
  });

  it("keeps typical accumulation of 200 moves fast", () => {
    const started = performance.now();
    let accumulated: ZoneShape | null = null;
    for (let move = 0; move < 200; move += 1) {
      const segment = brushSegmentShape({ x: move * 10, y: 0 }, { x: (move + 1) * 10, y: 0 }, 20);
      accumulated = unionShapes(accumulated ? [accumulated, segment] : [segment]);
    }
    expect(performance.now() - started).toBeLessThan(50);
    expect(accumulated && shapeArea(accumulated)).toBe(40_400);
  });

  it("unions overlapping and edge-touching shapes", () => {
    const result = unionShapes([rectangle(0, 0, 20, 20), rectangle(20, 0, 20, 20)]);
    expect(result?.parts).toHaveLength(1);
    expect(result?.holes).toHaveLength(0);
    expect(shapeBounds(result!)).toEqual({ x: 0, y: 0, width: 40, height: 20 });
    expect(shapeArea(result!)).toBe(800);
    expect(unionShapes([])).toBeNull();
  });

  it("preserves a painted island inside an existing hole", () => {
    const donut: ZoneShape = {
      parts: [rectContour(0, 0, 100, 100)],
      holes: [rectContour(30, 30, 40, 40).reverse()],
    };
    const result = unionShapes([donut, rectangle(40, 40, 20, 20)]);
    expect(result?.parts).toHaveLength(2);
    expect(result?.holes).toHaveLength(1);
    expect(shapeArea(result!)).toBe(8_800);
    expect(shapeContainsPoint(result!, { x: 50, y: 50 })).toBe(true);
    expect(shapeContainsPoint(result!, { x: 35, y: 35 })).toBe(false);
  });

  it("subtracts multiple cut shapes and prunes a leftover thinner than 20 units", () => {
    const result = subtractShapes(rectangle(0, 0, 100, 100), [rectangle(10, 0, 80, 100)]);
    expect(result).toBeNull();
    expect(ZONE_MIN_THICKNESS).toBe(20);
  });

  it("paints a new zone on empty board and grows the selected zone", () => {
    const stroke = rectangle(20, 0, 40, 40);
    const created = paintStroke(stroke, null, []);
    expect(created.zoneId).toBeNull();
    expect(shapeArea(created.shape!)).toBe(1_600);

    const target = { id: "target", shape: rectangle(0, 0, 40, 40) };
    const grown = paintStroke(rectangle(30, 0, 30, 40), "target", [target]);
    expect(grown.zoneId).toBe("target");
    expect(shapeBounds(grown.shape!)).toEqual({ x: 0, y: 0, width: 60, height: 40 });
    expect(shapeArea(grown.shape!)).toBe(2_400);
  });

  it("clips paint against every neighbouring zone and refuses fully covered paint", () => {
    const target = { id: "target", shape: rectangle(0, 0, 40, 40) };
    const neighbour = { id: "neighbour", shape: rectangle(50, 0, 40, 40) };
    const grown = paintStroke(rectangle(30, 0, 40, 40), "target", [target, neighbour]);
    expect(grown.shape && shapeBounds(grown.shape)).toEqual({ x: 0, y: 0, width: 50, height: 40 });
    expect(shapeArea(grown.shape!)).toBe(2_000);
    expect(paintStroke(rectangle(55, 5, 20, 20), null, [neighbour])).toEqual({ zoneId: null, shape: null });
  });

  it("erases into two parts but keeps the original zone identity", () => {
    const result = eraseStroke(rectangle(40, 0, 20, 100), [{ id: "split", shape: rectangle(0, 0, 100, 100) }]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0].id).toBe("split");
    expect(result.changed[0].shape.parts).toHaveLength(2);
    expect(result.changed[0].shape.holes).toHaveLength(0);
    expect(shapeArea(result.changed[0].shape)).toBe(8_000);
  });

  it("reports a completely erased zone for removal", () => {
    const result = eraseStroke(rectangle(-10, -10, 120, 120), [{ id: "all", shape: rectangle(0, 0, 100, 100) }]);
    expect(result).toEqual({ changed: [], removed: ["all"] });
  });

  it("erases every intersected zone and omits untouched zones", () => {
    const result = eraseStroke(rectangle(40, 0, 20, 100), [
      { id: "split", shape: rectangle(0, 0, 100, 100) },
      { id: "removed", shape: rectangle(45, 45, 10, 10) },
      { id: "untouched", shape: rectangle(200, 0, 40, 40) },
    ]);
    expect(result.changed.map(({ id }) => id)).toEqual(["split"]);
    expect(result.changed[0].shape.parts).toHaveLength(2);
    expect(result.removed).toEqual(["removed"]);
  });
});
