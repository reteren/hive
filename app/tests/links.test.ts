import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Point } from "../src/board/cameraMath";
import { clear, redo, undo } from "../src/history/history.svelte";
import type { Link } from "../src/model/link";
import { links, replaceLinks } from "../src/model/links.svelte";
import { canCreateLinkPair } from "../src/links/rules";
import { changeLinkShape, cutLinks } from "../src/links/operations";
import {
  clipSegmentToFrames,
  flattenPath,
  linePathBetweenFrames,
  nextLineShape,
  strokeIntersectsPath,
  type LinkPath,
} from "../src/links/lineGeometry";

describe("link pair rules", () => {
  it("allows one direction and kind per unordered pair, but permits cycles", () => {
    const existing = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    expect(canCreateLinkPair("b", "a", existing)).toBe(false);
    expect(canCreateLinkPair("a", "a", existing)).toBe(false);
    expect(canCreateLinkPair("c", "a", existing)).toBe(true);
  });
});

describe("line geometry", () => {
  it("clips the endpoints to the facing borders of note frames", () => {
    expect(clipSegmentToFrames(
      { x: 0, y: 0, width: 10, height: 8 },
      { x: 20, y: 2, width: 10, height: 8 },
    )).toEqual({ start: { x: 10, y: 4.5 }, end: { x: 20, y: 5.5 } });
  });

  it("clips diagonal links to frame corners without reaching text centres", () => {
    const segment = clipSegmentToFrames(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 20, width: 10, height: 10 },
    );
    expect(segment.start).toEqual({ x: 10, y: 10 });
    expect(segment.end).toEqual({ x: 20, y: 20 });
  });

  it("cycles the line creation option through all supported shapes", () => {
    expect(nextLineShape("straight")).toBe("curved");
    expect(nextLineShape("curved")).toBe("orthogonal");
    expect(nextLineShape("orthogonal")).toBe("straight");
  });

  it.each(["straight", "curved", "orthogonal"] as const)("keeps %s endpoints clipped to note frames", (shape) => {
    const source = { x: 0, y: 0, width: 10, height: 8 };
    const target = { x: 24, y: 16, width: 12, height: 10 };
    const path = linePathBetweenFrames(shape, source, target);
    const [start, end] = endpoints(path);

    expect(pointOnFrame(start, source)).toBe(true);
    expect(pointOnFrame(end, target)).toBe(true);
  });

  it("uses a cubic route for curved lines and axis-aligned elbows for orthogonal lines", () => {
    const source = { x: 0, y: 0, width: 10, height: 8 };
    const target = { x: 24, y: 16, width: 12, height: 10 };
    const curved = linePathBetweenFrames("curved", source, target);
    const orthogonal = linePathBetweenFrames("orthogonal", source, target);

    expect(curved.type).toBe("cubic");
    expect(orthogonal.type).toBe("polyline");
    if (orthogonal.type === "polyline") {
      expect(orthogonal.points.length).toBeGreaterThanOrEqual(3);
      for (let index = 1; index < orthogonal.points.length; index += 1) {
        const previous = orthogonal.points[index - 1];
        const current = orthogonal.points[index];
        expect(previous.x === current.x || previous.y === current.y).toBe(true);
      }
    }
  });

  it.each(["straight", "curved", "orthogonal"] as const)("intersects a drawn cut stroke against %s geometry", (shape) => {
    const path = linePathBetweenFrames(shape, { x: 0, y: 0, width: 10, height: 8 }, { x: 24, y: 16, width: 12, height: 10 });
    const route = flattenPath(path);
    const crossing = perpendicularStroke(route);

    expect(strokeIntersectsPath(crossing, path)).toBe(true);
    expect(strokeIntersectsPath([{ x: -100, y: -100 }, { x: -90, y: -100 }], path)).toBe(false);
  });
});

describe("cutting links", () => {
  const original: Link[] = [
    { id: "one", from: "a", to: "b", kind: "strong", shape: "curved" },
    { id: "two", from: "c", to: "d", kind: "weak", shape: "orthogonal" },
    { id: "three", from: "e", to: "f", kind: "strong", shape: "straight" },
  ];

  beforeEach(() => {
    clear();
    replaceLinks(original.map((link) => ({ ...link })));
  });

  afterEach(() => clear());

  it("records a selected line shape change as a reversible history operation", () => {
    expect(changeLinkShape("one", "orthogonal")).toBe(true);
    expect(links.byId.one.shape).toBe("orthogonal");
    expect(undo()?.label).toBe("Line shape");
    expect(links.byId.one.shape).toBe("curved");
    expect(redo()?.label).toBe("Line shape");
    expect(links.byId.one.shape).toBe("orthogonal");
  });

  it("cuts multiple links as one operation and undo restores the exact ids and fields", () => {
    expect(cutLinks(["one", "two", "one", "missing"])).toBe(true);
    expect(Object.keys(links.byId).sort()).toEqual(["three"]);

    expect(undo()?.label).toBe("Cut lines");
    expect(Object.values(links.byId).sort(byId)).toEqual([...original].sort(byId));
  });
});

function endpoints(path: LinkPath): [Point, Point] {
  return path.type === "cubic"
    ? [path.points[0], path.points[3]]
    : [path.points[0], path.points.at(-1)!];
}

function pointOnFrame(point: Point, bounds: { x: number; y: number; width: number; height: number }): boolean {
  const onHorizontal = Math.abs(point.y - bounds.y) < 1e-8 || Math.abs(point.y - (bounds.y + bounds.height)) < 1e-8;
  const onVertical = Math.abs(point.x - bounds.x) < 1e-8 || Math.abs(point.x - (bounds.x + bounds.width)) < 1e-8;
  return (onHorizontal && point.x >= bounds.x && point.x <= bounds.x + bounds.width) ||
    (onVertical && point.y >= bounds.y && point.y <= bounds.y + bounds.height);
}

function perpendicularStroke(route: readonly Point[]): Point[] {
  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-4) continue;
    const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const normal = { x: -dy / length, y: dx / length };
    return [
      { x: middle.x - normal.x * 5, y: middle.y - normal.y * 5 },
      { x: middle.x + normal.x * 5, y: middle.y + normal.y * 5 },
    ];
  }
  throw new Error("Expected a route with a non-zero segment");
}

function byId(left: Link, right: Link): number {
  return left.id.localeCompare(right.id);
}
