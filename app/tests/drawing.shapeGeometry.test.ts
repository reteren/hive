import { describe, expect, it } from "vitest";
import { clampPolygonSides, editShapeDraft, rotatedShapeBounds, shapeDraftFromDrag, shapeSize, worldToLocal } from "../src/drawing/shapes/shapeGeometry";

describe("shape geometry", () => {
  it("keeps rectangles proportional with Shift and grows them from their centre with Alt", () => {
    const square = shapeDraftFromDrag("rectangle", { x: 10, y: 20 }, { x: 40, y: 35 }, { shift: true, alt: false });
    expect(shapeSize(square)).toEqual({ width: 30, height: 30 });
    expect(square.left).toBe(10);
    expect(square.top).toBe(20);

    const centred = shapeDraftFromDrag("ellipse", { x: 10, y: 20 }, { x: 15, y: 24 }, { shift: false, alt: true });
    expect(centred).toMatchObject({ left: 5, top: 16, right: 15, bottom: 24 });
  });

  it("snaps line direction to 15 degree increments while preserving its length", () => {
    const line = shapeDraftFromDrag("line", { x: 0, y: 0 }, { x: 10, y: 4 }, { shift: true, alt: false });
    const angle = Math.atan2((line.flipY ? -1 : 1) * (line.bottom - line.top), (line.flipX ? -1 : 1) * (line.right - line.left));
    expect(angle / (Math.PI / 12)).toBeCloseTo(Math.round(angle / (Math.PI / 12)), 8);
    expect(Math.hypot(line.right - line.left, line.bottom - line.top)).toBeCloseTo(Math.hypot(10, 4));
  });

  it("bounds rotated geometry and converts pointer coordinates back to the shape axes", () => {
    const draft = { ...shapeDraftFromDrag("rectangle", { x: 0, y: 0 }, { x: 20, y: 10 }, { shift: false, alt: false }), rotation: Math.PI / 2 };
    const bounds = rotatedShapeBounds(draft);
    expect(bounds.left).toBeCloseTo(5);
    expect(bounds.right).toBeCloseTo(15);
    expect(bounds.top).toBeCloseTo(-5);
    expect(bounds.bottom).toBeCloseTo(15);
    expect(worldToLocal({ x: 10, y: 0 }, draft)).toEqual({ x: 5, y: 5 });
  });

  it("moves and resizes from the opposite anchor without changing the other axis", () => {
    const start = shapeDraftFromDrag("rectangle", { x: 0, y: 0 }, { x: 20, y: 10 }, { shift: false, alt: false });
    const topHandleStart = worldToLocal({ x: 10, y: 0 }, start);
    const resized = editShapeDraft(start, { x: 10, y: -5 }, { kind: "resize", handle: 1 }, start, topHandleStart);
    expect(resized).toMatchObject({ left: 0, right: 20, top: -5, bottom: 10 });
    const moved = editShapeDraft(start, { x: 15, y: 15 }, { kind: "move" }, start, { x: 10, y: 5 });
    expect(moved).toMatchObject({ left: 5, top: 10, right: 25, bottom: 20 });
  });

  it("clamps polygon side counts to the supported range", () => {
    expect(clampPolygonSides(2)).toBe(3);
    expect(clampPolygonSides(8.6)).toBe(9);
    expect(clampPolygonSides(99)).toBe(12);
  });
});
