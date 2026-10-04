import type { Point } from "../board/cameraMath";
import type { ZoneBounds } from "../model/zone";
import {
  createShapeGrid,
  gridArea,
  gridHasThinRun,
  pointInShapeStrict,
  pointOnSegment,
  pruneGrid,
  roundCoordinate,
  shapeFromGrid,
  shapeRings,
} from "./shapeGrid";

/**
 * R4.6–R4.8 geometry for orthogonal polygons. A shape is one or more outer parts plus holes;
 * coordinates are in board units.
 */
export interface ZoneShape {
  /** Outer contours, clockwise in screen space (y down). Parts never overlap by area. */
  parts: Point[][];
  /** Holes, counter-clockwise, each inside exactly one part. */
  holes: Point[][];
}

/** No part, protrusion or remaining strip of a zone may be thinner than this (user decision 25.09: 30 u). */
export const MIN_ZONE_PART = 30;

/** Canonical form: removes duplicate and collinear points, fixes orientation, merges touching cells. */
export function normalizeShape(shape: ZoneShape): ZoneShape {
  return shapeFromGrid(createShapeGrid([shape]));
}

export function shapeArea(shape: ZoneShape): number {
  return gridArea(createShapeGrid([shape]));
}

export function shapeBounds(shape: ZoneShape): ZoneBounds {
  const points = shapeRings(shape).parts.flat();
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  return {
    x,
    y,
    width: Math.max(...points.map((point) => point.x)) - x,
    height: Math.max(...points.map((point) => point.y)) - y,
  };
}

/** Inside a part and not inside a hole; points exactly on any shape edge count as inside. */
export function shapeContainsPoint(shape: ZoneShape, point: Point): boolean {
  const rings = shapeRings(shape);
  const normalizedPoint = { x: roundCoordinate(point.x), y: roundCoordinate(point.y) };
  const allRings = [...rings.parts, ...rings.holes];
  if (allRings.some((ring) => ring.some((vertex, index) =>
    pointOnSegment(normalizedPoint, vertex, ring[(index + 1) % ring.length]),
  ))) return true;
  return pointInShapeStrict(rings, normalizedPoint);
}

/** Area of the shape that lies inside the rectangle (membership and marquee use it). */
export function shapeAreaInRect(shape: ZoneShape, rect: ZoneBounds): number {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return 0;
  const normalizedRect = normalizeBounds(rect);
  if (normalizedRect.width <= 0 || normalizedRect.height <= 0) return 0;
  // Parts never overlap and every hole lies inside one part, so the area is a plain sum of each ring
  // clipped to the rectangle. This runs for every note × zone pair whenever something moves; building
  // a shape grid per pair made dragging on a busy board stutter.
  let area = 0;
  for (const part of shape.parts) area += polygonArea(clipToRect(part, normalizedRect));
  for (const hole of shape.holes) area -= polygonArea(clipToRect(hole, normalizedRect));
  return Math.max(0, area);
}

/** Reference implementation on the shape grid (tests compare the fast path against it). */
export function shapeAreaInRectByGrid(shape: ZoneShape, rect: ZoneBounds): number {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return 0;
  const normalizedRect = normalizeBounds(rect);
  if (normalizedRect.width <= 0 || normalizedRect.height <= 0) return 0;
  return gridArea(createShapeGrid([shape], [normalizedRect]), normalizedRect);
}

/** Sutherland–Hodgman clip of any simple polygon against an axis-aligned rectangle. */
function clipToRect(polygon: readonly Point[], rect: ZoneBounds): Point[] {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  let points: Point[] = [...polygon];
  const edges: Array<[(p: Point) => boolean, (a: Point, b: Point) => Point]> = [
    [(p) => p.x >= rect.x, (a, b) => ({ x: rect.x, y: a.y + (b.y - a.y) * (rect.x - a.x) / (b.x - a.x) })],
    [(p) => p.x <= right, (a, b) => ({ x: right, y: a.y + (b.y - a.y) * (right - a.x) / (b.x - a.x) })],
    [(p) => p.y >= rect.y, (a, b) => ({ x: a.x + (b.x - a.x) * (rect.y - a.y) / (b.y - a.y), y: rect.y })],
    [(p) => p.y <= bottom, (a, b) => ({ x: a.x + (b.x - a.x) * (bottom - a.y) / (b.y - a.y), y: bottom })],
  ];
  for (const [inside, cut] of edges) {
    if (points.length === 0) return points;
    const input = points;
    points = [];
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index]!;
      const previous = input[(index + input.length - 1) % input.length]!;
      const currentIn = inside(current);
      if (currentIn) {
        if (!inside(previous)) points.push(cut(previous, current));
        points.push(current);
      } else if (inside(previous)) {
        points.push(cut(previous, current));
      }
    }
  }
  return points;
}

function polygonArea(points: readonly Point[]): number {
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** True when the two shapes share a positive area (touching edges are allowed, M020). */
export function shapesOverlap(a: ZoneShape, b: ZoneShape): boolean {
  const grid = createShapeGrid([a, b]);
  const first = shapeRings(a);
  const second = shapeRings(b);
  for (let row = 0; row < grid.cells.length; row += 1) {
    for (let column = 0; column < grid.cells[row].length; column += 1) {
      const point = {
        x: grid.xs[column] + (grid.xs[column + 1] - grid.xs[column]) / 2,
        y: grid.ys[row] + (grid.ys[row + 1] - grid.ys[row]) / 2,
      };
      if (pointInShapeStrict(first, point) && pointInShapeStrict(second, point)) return true;
    }
  }
  return false;
}

/**
 * Removes the rectangle from the shape (R4.8 cut-out). Holes and several parts are allowed; any
 * strip thinner than `minPart` that remains is dropped (M018). Returns null when nothing is left.
 */
export function subtractRect(shape: ZoneShape, rect: ZoneBounds, minPart = MIN_ZONE_PART): ZoneShape | null {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
    const unchanged = normalizeShape(shape);
    return unchanged.parts.length ? unchanged : null;
  }

  const normalizedRect = normalizeBounds(rect);
  if (normalizedRect.width <= 0 || normalizedRect.height <= 0) {
    const unchanged = normalizeShape(shape);
    return unchanged.parts.length ? unchanged : null;
  }
  const grid = createShapeGrid([shape], [normalizedRect]);
  for (let row = 0; row < grid.cells.length; row += 1) {
    const y = grid.ys[row] + (grid.ys[row + 1] - grid.ys[row]) / 2;
    for (let column = 0; column < grid.cells[row].length; column += 1) {
      const x = grid.xs[column] + (grid.xs[column + 1] - grid.xs[column]) / 2;
      if (x >= normalizedRect.x && x < normalizedRect.x + normalizedRect.width &&
        y >= normalizedRect.y && y < normalizedRect.y + normalizedRect.height) {
        grid.cells[row][column] = false;
      }
    }
  }
  return pruneGrid(grid, minPart) ? shapeFromGrid(grid) : null;
}

/**
 * Drops thin runs repeatedly until stable. In each iteration, a maximal contiguous run of filled
 * cells is removed when its horizontal width (within a row) or vertical height (within a column)
 * is less than minPart; e.g. a 100×100 zone cut into two 10-wide strips becomes null, while the
 * 30-wide frame around a central 40×40 hole is retained.
 */
export function pruneThin(shape: ZoneShape, minPart = MIN_ZONE_PART): ZoneShape | null {
  const grid = createShapeGrid([shape]);
  return pruneGrid(grid, minPart) ? shapeFromGrid(grid) : null;
}

/** True when some maximal horizontal or vertical filled run is thinner than minPart. */
export function hasThinPiece(shape: ZoneShape, minPart = MIN_ZONE_PART): boolean {
  return gridHasThinRun(createShapeGrid([shape]), minPart);
}

export function translateShape(shape: ZoneShape, delta: Point): ZoneShape {
  if (![delta.x, delta.y].every(Number.isFinite)) throw new RangeError("Zone translation must be finite.");
  return normalizeShape({
    parts: shape.parts.map((ring) => ring.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }))),
    holes: shape.holes.map((ring) => ring.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }))),
  });
}

function normalizeBounds(bounds: ZoneBounds): ZoneBounds {
  const x = roundCoordinate(bounds.x);
  const y = roundCoordinate(bounds.y);
  const right = roundCoordinate(bounds.x + bounds.width);
  const bottom = roundCoordinate(bounds.y + bounds.height);
  return { x, y, width: right - x, height: bottom - y };
}

/** Scales around `anchor` (Ctrl-drag of a corner scales the whole zone, M013). */
export function scaleShape(shape: ZoneShape, anchor: Point, scaleX: number, scaleY: number): ZoneShape {
  if (![anchor.x, anchor.y, scaleX, scaleY].every(Number.isFinite)) throw new RangeError("Zone scale must be finite.");
  return normalizeShape({
    parts: shape.parts.map((ring) => ring.map((point) => ({
      x: anchor.x + (point.x - anchor.x) * scaleX,
      y: anchor.y + (point.y - anchor.y) * scaleY,
    }))),
    holes: shape.holes.map((ring) => ring.map((point) => ({
      x: anchor.x + (point.x - anchor.x) * scaleX,
      y: anchor.y + (point.y - anchor.y) * scaleY,
    }))),
  });
}
