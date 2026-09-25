import type { Point } from "../board/cameraMath";

/**
 * A zone on the board (R4.3). The zone stores its contour so later complex shapes, holes and
 * separate parts (R4.6–R4.8) keep the same identity; R4.3 creates rectangles (4-point contours).
 * Zones never overlap by area (edges may touch, M020).
 */
export interface Zone {
  id: string;
  name: string;
  /** Hex "#rrggbb". */
  color: string;
  /** Outer contours in u (one polygon for a simple zone; more parts later). Clockwise. */
  parts: Point[][];
  /** Holes cut out of the zone (R4.8), empty for now. */
  holes: Point[][];
  createdAt?: number;
}

export interface ZoneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectContour(x: number, y: number, width: number, height: number): Point[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

export function zoneBounds(zone: Zone): ZoneBounds {
  const points = zone.parts.flat();
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Name strip follows the highest outer top edge, then the leftmost one. */
export function zoneNameEdge(zone: Zone): { x: number; y: number; width: number } {
  const edges = zone.parts.flatMap((part) => part.flatMap((point, index) => {
    const next = part[(index + 1) % part.length];
    return point.y === next.y && point.x !== next.x
      ? [{ x: Math.min(point.x, next.x), y: point.y, width: Math.abs(next.x - point.x) }]
      : [];
  }));
  edges.sort((first, second) => first.y - second.y || first.x - second.x);
  return edges[0];
}
