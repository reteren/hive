import type { Point } from "../board/cameraMath";
import type { Bounds } from "../notes/layout.svelte";
import type { Link } from "../model/link";

export type LineShape = Link["shape"];

export type LinkPath =
  | { type: "polyline"; points: Point[] }
  | { type: "cubic"; points: [Point, Point, Point, Point] };

export interface ClippedSegment {
  start: Point;
  end: Point;
}

const SHAPES: readonly LineShape[] = ["base", "orthogonal", "zigzag", "wave"];
const EPSILON = 1e-9;

/** Clip a centre-to-centre segment to the rectangular note frames. */
export function clipSegmentToFrames(source: Bounds, target: Bounds): ClippedSegment {
  const sourceCenter = center(source);
  const targetCenter = center(target);
  let dx = targetCenter.x - sourceCenter.x;
  let dy = targetCenter.y - sourceCenter.y;
  if (dx === 0 && dy === 0) dx = 1;

  return {
    start: pointOnFrame(source, dx, dy),
    end: pointOnFrame(target, -dx, -dy),
  };
}

export function nextLineShape(shape: LineShape): LineShape {
  const index = SHAPES.indexOf(shape);
  return SHAPES[(index + 1) % SHAPES.length];
}

/** Return the exact SVG route and board-space geometry used for drawing and cutting. */
export function linePathBetweenFrames(shape: LineShape, source: Bounds, target: Bounds): LinkPath {
  if (shape === "orthogonal") return orthogonalPath(source, target);

  const segment = clipSegmentToFrames(source, target);
  if (shape === "base") return curvedPath(source, target, segment);
  return curvedPath(source, target, segment);
}

export function pathData(path: LinkPath): string {
  if (path.type === "cubic") {
    const [start, firstControl, secondControl, end] = path.points;
    return `M ${start.x} ${start.y} C ${firstControl.x} ${firstControl.y}, ${secondControl.x} ${secondControl.y}, ${end.x} ${end.y}`;
  }

  return path.points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

export function scalePath(path: LinkPath, scale: number): LinkPath {
  const scalePoint = (point: Point): Point => ({ x: point.x * scale, y: point.y * scale });
  return path.type === "cubic"
    ? { type: "cubic", points: path.points.map(scalePoint) as [Point, Point, Point, Point] }
    : { type: "polyline", points: path.points.map(scalePoint) };
}

/** Flatten a route for exact segment intersection checks; only cubics are approximated. */
export function flattenPath(path: LinkPath, cubicSteps = 48): Point[] {
  if (path.type === "polyline") return path.points;
  const [start, firstControl, secondControl, end] = path.points;
  const steps = Math.max(1, Math.floor(cubicSteps));
  const points: Point[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const inverse = 1 - t;
    points.push({
      x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * firstControl.x +
        3 * inverse * t ** 2 * secondControl.x + t ** 3 * end.x,
      y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * firstControl.y +
        3 * inverse * t ** 2 * secondControl.y + t ** 3 * end.y,
    });
  }

  return points;
}

/** Whether a drawn polyline touches a rendered route, with an optional board-space tolerance. */
export function strokeIntersectsPath(stroke: readonly Point[], path: LinkPath, tolerance = 0): boolean {
  if (stroke.length < 2) return false;
  const route = flattenPath(path);
  const allowedDistance = Math.max(0, tolerance);
  if (!boundsOverlap(pointsBounds(stroke), pointsBounds(route), allowedDistance)) return false;

  for (let strokeIndex = 1; strokeIndex < stroke.length; strokeIndex += 1) {
    const strokeStart = stroke[strokeIndex - 1];
    const strokeEnd = stroke[strokeIndex];
    for (let routeIndex = 1; routeIndex < route.length; routeIndex += 1) {
      const routeStart = route[routeIndex - 1];
      const routeEnd = route[routeIndex];
      if (segmentsTouch(strokeStart, strokeEnd, routeStart, routeEnd, allowedDistance)) return true;
    }
  }

  return false;
}

/** Whether any part of a rendered route touches the marquee rectangle. */
export function marqueeIntersectsPath(bounds: Bounds, path: LinkPath): boolean {
  const left = Math.min(bounds.x, bounds.x + bounds.width);
  const right = Math.max(bounds.x, bounds.x + bounds.width);
  const top = Math.min(bounds.y, bounds.y + bounds.height);
  const bottom = Math.max(bounds.y, bounds.y + bounds.height);
  const route = flattenPath(path);
  const inside = (point: Point) => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  if (route.some(inside)) return true;

  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
    { x: left, y: top },
  ];
  return strokeIntersectsPath(corners, { type: "polyline", points: route });
}

function center(bounds: Bounds): Point {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function pointOnFrame(bounds: Bounds, dx: number, dy: number): Point {
  const middle = center(bounds);
  const horizontal = dx === 0 ? Number.POSITIVE_INFINITY : (bounds.width / 2) / Math.abs(dx);
  const vertical = dy === 0 ? Number.POSITIVE_INFINITY : (bounds.height / 2) / Math.abs(dy);
  const scale = Math.min(horizontal, vertical);
  return { x: middle.x + dx * scale, y: middle.y + dy * scale };
}

function curvedPath(source: Bounds, target: Bounds, segment: ClippedSegment): LinkPath {
  const delta = subtract(segment.end, segment.start);
  const length = magnitude(delta);
  if (length <= EPSILON) return { type: "polyline", points: [segment.start, segment.end] };

  const direction = scale(delta, 1 / length);
  const normal = { x: -direction.y, y: direction.x };
  const sourceOut = frameNormal(source, segment.start, subtract(center(target), center(source)));
  const targetOut = frameNormal(target, segment.end, subtract(center(source), center(target)));
  const handle = Math.min(36, Math.max(3, length * 0.32));
  const bow = Math.min(20, Math.max(2, length * 0.15));
  const firstBend = bendDirection(sourceOut, normal);
  const secondBend = bendDirection(targetOut, normal);

  return {
    type: "cubic",
    points: [
      segment.start,
      add(segment.start, add(scale(sourceOut, handle), scale(firstBend, bow))),
      add(segment.end, add(scale(targetOut, handle), scale(secondBend, bow))),
      segment.end,
    ],
  };
}

function orthogonalPath(source: Bounds, target: Bounds): LinkPath {
  const sourceCenter = center(source);
  const targetCenter = center(target);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const horizontalFirst = Math.abs(dx) >= Math.abs(dy);

  if (horizontalFirst) {
    const direction = dx >= 0 ? 1 : -1;
    const sourceEdge = direction > 0 ? source.x + source.width : source.x;
    const targetEdge = direction > 0 ? target.x : target.x + target.width;
    const overlaps = direction > 0 ? sourceEdge > targetEdge : sourceEdge < targetEdge;
    const start = { x: sourceEdge, y: sourceCenter.y };
    const end = { x: overlaps ? (direction > 0 ? target.x + target.width : target.x) : targetEdge, y: targetCenter.y };
    const corridor = overlaps
      ? (direction > 0 ? Math.max(source.x + source.width, target.x + target.width) + 8 : Math.min(source.x, target.x) - 8)
      : (start.x + end.x) / 2;
    return polyline([start, { x: corridor, y: start.y }, { x: corridor, y: end.y }, end]);
  }

  const direction = dy >= 0 ? 1 : -1;
  const sourceEdge = direction > 0 ? source.y + source.height : source.y;
  const targetEdge = direction > 0 ? target.y : target.y + target.height;
  const overlaps = direction > 0 ? sourceEdge > targetEdge : sourceEdge < targetEdge;
  const start = { x: sourceCenter.x, y: sourceEdge };
  const end = { x: targetCenter.x, y: overlaps ? (direction > 0 ? target.y + target.height : target.y) : targetEdge };
  const corridor = overlaps
    ? (direction > 0 ? Math.max(source.y + source.height, target.y + target.height) + 8 : Math.min(source.y, target.y) - 8)
    : (start.y + end.y) / 2;
  return polyline([start, { x: start.x, y: corridor }, { x: end.x, y: corridor }, end]);
}

function polyline(points: Point[]): LinkPath {
  const compact = points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]));
  return { type: "polyline", points: compact.length > 1 ? compact : points };
}

function frameNormal(bounds: Bounds, point: Point, toward: Point): Point {
  const left = Math.abs(point.x - bounds.x);
  const right = Math.abs(point.x - (bounds.x + bounds.width));
  const top = Math.abs(point.y - bounds.y);
  const bottom = Math.abs(point.y - (bounds.y + bounds.height));
  const horizontalDistance = Math.min(left, right);
  const verticalDistance = Math.min(top, bottom);

  if (horizontalDistance < verticalDistance ||
    (Math.abs(horizontalDistance - verticalDistance) <= EPSILON && Math.abs(toward.x) >= Math.abs(toward.y))) {
    return { x: left <= right ? -1 : 1, y: 0 };
  }
  return { x: 0, y: top <= bottom ? -1 : 1 };
}

function bendDirection(outward: Point, normal: Point): Point {
  const projection = dot(normal, outward);
  const tangent = subtract(normal, scale(outward, projection));
  const length = magnitude(tangent);
  if (length <= EPSILON) return { x: -outward.y, y: outward.x };
  const unit = scale(tangent, 1 / length);
  return dot(unit, normal) >= 0 ? unit : scale(unit, -1);
}

function segmentsTouch(a: Point, b: Point, c: Point, d: Point, tolerance: number): boolean {
  if (!segmentBoundsOverlap(a, b, c, d, tolerance)) return false;
  if (segmentsIntersect(a, b, c, d)) return true;
  if (tolerance <= 0) return false;
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  ) <= tolerance;
}

function pointsBounds(points: readonly Point[]): Bounds {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function boundsOverlap(a: Bounds, b: Bounds, tolerance: number): boolean {
  return a.x <= b.x + b.width + tolerance && a.x + a.width + tolerance >= b.x &&
    a.y <= b.y + b.height + tolerance && a.y + a.height + tolerance >= b.y;
}

function segmentBoundsOverlap(a: Point, b: Point, c: Point, d: Point, tolerance: number): boolean {
  return Math.min(a.x, b.x) <= Math.max(c.x, d.x) + tolerance &&
    Math.max(a.x, b.x) + tolerance >= Math.min(c.x, d.x) &&
    Math.min(a.y, b.y) <= Math.max(c.y, d.y) + tolerance &&
    Math.max(a.y, b.y) + tolerance >= Math.min(c.y, d.y);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);

  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return (
    (Math.abs(abC) <= EPSILON && withinBounds(c, a, b)) ||
    (Math.abs(abD) <= EPSILON && withinBounds(d, a, b)) ||
    (Math.abs(cdA) <= EPSILON && withinBounds(a, c, d)) ||
    (Math.abs(cdB) <= EPSILON && withinBounds(b, c, d))
  );
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const segment = subtract(end, start);
  const lengthSquared = dot(segment, segment);
  if (lengthSquared <= EPSILON) return magnitude(subtract(point, start));
  const t = Math.max(0, Math.min(1, dot(subtract(point, start), segment) / lengthSquared));
  return magnitude(subtract(point, add(start, scale(segment, t))));
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function withinBounds(point: Point, start: Point, end: Point): boolean {
  return point.x >= Math.min(start.x, end.x) - EPSILON && point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.y >= Math.min(start.y, end.y) - EPSILON && point.y <= Math.max(start.y, end.y) + EPSILON;
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(point: Point, amount: number): Point {
  return { x: point.x * amount, y: point.y * amount };
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

function magnitude(point: Point): number {
  return Math.hypot(point.x, point.y);
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}
