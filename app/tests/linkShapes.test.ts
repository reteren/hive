import { describe, expect, it } from "vitest";
import { buildShape, type LineShape, type ShapeInput } from "../src/links/shapes";

const shapes: LineShape[] = ["straight", "curved", "orthogonal", "wave", "zigzag"];

function input(start = { x: 0, y: 0 }, end = { x: 20, y: 0 }): ShapeInput {
  return {
    start,
    end,
    startNormal: { x: 1, y: 0 },
    endNormal: { x: -1, y: 0 },
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("buildShape", () => {
  it("keeps exact endpoints and finite endpoint tangents for every shape", () => {
    const geometry = input({ x: -3.25, y: 6.5 }, { x: 21.75, y: 11.125 });

    for (const shape of shapes) {
      const built = buildShape(shape, geometry);
      expect(built.polyline[0]).toEqual(geometry.start);
      expect(built.polyline.at(-1)).toEqual(geometry.end);
      expect(built.path.startsWith(`M ${geometry.start.x} ${geometry.start.y}`)).toBe(true);
      expect(built.path).toContain(`${geometry.end.x} ${geometry.end.y}`);
      expect(Number.isFinite(built.endTangent.x)).toBe(true);
      expect(Number.isFinite(built.endTangent.y)).toBe(true);
    }
  });

  it("builds a cubic curved route whose sampled geometry moves continuously", () => {
    const original = input({ x: 0, y: 0 }, { x: 30, y: 12 });
    const moved = input({ x: 0.01, y: -0.01 }, { x: 30.01, y: 12.02 });
    const before = buildShape("curved", original);
    const after = buildShape("curved", moved);

    expect(before.path).toContain(" C ");
    expect(before.polyline).toHaveLength(after.polyline.length);
    expect(Math.max(...before.polyline.map((point, index) => distance(point, after.polyline[index])))).toBeLessThan(0.1);
  });

  it("keeps the two-bend orthogonal route continuous as endpoints move", () => {
    const before = buildShape("orthogonal", input({ x: 1, y: 2 }, { x: 31, y: 14 }));
    const after = buildShape("orthogonal", input({ x: 1.01, y: 2 }, { x: 31.02, y: 14.01 }));

    expect(before.polyline.length).toBeGreaterThanOrEqual(3);
    expect(before.polyline).toHaveLength(after.polyline.length);
    expect(Math.max(...before.polyline.map((point, index) => distance(point, after.polyline[index])))).toBeLessThan(0.1);
  });

  it("gives the wave a regular world-space wavelength and stable amplitude", () => {
    const built = buildShape("wave", input());
    const peaks = built.polyline.filter((point, index, points) =>
      index > 0 && index < points.length - 1 && point.y > points[index - 1].y && point.y >= points[index + 1].y,
    );
    const spacing = peaks.slice(1).map((point, index) => point.x - peaks[index].x);

    expect(Math.max(...built.polyline.map(point => point.y))).toBeCloseTo(0.8, 1);
    expect(spacing.length).toBeGreaterThan(3);
    expect(spacing.every(value => value > 2.2 && value < 2.8)).toBe(true);
  });

  it("makes zigzag turns square and repeats its corner spacing", () => {
    const built = buildShape("zigzag", input());
    const verticalCorners = built.polyline.filter((point, index, points) =>
      index > 0 && point.x === points[index - 1].x && point.y !== points[index - 1].y,
    );
    const spacings = verticalCorners.slice(1, -1).map((point, index) => point.x - verticalCorners[index].x);

    expect(built.polyline.every((point, index, points) => {
      if (index === 0) return true;
      const previous = points[index - 1];
      return point.x === previous.x || point.y === previous.y;
    })).toBe(true);
    expect(Math.max(...built.polyline.map(point => Math.abs(point.y)))).toBeCloseTo(0.8, 5);
    expect(spacings.length).toBeGreaterThan(8);
    expect(spacings.every(value => value > 1.2 && value < 1.3)).toBe(true);
  });

  it("falls back to straight for zero and short routes and stays finite for bad or huge inputs", () => {
    for (const shape of shapes) {
      expect(buildShape(shape, input({ x: 4, y: 5 }, { x: 4, y: 5 })).polyline).toEqual([
        { x: 4, y: 5 }, { x: 4, y: 5 },
      ]);
      expect(buildShape(shape, input({ x: 0, y: 0 }, { x: 1, y: 1 })).polyline).toHaveLength(2);
    }

    const bad = buildShape("wave", {
      ...input({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, { x: 3, y: 1 }),
      startNormal: { x: Number.NaN, y: 0 },
    });
    const huge = buildShape("wave", input({ x: -500_000_000, y: 0 }, { x: 500_000_000, y: 0 }));
    for (const built of [bad, huge]) {
      expect(built.polyline.length).toBeLessThanOrEqual(257);
      expect(built.polyline.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
      expect(Number.isFinite(built.endTangent.x) && Number.isFinite(built.endTangent.y)).toBe(true);
      expect(built.path).not.toMatch(/NaN|Infinity/);
    }
  });
});
