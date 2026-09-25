import type { Point } from "../board/cameraMath";
import type { Zone, ZoneBounds } from "../model/zone";
import { shapeAreaInRect, shapeContainsPoint, shapesOverlap } from "./shape";

const EPS = 1e-8;

/** Minimum width and height for newly created zones, in board units. */
export const MIN_ZONE_SIZE = 30;

export function normalizedRect(a: Point, b: Point): ZoneBounds {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** Area occupied by a zone inside a rectangular object, respecting future holes. */
export function zoneAreaInRect(zone: Zone, rect: ZoneBounds): number {
  return shapeAreaInRect(zone, rect);
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
  if (rect.width === 0 && rect.height === 0) return shapeContainsPoint(zone, { x: rect.x, y: rect.y });
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
  const rectangle = { parts: [[
    { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height },
  ]], holes: [] };
  return zones.some((zone) => shapesOverlap(rectangle, zone));
}

export interface ZoneCreationPreview {
  rect: ZoneBounds | null;
  blocked: boolean;
  reason: string | null;
}

/** Growing the rectangle from its anchor makes overlap monotonic, so binary search can stop at a neighbour. */
export function zoneCreationPreview(
  start: Point,
  end: Point,
  zones: readonly Zone[],
  minimumSize = MIN_ZONE_SIZE,
): ZoneCreationPreview {
  const minimumRect = anchoredMinimumRect(start, start, minimumSize, end);
  const desired = anchoredMinimumRect(start, end, minimumSize, end);
  if (!rectangleOverlapsZones(desired, zones)) return { rect: desired, blocked: false, reason: null };

  if (rectangleOverlapsZones(minimumRect, zones)) {
    return { rect: null, blocked: true, reason: "Zones can touch but cannot overlap" };
  }

  let low = 0;
  let high = 1;
  for (let index = 0; index < 32; index += 1) {
    const middle = (low + high) / 2;
    const candidateEnd = {
      x: start.x + (end.x - start.x) * middle,
      y: start.y + (end.y - start.y) * middle,
    };
    const candidate = anchoredMinimumRect(start, candidateEnd, minimumSize, end);
    if (rectangleOverlapsZones(candidate, zones)) high = middle;
    else low = middle;
  }
  const rectEnd = {
    x: start.x + (end.x - start.x) * low,
    y: start.y + (end.y - start.y) * low,
  };
  const rect = anchoredMinimumRect(start, rectEnd, minimumSize, end);
  return {
    rect: rectangleOverlapsZones(rect, zones) ? null : rect,
    blocked: true,
    reason: "Zones can touch but cannot overlap",
  };
}

/** Expand each undersized axis away from the original pointer-down corner. */
function anchoredMinimumRect(start: Point, end: Point, minimumSize: number, direction: Point): ZoneBounds {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const signX = dx === 0 ? (direction.x < 0 ? -1 : 1) : Math.sign(dx);
  const signY = dy === 0 ? (direction.y < 0 ? -1 : 1) : Math.sign(dy);
  const adjustedEnd = {
    x: start.x + signX * Math.max(Math.abs(dx), minimumSize),
    y: start.y + signY * Math.max(Math.abs(dy), minimumSize),
  };
  return normalizedRect(start, adjustedEnd);
}
