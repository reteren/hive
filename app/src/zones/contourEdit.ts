import type { Point } from "../board/cameraMath";
import type { ZoneShape } from "./shape";
import { normalizeShape, shapeBounds } from "./shape";
import {
  cloneContour,
  clonePoint,
  contourAsShape,
  extendStraightRun,
  isCutPoint,
  isHorizontal,
  isVertical,
  pointsEqual,
  snapCoordinate,
  transformWithClamps,
} from "./contourMath";

/**
 * R4.6–R4.7 contract: the editable form of a zone while "Edit shape" is active. Unlike a
 * normalized ZoneShape it may contain extra collinear cut points (M014: they stay until the
 * user leaves and re-enters edit mode). Implemented by the contour-edit worker; the editor UI
 * worker calls these pure functions.
 */
export interface ContourRing {
  kind: "part" | "hole";
  points: Point[];
}

export interface EditContour {
  rings: ContourRing[];
}

/** An edge is identified by its ring and the index of its first point (edge i = points[i] → points[i+1]). */
export interface EdgeRef {
  ring: number;
  edge: number;
}

export interface VertexRef {
  ring: number;
  vertex: number;
}

export interface EdgeHit extends EdgeRef {
  /** Closest point on the edge (snapped to the grid when `snapStep` is given). */
  point: Point;
  distance: number;
}

export interface ContourEditOptions {
  /** Minimum thickness of any piece (MIN_ZONE_PART). */
  minPart: number;
  /** Other zones: an edit stops at their boundary and never creates an area overlap (M019/M020). */
  obstacles: readonly ZoneShape[];
  /** Grid step when snapping is on. */
  snapStep?: number;
}

/** Shape → editable contour. `cleanup` removes collinear points (on (re)entering edit mode, M014). */
export function shapeToContour(shape: ZoneShape, cleanup: boolean): EditContour {
  const source = cleanup ? normalizeShape(shape) : shape;
  return {
    rings: [
      ...source.parts.map((points) => ({ kind: "part" as const, points: points.map(clonePoint) })),
      ...source.holes.map((points) => ({ kind: "hole" as const, points: points.map(clonePoint) })),
    ],
  };
}

/** Editable contour → normalized shape for storing in the zone. */
export function contourToShape(contour: EditContour): ZoneShape {
  return normalizeShape(contourAsShape(contour));
}

/** Hover: nearest edge within `tolerance` (u) of `point`, for the cut marker (M011). */
export function hitEdge(contour: EditContour, point: Point, tolerance: number, snapStep?: number): EdgeHit | null {
  if (![point.x, point.y, tolerance].every(Number.isFinite) || tolerance < 0) return null;
  let best: EdgeHit | null = null;
  for (let ringIndex = 0; ringIndex < contour.rings.length; ringIndex += 1) {
    const points = contour.rings[ringIndex].points;
    for (let edgeIndex = 0; edgeIndex < points.length; edgeIndex += 1) {
      const first = points[edgeIndex];
      const second = points[(edgeIndex + 1) % points.length];
      if (!isHorizontal(first, second) && !isVertical(first, second)) continue;
      const horizontal = isHorizontal(first, second);
      const low = horizontal ? Math.min(first.x, second.x) : Math.min(first.y, second.y);
      const high = horizontal ? Math.max(first.x, second.x) : Math.max(first.y, second.y);
      const queryAxis = horizontal ? point.x : point.y;
      const projectedAxis = Math.max(low, Math.min(high, queryAxis));
      if (projectedAxis <= low || projectedAxis >= high) continue;

      const projected: Point = horizontal
        ? { x: projectedAxis, y: first.y }
        : { x: first.x, y: projectedAxis };
      const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
      if (distance > tolerance || (best && distance >= best.distance)) continue;

      const snappedAxis = snapCoordinate(projectedAxis, snapStep);
      const interiorAxis = Math.max(low + 1e-6, Math.min(high - 1e-6, snappedAxis));
      if (interiorAxis <= low || interiorAxis >= high) continue;
      best = {
        ring: ringIndex,
        edge: edgeIndex,
        point: horizontal ? { x: interiorAxis, y: first.y } : { x: first.x, y: interiorAxis },
        distance,
      };
    }
  }
  return best;
}
/** Hover/drag target: nearest vertex within `tolerance`. */
export function hitVertex(contour: EditContour, point: Point, tolerance: number): VertexRef | null {
  if (![point.x, point.y, tolerance].every(Number.isFinite) || tolerance < 0) return null;
  let best: VertexRef | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let ring = 0; ring < contour.rings.length; ring += 1) {
    for (let vertex = 0; vertex < contour.rings[ring].points.length; vertex += 1) {
      const candidate = contour.rings[ring].points[vertex];
      const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      if (distance <= tolerance && distance < bestDistance) {
        best = { ring, vertex };
        bestDistance = distance;
      }
    }
  }
  return best;
}

/** Click on an edge: splits it at `point` (a cut, M011). No-op when the point is an existing vertex. */
export function insertCut(contour: EditContour, edge: EdgeRef, point: Point): EditContour {
  const result = cloneContour(contour);
  const ring = result.rings[edge.ring];
  if (!ring || ![point.x, point.y].every(Number.isFinite) || !Number.isInteger(edge.edge) ||
    edge.edge < 0 || edge.edge >= ring.points.length) return result;
  const first = ring.points[edge.edge];
  const nextIndex = (edge.edge + 1) % ring.points.length;
  const second = ring.points[nextIndex];
  if (!pointStrictlyOnEdge(point, first, second) || contour.rings.some((item) => item.points.some((existing) => pointsEqual(existing, point)))) return result;
  const cut = isHorizontal(first, second) ? { x: point.x, y: first.y } : { x: first.x, y: point.y };
  ring.points.splice(edge.edge + 1, 0, cut);
  return result;
}

/**
 * Drags one segment by `delta` (H21, agreed 25.09):
 * - perpendicular movement shifts the segment and adds the connecting edges → a step (inwards)
 *   or a protrusion (outwards);
 * - movement along a segment whose one end is a cut point: dragging away from the cut grows the
 *   zone on that side (the far end and its adjacent edge move with it); dragging towards the cut
 *   moves the cut point and shortens the neighbouring segment down to the minimum.
 * - movement along a segment between two real corners is a no-op: it has no cut point that can
 *   move independently, and translating the whole segment would move a different boundary too.
 * The result is clamped so no piece gets thinner than `minPart`, the ring never self-intersects,
 * and no obstacle is overlapped (the edge stops at the obstacle, M019).
 */
export function dragSegment(contour: EditContour, edge: EdgeRef, delta: Point, options: ContourEditOptions): EditContour {
  const original = cloneContour(contour);
  const points = contour.rings[edge.ring]?.points;
  if (!points || points.length < 4 || !Number.isInteger(edge.edge) || edge.edge < 0 || edge.edge >= points.length ||
    ![delta.x, delta.y].every(Number.isFinite)) return original;
  const first = points[edge.edge];
  const second = points[(edge.edge + 1) % points.length];
  const horizontal = isHorizontal(first, second);
  const vertical = isVertical(first, second);
  if (!horizontal && !vertical) return original;
  const alongAxis = horizontal ? "x" : "y";
  const acrossAxis = horizontal ? "y" : "x";
  const alongDelta = delta[alongAxis];
  const acrossDelta = delta[acrossAxis];
  const firstIndex = edge.edge;
  const secondIndex = (edge.edge + 1) % points.length;
  const firstIsCut = isCutPoint(points, firstIndex);
  const secondIsCut = isCutPoint(points, secondIndex);

  return transformWithClamps(contour, delta, options, (fraction) => {
    let result = cloneContour(contour);
    if (Math.abs(alongDelta) > 1e-9) result = moveSegmentAlong(result, edge, alongDelta * fraction, alongAxis, options.snapStep);
    if (Math.abs(acrossDelta) > 1e-9) result = moveSegmentAcross(result, edge, acrossDelta * fraction, acrossAxis, options.snapStep);
    return result;
  }, (candidate, fraction) => {
    if (options.minPart <= 0) return true;
    if (Math.abs(acrossDelta) > 1e-9 && (firstIsCut || secondIsCut)) {
      const movedAcross = snapCoordinate(first[acrossAxis] + acrossDelta * fraction, options.snapStep);
      const acrossDistance = Math.abs(movedAcross - first[acrossAxis]);
      if (acrossDistance > 1e-7 && acrossDistance < options.minPart - 1e-6) return false;
      if (acrossDistance > 1e-7 && firstIsCut !== secondIsCut) {
        const cutIndex = firstIsCut ? firstIndex : secondIndex;
        const cornerIndex = firstIsCut ? secondIndex : firstIndex;
        const cutCoordinate = points[cutIndex][alongAxis];
        const cornerCoordinate = points[cornerIndex][alongAxis];
        const directionToCorner = cornerCoordinate - cutCoordinate;
        const alongMovement = alongDelta * fraction;
        let firstAlong = first[alongAxis];
        let secondAlong = second[alongAxis];
        if (Math.abs(alongMovement) > 1e-9) {
          const movingAway = alongMovement * directionToCorner > 0;
          const currentCoordinate = movingAway ? cornerCoordinate : cutCoordinate;
          const movedEndpoint = snapCoordinate(currentCoordinate + alongMovement, options.snapStep);
          const movedIndex = movingAway ? cornerIndex : cutIndex;
          if (movedIndex === firstIndex) firstAlong = movedEndpoint;
          else secondAlong = movedEndpoint;
        }
        const segmentLength = Math.abs(firstAlong - secondAlong);
        if (segmentLength < options.minPart - 1e-6) return false;
      }
    }
    if (Math.abs(alongDelta) > 1e-9 && firstIsCut !== secondIsCut && Math.abs(acrossDelta) <= 1e-9) {
      const movedRing = candidate.rings[edge.ring]?.points;
      const cutIndex = firstIsCut ? firstIndex : secondIndex;
      if (!movedRing || movedRing.length !== points.length) return false;
      const cut = movedRing[cutIndex];
      const previous = movedRing[(cutIndex + movedRing.length - 1) % movedRing.length];
      const next = movedRing[(cutIndex + 1) % movedRing.length];
      if (Math.abs(cut[alongAxis] - previous[alongAxis]) < options.minPart - 1e-6 ||
        Math.abs(cut[alongAxis] - next[alongAxis]) < options.minPart - 1e-6) return false;
    }
    return true;
  });
}

/** Drags a corner: only the two edges at that corner move (M013). */
export function dragVertex(contour: EditContour, vertex: VertexRef, delta: Point, options: ContourEditOptions): EditContour {
  const original = cloneContour(contour);
  const source = contour.rings[vertex.ring]?.points;
  if (!source || source.length < 4 || !Number.isInteger(vertex.vertex) || vertex.vertex < 0 || vertex.vertex >= source.length ||
    ![delta.x, delta.y].every(Number.isFinite) || isCutPoint(source, vertex.vertex)) return original;

  return transformWithClamps(contour, delta, options, (fraction) => {
    const result = cloneContour(contour);
    const ring = result.rings[vertex.ring].points;
    const index = vertex.vertex;
    const previousIndex = (index + ring.length - 1) % ring.length;
    const nextIndex = (index + 1) % ring.length;
    const previous = source[previousIndex];
    const current = source[index];
    const next = source[nextIndex];
    const target = {
      x: Math.abs(delta.x) <= 1e-9 ? current.x : snapCoordinate(current.x + delta.x * fraction, options.snapStep),
      y: Math.abs(delta.y) <= 1e-9 ? current.y : snapCoordinate(current.y + delta.y * fraction, options.snapStep),
    };
    ring[index] = target;
    if (isHorizontal(previous, current)) extendStraightRun(ring, index, -1, "y", target.y, source);
    else if (isVertical(previous, current)) extendStraightRun(ring, index, -1, "x", target.x, source);
    if (isHorizontal(current, next)) extendStraightRun(ring, index, 1, "y", target.y, source);
    else if (isVertical(current, next)) extendStraightRun(ring, index, 1, "x", target.x, source);
    return result;
  });
}

/** Ctrl-drag of a corner: the whole zone scales, anchored at the opposite bounds corner (M013). */
export function scaleByVertex(contour: EditContour, vertex: VertexRef, delta: Point, options: ContourEditOptions): EditContour {
  const original = cloneContour(contour);
  const ring = contour.rings[vertex.ring]?.points;
  if (!ring || ring.length < 4 || !Number.isInteger(vertex.vertex) || vertex.vertex < 0 || vertex.vertex >= ring.length ||
    ![delta.x, delta.y].every(Number.isFinite) || isCutPoint(ring, vertex.vertex)) return original;
  const bounds = shapeBounds(contourAsShape(contour));
  const selected = ring[vertex.vertex];
  const anchor: Point = {
    x: Math.abs(selected.x - bounds.x) <= Math.abs(selected.x - (bounds.x + bounds.width))
      ? bounds.x + bounds.width
      : bounds.x,
    y: Math.abs(selected.y - bounds.y) <= Math.abs(selected.y - (bounds.y + bounds.height))
      ? bounds.y + bounds.height
      : bounds.y,
  };
  const spanX = selected.x - anchor.x;
  const spanY = selected.y - anchor.y;

  return transformWithClamps(contour, delta, options, (fraction) => {
    const targetX = Math.abs(delta.x) <= 1e-9 ? selected.x : snapCoordinate(selected.x + delta.x * fraction, options.snapStep);
    const targetY = Math.abs(delta.y) <= 1e-9 ? selected.y : snapCoordinate(selected.y + delta.y * fraction, options.snapStep);
    const scaleX = Math.abs(spanX) <= 1e-9 ? 1 : (targetX - anchor.x) / spanX;
    const scaleY = Math.abs(spanY) <= 1e-9 ? 1 : (targetY - anchor.y) / spanY;
    const result = cloneContour(contour);
    for (const item of result.rings) {
      item.points = item.points.map((point) => ({
        x: Math.abs(scaleX - 1) <= 1e-12 ? point.x : Math.abs(point.x - anchor.x) <= 1e-9
          ? anchor.x
          : snapCoordinate(anchor.x + (point.x - anchor.x) * scaleX, options.snapStep),
        y: Math.abs(scaleY - 1) <= 1e-12 ? point.y : Math.abs(point.y - anchor.y) <= 1e-9
          ? anchor.y
          : snapCoordinate(anchor.y + (point.y - anchor.y) * scaleY, options.snapStep),
      }));
    }
    return result;
  });
}

function moveSegmentAlong(contour: EditContour, edge: EdgeRef, amount: number, axis: "x" | "y", snapStep?: number): EditContour {
  const result = cloneContour(contour);
  const points = result.rings[edge.ring].points;
  const firstIndex = edge.edge;
  const secondIndex = (edge.edge + 1) % points.length;
  const firstIsCut = isCutPoint(points, firstIndex);
  const secondIsCut = isCutPoint(points, secondIndex);
  if (firstIsCut === secondIsCut) return result;

  const cutIndex = firstIsCut ? firstIndex : secondIndex;
  const cornerIndex = firstIsCut ? secondIndex : firstIndex;
  const cut = points[cutIndex];
  const corner = points[cornerIndex];
  const directionToCorner = corner[axis] - cut[axis];
  if (Math.abs(directionToCorner) <= 1e-9) return result;

  if (amount * directionToCorner > 0) {
    // Moving away from the cut carries the far boundary edge and its cut points with the corner.
    const otherRunDirection: -1 | 1 = cornerIndex === firstIndex ? -1 : 1;
    const target = snapCoordinate(corner[axis] + amount, snapStep);
    extendStraightRun(points, cornerIndex, otherRunDirection, axis, target);
  } else {
    // Moving toward the cut adjusts only that cut point; the minimum-run clamp protects the far strip.
    points[cutIndex] = { ...cut, [axis]: snapCoordinate(cut[axis] + amount, snapStep) };
  }
  return result;
}

function moveSegmentAcross(contour: EditContour, edge: EdgeRef, amount: number, axis: "x" | "y", snapStep?: number): EditContour {
  const result = cloneContour(contour);
  const ring = result.rings[edge.ring];
  const points = ring.points;
  const firstIndex = edge.edge;
  const secondIndex = (edge.edge + 1) % points.length;
  const first = points[firstIndex];
  const second = points[secondIndex];
  const target = snapCoordinate(first[axis] + amount, snapStep);
  if (Math.abs(target - first[axis]) <= 1e-9) return result;
  const firstIsCut = isCutPoint(points, firstIndex);
  const secondIsCut = isCutPoint(points, secondIndex);
  const movedFirst = { ...first, [axis]: target };
  const movedSecond = { ...second, [axis]: target };
  const output: Point[] = [];

  for (let index = 0; index < points.length; index += 1) {
    if (index === firstIndex) {
      if (firstIsCut) output.push(clonePoint(first));
      output.push(movedFirst);
    } else if (index === secondIndex) {
      output.push(movedSecond);
      if (secondIsCut) output.push(clonePoint(second));
    } else {
      output.push(clonePoint(points[index]));
    }
  }
  ring.points = output;
  return result;
}

function pointStrictlyOnEdge(point: Point, first: Point, second: Point): boolean {
  if (isHorizontal(first, second)) {
    return Math.abs(point.y - first.y) <= 1e-6 && point.x > Math.min(first.x, second.x) && point.x < Math.max(first.x, second.x);
  }
  if (isVertical(first, second)) {
    return Math.abs(point.x - first.x) <= 1e-6 && point.y > Math.min(first.y, second.y) && point.y < Math.max(first.y, second.y);
  }
  return false;
}
