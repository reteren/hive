import { describe, expect, it } from "vitest";
import { buildArrowGeometry, buildShape } from "../src/links/shapes";

type P = { x: number; y: number };

function parseCubic(path: string): [P, P, P, P] {
  const n = path.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)!.map(Number);
  expect(n).toHaveLength(8);
  return [{ x: n[0], y: n[1] }, { x: n[2], y: n[3] }, { x: n[4], y: n[5] }, { x: n[6], y: n[7] }];
}

function at([a, b, c, d]: [P, P, P, P], t: number): P {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}

describe("base line shaft is one exact cubic", () => {
  const cases = [
    { start: { x: 0, y: 0 }, end: { x: 120, y: 40 }, startNormal: { x: 1, y: 0 }, endNormal: { x: -1, y: 0 } },
    { start: { x: 10, y: 10 }, end: { x: -30, y: 200 }, startNormal: { x: 0, y: 1 }, endNormal: { x: 0, y: -1 } },
    { start: { x: 0, y: 0 }, end: { x: 6, y: 1 }, startNormal: { x: 1, y: 0 }, endNormal: { x: 0, y: 1 } },
  ];

  it.each(cases)("follows the sampled curve and ends at the arrow base", (input) => {
    const shape = buildShape("base", input);
    const arrow = buildArrowGeometry("base", shape);
    expect(arrow.shaftPath.split("C")).toHaveLength(2);
    const cubic = parseCubic(arrow.shaftPath);
    const samples = Array.from({ length: 8001 }, (_, index) => at(cubic, index / 8000));
    // Every sampled point of the original route before the base lies on the new shaft.
    const shaftLength = arrow.shaftLength;
    let walked = 0;
    for (let index = 0; index < shape.polyline.length; index += 1) {
      if (index > 0) walked += Math.hypot(shape.polyline[index].x - shape.polyline[index - 1].x, shape.polyline[index].y - shape.polyline[index - 1].y);
      if (walked > shaftLength) break;
      const point = shape.polyline[index];
      const nearest = Math.min(...samples.map((sample) => Math.hypot(sample.x - point.x, sample.y - point.y)));
      expect(nearest).toBeLessThan(0.02);
    }
    const end = at(cubic, 1);
    expect(Math.hypot(end.x - arrow.base.x, end.y - arrow.base.y)).toBeLessThan(0.01);
  });
});
