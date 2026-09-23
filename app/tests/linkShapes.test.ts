import { describe, expect, it } from "vitest";
import { buildArrowGeometry, buildShape, type LineShape, type ShapeInput } from "../src/links/shapes";

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

function distanceAlongRoute(points: readonly { x: number; y: number }[], target: { x: number; y: number }): number {
  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const length = Math.sqrt(lengthSquared);
    const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
      ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSquared,
    ));
    const projected = { x: start.x + dx * ratio, y: start.y + dy * ratio };
    if (distance(projected, target) < 1e-7) return traversed + length * ratio;
    traversed += length;
  }
  return Number.NaN;
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

  it("builds a smooth curved route that moves continuously with its endpoints", () => {
    const original = input({ x: 0, y: 0 }, { x: 30, y: 12 });
    const moved = input({ x: 0.01, y: -0.01 }, { x: 30.01, y: 12.02 });
    const before = buildShape("curved", original);
    const after = buildShape("curved", moved);

    expect(before.path).toContain(" C ");
    expect(distance(before.polyline[0], after.polyline[0])).toBeCloseTo(0.014, 2);
    expect(distance(before.polyline.at(-1)!, after.polyline.at(-1)!)).toBeCloseTo(0.022, 2);
    expect(before.polyline.length).toBeGreaterThan(100);
  });

  it("keeps the orthogonal route axis aligned", () => {
    const built = buildShape("orthogonal", input({ x: 1, y: 2 }, { x: 31, y: 14 }));
    expect(built.polyline.length).toBeGreaterThanOrEqual(3);
    expect(built.polyline.every((point, index, points) => index === 0 ||
      point.x === points[index - 1].x || point.y === points[index - 1].y)).toBe(true);
  });

  it("renders a smooth sine wave with roughly 3u wavelength, 0.75u amplitude, and straight leads", () => {
    const built = buildShape("wave", input());
    const positivePeaks = built.polyline.filter((point, index, points) =>
      index > 0 && index < points.length - 1 && point.y > 0.4 &&
      point.y > points[index - 1].y && point.y >= points[index + 1].y,
    );
    const spacing = positivePeaks.slice(1).map((point, index) => point.x - positivePeaks[index].x);

    expect(Math.max(...built.polyline.map(point => point.y))).toBeCloseTo(0.75, 2);
    expect(spacing.length).toBeGreaterThan(3);
    expect(spacing.every(value => value > 2.8 && value < 3.2)).toBe(true);
    expect(distance(built.polyline[0], built.polyline[1])).toBeCloseTo(1, 1);
    expect(distance(built.polyline.at(-2)!, built.polyline.at(-1)!)).toBeCloseTo(1, 1);
    expect(built.path).toContain(" C ");
  });

  it("renders a triangular 45-degree zigzag with 3u peak periods and straight leads", () => {
    const built = buildShape("zigzag", input());
    const positivePeaks = built.polyline.filter((point, index, points) =>
      index > 0 && index < points.length - 1 && point.y > 0.4 &&
      point.y > points[index - 1].y && point.y >= points[index + 1].y,
    );
    const periods = positivePeaks.slice(1).map((point, index) => point.x - positivePeaks[index].x);

    expect(Math.max(...built.polyline.map(point => Math.abs(point.y)))).toBeCloseTo(0.75, 5);
    expect(periods.length).toBeGreaterThan(2);
    expect(periods.every(value => value > 2.8 && value < 3.2)).toBe(true);
    expect(built.polyline[0]).toEqual({ x: 0, y: 0 });
    expect(built.polyline.at(-1)).toEqual({ x: 20, y: 0 });
    expect(distance(built.polyline[0], built.polyline[1])).toBeCloseTo(1, 1);
    expect(distance(built.polyline.at(-2)!, built.polyline.at(-1)!)).toBeCloseTo(1, 1);
    expect(built.polyline.slice(1, -2).every((point, index) => {
      const next = built.polyline[index + 2];
      const slope = Math.abs((next.y - point.y) / (next.x - point.x));
      return Math.abs(slope - 1) < 0.1;
    })).toBe(true);
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
      expect(built.polyline.length).toBeLessThanOrEqual(515);
      expect(built.polyline.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
      expect(Number.isFinite(built.endTangent.x) && Number.isFinite(built.endTangent.y)).toBe(true);
      expect(built.path).not.toMatch(/NaN|Infinity/);
    }
  });

  it.each(shapes)("places the %s arrow tip at the frame endpoint and trims the shaft to the head base", (shape) => {
    const geometry = buildShape(shape, input({ x: 0, y: 0 }, { x: 20, y: 0 }));
    const arrow = buildArrowGeometry(shape, geometry);
    const tip = geometry.polyline.at(-1)!;
    const routeLength = geometry.polyline.slice(1).reduce((total, point, index) =>
      total + distance(geometry.polyline[index], point), 0);
    const distanceToBase = distanceAlongRoute(geometry.polyline, arrow.base);

    expect(arrow.tip).toEqual(tip);
    expect(arrow.headPath.startsWith(`M ${tip.x} ${tip.y} L `)).toBe(true);
    expect(arrow.shaftPath.endsWith(` ${arrow.base.x} ${arrow.base.y}`)).toBe(true);
    expect(routeLength - distanceToBase).toBeCloseTo(1.6, 1);
    expect(arrow.tangent.x).toBeGreaterThan(0.98);
  });
});
