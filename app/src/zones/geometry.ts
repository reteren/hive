import type { Point } from "../board/cameraMath";
import type { Zone, ZoneBounds } from "../model/zone";

const EPS = 1e-8;

export function normalizedRect(a: Point, b: Point): ZoneBounds {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function clipPolygon(polygon: readonly Point[], inside: (point: Point) => boolean, intersect: (a: Point, b: Point) => Point): Point[] {
  const result: Point[] = [];
  if (polygon.length === 0) return result;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentInside = inside(current);
    const previousInside = inside(previous);
    if (currentInside !== previousInside) result.push(intersect(previous, current));
    if (currentInside) result.push(current);
  }
  return result;
}

function polygonWithinRect(polygon: readonly Point[], rect: ZoneBounds): Point[] {
  let result = [...polygon];
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;
  result = clipPolygon(result, (p) => p.x >= rect.x, (a, b) => ({ x: rect.x, y: a.y + (b.y - a.y) * (rect.x - a.x) / (b.x - a.x) }));
  result = clipPolygon(result, (p) => p.x <= x2, (a, b) => ({ x: x2, y: a.y + (b.y - a.y) * (x2 - a.x) / (b.x - a.x) }));
  result = clipPolygon(result, (p) => p.y >= rect.y, (a, b) => ({ x: a.x + (b.x - a.x) * (rect.y - a.y) / (b.y - a.y), y: rect.y }));
  result = clipPolygon(result, (p) => p.y <= y2, (a, b) => ({ x: a.x + (b.x - a.x) * (y2 - a.y) / (b.y - a.y), y: y2 }));
  return result;
}

function polygonArea(points: readonly Point[]): number {
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    twice += a.x * b.y - a.y * b.x;
  }
  return Math.abs(twice) / 2;
}

/** Area occupied by a zone inside a rectangular object, respecting future holes. */
export function zoneAreaInRect(zone: Zone, rect: ZoneBounds): number {
  if (rect.width <= 0 || rect.height <= 0) return 0;
  const area = zone.parts.reduce((sum, polygon) => sum + polygonArea(polygonWithinRect(polygon, rect)), 0)
    - zone.holes.reduce((sum, polygon) => sum + polygonArea(polygonWithinRect(polygon, rect)), 0);
  return Math.max(0, area);
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return Math.abs(cross(a, b, p)) <= EPS && p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS;
}

function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return ((abC > EPS && abD < -EPS) || (abC < -EPS && abD > EPS)) &&
      ((cdA > EPS && cdB < -EPS) || (cdA < -EPS && cdB > EPS)) ||
    onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if (onSegment(a, b, point)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Contact counts, including a shared edge or corner; a rectangle wholly inside a hole does not. */
export function zoneTouchesRect(zone: Zone, rect: ZoneBounds): boolean {
  if (zoneAreaInRect(zone, rect) > EPS) return true;
  const corners = [
    { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height },
  ];
  for (const polygon of [...zone.parts, ...zone.holes]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const a = polygon[index];
      const b = polygon[(index + 1) % polygon.length];
      for (let edge = 0; edge < corners.length; edge += 1) {
        if (segmentsTouch(a, b, corners[edge], corners[(edge + 1) % corners.length])) return true;
      }
    }
  }
  return corners.some((corner) => zone.parts.some((part) => pointInPolygon(corner, part)) &&
    !zone.holes.some((hole) => pointInPolygon(corner, hole)));
}

export function rectangleOverlapsZones(rect: ZoneBounds, zones: readonly Zone[]): boolean {
  return zones.some((zone) => zoneAreaInRect(zone, rect) > EPS);
}

export interface ZoneCreationPreview {
  rect: ZoneBounds | null;
  blocked: boolean;
  reason: string | null;
}

/** Growing the rectangle from its anchor makes overlap monotonic, so binary search can stop at a neighbour. */
export function zoneCreationPreview(start: Point, end: Point, zones: readonly Zone[], minimumSize = 2): ZoneCreationPreview {
  const desired = normalizedRect(start, end);
  if (desired.width < minimumSize || desired.height < minimumSize) {
    return { rect: desired, blocked: false, reason: null };
  }
  if (!rectangleOverlapsZones(desired, zones)) return { rect: desired, blocked: false, reason: null };

  let low = 0;
  let high = 1;
  for (let index = 0; index < 32; index += 1) {
    const middle = (low + high) / 2;
    const candidate = normalizedRect(start, { x: start.x + (end.x - start.x) * middle, y: start.y + (end.y - start.y) * middle });
    if (rectangleOverlapsZones(candidate, zones)) high = middle;
    else low = middle;
  }
  const rect = normalizedRect(start, { x: start.x + (end.x - start.x) * low, y: start.y + (end.y - start.y) * low });
  return {
    rect: rect.width >= minimumSize && rect.height >= minimumSize ? rect : null,
    blocked: true,
    reason: "Zones can touch but cannot overlap",
  };
}
