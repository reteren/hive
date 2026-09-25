import type { Point } from "../board/cameraMath";
import type { EditContour } from "./contourEdit";
import type { ZoneShape } from "./shape";
import { hasThinPiece, normalizeShape, shapeArea, shapesOverlap } from "./shape";

const EPSILON = 1e-7;

export function cloneContour(contour: EditContour): EditContour {
  return { rings: contour.rings.map((ring) => ({ kind: ring.kind, points: ring.points.map(clonePoint) })) };
}

export function clonePoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

export function pointsEqual(first: Point, second: Point): boolean {
  return Math.abs(first.x - second.x) <= EPSILON && Math.abs(first.y - second.y) <= EPSILON;
}

export function isHorizontal(first: Point, second: Point): boolean {
  return Math.abs(first.y - second.y) <= EPSILON && Math.abs(first.x - second.x) > EPSILON;
}

export function isVertical(first: Point, second: Point): boolean {
  return Math.abs(first.x - second.x) <= EPSILON && Math.abs(first.y - second.y) > EPSILON;
}

export function snapCoordinate(value: number, step?: number): number {
  return step !== undefined && Number.isFinite(step) && step > 0
    ? Math.round(value / step) * step
    : value;
}

export function contourAsShape(contour: EditContour): ZoneShape {
  const parts: Point[][] = [];
  const holes: Point[][] = [];
  for (const ring of contour.rings) {
    const points = ring.points.map(clonePoint);
    if (ring.kind === "part") {
      parts.push(orient(points, true));
    } else {
      holes.push(orient(points, false));
    }
  }
  return { parts, holes };
}

export function contourIsValid(
  contour: EditContour,
  minPart: number,
  obstacles: readonly ZoneShape[],
  checkMinimum: boolean,
): boolean {
  if (!Number.isFinite(minPart) || minPart < 0 || contour.rings.length === 0) return false;

  const nonEmptyParts = contour.rings.filter((ring) => ring.kind === "part");
  if (nonEmptyParts.length === 0) return false;
  for (const ring of contour.rings) {
    if (!isValidSimpleRing(ring.points)) return false;
  }
  for (let first = 0; first < contour.rings.length; first += 1) {
    for (let second = first + 1; second < contour.rings.length; second += 1) {
      if (ringsIntersect(contour.rings[first].points, contour.rings[second].points)) return false;
    }
  }

  const raw = contourAsShape(contour);
  const normalized = normalizeShape(raw);
  if (normalized.parts.length === 0 || !Number.isFinite(shapeArea(normalized))) return false;
  const expectedArea = contour.rings.reduce((area, ring) => {
    const ringArea = Math.abs(signedArea(ring.points));
    return area + (ring.kind === "part" ? ringArea : -ringArea);
  }, 0);
  if (expectedArea <= EPSILON || Math.abs(shapeArea(normalized) - expectedArea) > 1e-4) return false;
  if (checkMinimum && hasThinPiece(normalized, minPart)) return false;
  return !obstacles.some((obstacle) => shapesOverlap(normalized, obstacle));
}

export function transformWithClamps(
  contour: EditContour,
  requestedDelta: Point,
  options: { minPart: number; obstacles: readonly ZoneShape[] },
  transform: (fraction: number) => EditContour,
  minimumValid: (candidate: EditContour, fraction: number) => boolean = () => true,
): EditContour {
  const unchanged = cloneContour(contour);
  if (![requestedDelta.x, requestedDelta.y].every(Number.isFinite) ||
    !contourIsValid(contour, options.minPart, options.obstacles, false)) return unchanged;

  const distance = Math.max(Math.abs(requestedDelta.x), Math.abs(requestedDelta.y));
  if (distance <= EPSILON) return unchanged;

  // Zone parts are at least 30u wide, so these samples cannot jump across a normal obstacle.
  // Binary search after the first blocked sample makes the final edge touch the obstacle.
  const step = Math.max(Math.min(options.minPart || 30, 30) / 8, 0.125);
  const sampleCount = Math.min(50_000, Math.max(1, Math.ceil(distance / step)));
  let safeFraction = 0;
  let blockedFraction = 1;
  let foundBlock = false;

  for (let sample = 1; sample <= sampleCount; sample += 1) {
    const fraction = sample / sampleCount;
    if (contourIsValid(transform(fraction), options.minPart, options.obstacles, false)) {
      safeFraction = fraction;
      continue;
    }
    blockedFraction = fraction;
    foundBlock = true;
    break;
  }

  if (foundBlock) {
    for (let iteration = 0; iteration < 48; iteration += 1) {
      const middle = (safeFraction + blockedFraction) / 2;
      if (contourIsValid(transform(middle), options.minPart, options.obstacles, false)) safeFraction = middle;
      else blockedFraction = middle;
    }
  } else {
    safeFraction = 1;
  }

  let candidate = transform(safeFraction);
  if (contourIsValid(candidate, options.minPart, options.obstacles, true) && minimumValid(candidate, safeFraction)) return candidate;

  // Minimum thickness can be non-monotonic at the start of an outward step: it becomes
  // acceptable only once the protrusion reaches 30u. Accept a valid final shape above, and
  // otherwise clamp a shrinking gesture to the last valid thickness.
  if (!contourIsValid(contour, options.minPart, options.obstacles, true)) return unchanged;
  let low = 0;
  let high = safeFraction;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (low + high) / 2;
    const middleContour = transform(middle);
    if (contourIsValid(middleContour, options.minPart, options.obstacles, true) && minimumValid(middleContour, middle)) low = middle;
    else high = middle;
  }
  candidate = transform(low);
  return contourIsValid(candidate, options.minPart, options.obstacles, true) && minimumValid(candidate, low) ? candidate : unchanged;
}

export function isCutPoint(points: readonly Point[], index: number): boolean {
  if (points.length < 3) return false;
  const previous = points[(index + points.length - 1) % points.length];
  const current = points[index];
  const next = points[(index + 1) % points.length];
  return (Math.abs(previous.x - current.x) <= EPSILON && Math.abs(current.x - next.x) <= EPSILON) ||
    (Math.abs(previous.y - current.y) <= EPSILON && Math.abs(current.y - next.y) <= EPSILON);
}

/** Moves a straight run of cut points and includes its far corner, stopping at the next turn. */
export function extendStraightRun(
  points: Point[],
  start: number,
  stepDirection: -1 | 1,
  axis: "x" | "y",
  value: number,
  referencePoints: readonly Point[] = points,
): void {
  const count = points.length;
  const source = referencePoints.map(clonePoint);
  let current = start;
  points[current] = { ...points[current], [axis]: value };

  for (let traversed = 0; traversed < count - 1; traversed += 1) {
    const nextIndex = (current + stepDirection + count) % count;
    const currentPoint = source[current];
    const nextPoint = source[nextIndex];
    const isSameStraightLine = axis === "y"
      ? Math.abs(currentPoint.y - nextPoint.y) <= EPSILON
      : Math.abs(currentPoint.x - nextPoint.x) <= EPSILON;
    if (!isSameStraightLine) break;
    points[nextIndex] = { ...nextPoint, [axis]: value };
    current = nextIndex;

    const followingIndex = (current + stepDirection + count) % count;
    const followingPoint = source[followingIndex];
    const nextEdgeStillOnRun = axis === "y"
      ? Math.abs(source[current].y - followingPoint.y) <= EPSILON
      : Math.abs(source[current].x - followingPoint.x) <= EPSILON;
    if (!nextEdgeStillOnRun) break;
  }
}

function orient(points: Point[], clockwise: boolean): Point[] {
  const area = signedArea(points);
  if (area !== 0 && (area > 0) !== clockwise) points.reverse();
  return points;
}

function signedArea(points: readonly Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function isValidSimpleRing(points: readonly Point[]): boolean {
  if (points.length < 4 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)) ||
    Math.abs(signedArea(points)) <= EPSILON) return false;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!isHorizontal(current, next) && !isVertical(current, next)) return false;
    for (let other = index + 1; other < points.length; other += 1) {
      if (areAdjacentEdges(index, other, points.length)) {
        const shared = other === index + 1 ? next : current;
        if (segmentsIntersectBeyondPoint(current, next, points[other], points[(other + 1) % points.length], shared)) return false;
      } else if (segmentsIntersect(current, next, points[other], points[(other + 1) % points.length])) {
        return false;
      }
    }
  }
  return true;
}

function ringsIntersect(first: readonly Point[], second: readonly Point[]): boolean {
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      if (segmentsIntersect(first[firstIndex], first[(firstIndex + 1) % first.length],
        second[secondIndex], second[(secondIndex + 1) % second.length])) return true;
    }
  }
  return false;
}

function areAdjacentEdges(first: number, second: number, count: number): boolean {
  return second === first + 1 || (first === 0 && second === count - 1);
}

function segmentsIntersectBeyondPoint(a: Point, b: Point, c: Point, d: Point, shared: Point): boolean {
  if (!segmentsIntersect(a, b, c, d)) return false;
  const horizontalA = Math.abs(a.y - b.y) <= EPSILON;
  const horizontalB = Math.abs(c.y - d.y) <= EPSILON;
  if (horizontalA !== horizontalB) {
    const crossing = horizontalA ? { x: c.x, y: a.y } : { x: a.x, y: c.y };
    return !pointsEqual(crossing, shared);
  }
  if (horizontalA) {
    const overlap = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
    return overlap > EPSILON;
  }
  const overlap = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
  return overlap > EPSILON;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const aHorizontal = Math.abs(a.y - b.y) <= EPSILON;
  const bHorizontal = Math.abs(c.y - d.y) <= EPSILON;
  if (aHorizontal && bHorizontal) {
    return Math.abs(a.y - c.y) <= EPSILON &&
      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) + EPSILON;
  }
  if (!aHorizontal && !bHorizontal) {
    return Math.abs(a.x - c.x) <= EPSILON &&
      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) + EPSILON;
  }
  const horizontalStart = aHorizontal ? a : c;
  const horizontalEnd = aHorizontal ? b : d;
  const verticalStart = aHorizontal ? c : a;
  const verticalEnd = aHorizontal ? d : b;
  return verticalStart.x >= Math.min(horizontalStart.x, horizontalEnd.x) - EPSILON &&
    verticalStart.x <= Math.max(horizontalStart.x, horizontalEnd.x) + EPSILON &&
    horizontalStart.y >= Math.min(verticalStart.y, verticalEnd.y) - EPSILON &&
    horizontalStart.y <= Math.max(verticalStart.y, verticalEnd.y) + EPSILON;
}
