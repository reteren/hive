import { GridIndex, type Rect } from "../board/spatialIndex";
import type { Point } from "../board/cameraMath";

export class LinkRouteIndex {
  private readonly index = new GridIndex(96, 256);
  private readonly pointsById = new Map<string, readonly Point[]>();

  get size(): number {
    return this.index.size;
  }

  set(id: string, points: readonly Point[]): void {
    const bounds = routeBounds(points);
    if (!bounds) {
      this.index.delete(id);
      this.pointsById.delete(id);
      return;
    }
    this.index.set(id, bounds);
    this.pointsById.set(id, points);
  }

  delete(id: string): void {
    this.index.delete(id);
    this.pointsById.delete(id);
  }

  clear(): void {
    this.index.clear();
    this.pointsById.clear();
  }

  query(rect: Rect): string[] {
    return this.index.query(rect);
  }

  /** World-space route used by the far canvas layer after querying the route AABB index. */
  pointsOf(id: string): readonly Point[] | undefined {
    return this.pointsById.get(id);
  }
}

/** Shared route index, kept current by LinksLayer and read by the far-zoom canvas. */
export const linkRouteIndex = new LinkRouteIndex();

/** AABB of the rendered polyline; cubic routes use their same flattened points for painting/hit tests. */
export function routeBounds(points: readonly Point[]): Rect | null {
  if (points.length === 0) return null;
  let left = points[0]!.x;
  let right = left;
  let top = points[0]!.y;
  let bottom = top;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
