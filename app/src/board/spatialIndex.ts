import type { Point } from "./cameraMath";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Uniform grid hash over world rectangles: insert/move/remove are O(cells covered), a query visits
 * only the cells under the asked rectangle. Rectangles spanning more than MAX_CELLS cells (huge nodes)
 * live in an overflow list that every query checks.
 */
export class GridIndex {
  private readonly cells = new Map<string, Set<string>>();
  private readonly rects = new Map<string, Rect>();
  private readonly cellKeys = new Map<string, string[]>();
  private readonly overflow = new Set<string>();

  constructor(private readonly cellSize = 64, private readonly maxCells = 256) {}

  get size(): number {
    return this.rects.size;
  }

  has(id: string): boolean {
    return this.rects.has(id);
  }

  rectOf(id: string): Rect | undefined {
    return this.rects.get(id);
  }

  set(id: string, rect: Rect): void {
    const previous = this.rects.get(id);
    if (previous && previous.x === rect.x && previous.y === rect.y && previous.width === rect.width && previous.height === rect.height) return;
    const keys = this.keysFor(rect);
    const oldKeys = this.cellKeys.get(id);
    this.rects.set(id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    if (oldKeys && keys && oldKeys.length === keys.length && oldKeys.every((key, index) => key === keys[index])) return;
    this.unlink(id);
    if (!keys) {
      this.overflow.add(id);
      return;
    }
    this.cellKeys.set(id, keys);
    for (const key of keys) {
      let cell = this.cells.get(key);
      if (!cell) {
        cell = new Set();
        this.cells.set(key, cell);
      }
      cell.add(id);
    }
  }

  delete(id: string): void {
    this.unlink(id);
    this.rects.delete(id);
  }

  clear(): void {
    this.cells.clear();
    this.rects.clear();
    this.cellKeys.clear();
    this.overflow.clear();
  }

  /** Ids whose rectangle intersects `rect` (edges touching count). */
  query(rect: Rect): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const consider = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const r = this.rects.get(id);
      if (r && intersects(r, rect)) result.push(id);
    };
    const x0 = Math.floor(rect.x / this.cellSize);
    const y0 = Math.floor(rect.y / this.cellSize);
    const x1 = Math.floor((rect.x + rect.width) / this.cellSize);
    const y1 = Math.floor((rect.y + rect.height) / this.cellSize);
    const span = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (!Number.isFinite(span) || span > this.cells.size * 2) {
      // Asking for more cells than exist: walking the occupied cells is cheaper.
      for (const cell of this.cells.values()) for (const id of cell) consider(id);
    } else {
      for (let cy = y0; cy <= y1; cy += 1) {
        for (let cx = x0; cx <= x1; cx += 1) {
          const cell = this.cells.get(`${cx}:${cy}`);
          if (cell) for (const id of cell) consider(id);
        }
      }
    }
    for (const id of this.overflow) consider(id);
    return result;
  }

  queryPoint(point: Point): string[] {
    return this.query({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  private keysFor(rect: Rect): string[] | null {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null;
    const x0 = Math.floor(rect.x / this.cellSize);
    const y0 = Math.floor(rect.y / this.cellSize);
    const x1 = Math.floor((rect.x + Math.max(0, rect.width)) / this.cellSize);
    const y1 = Math.floor((rect.y + Math.max(0, rect.height)) / this.cellSize);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.maxCells) return null;
    const keys: string[] = [];
    for (let cy = y0; cy <= y1; cy += 1) for (let cx = x0; cx <= x1; cx += 1) keys.push(`${cx}:${cy}`);
    return keys;
  }

  private unlink(id: string): void {
    this.overflow.delete(id);
    const keys = this.cellKeys.get(id);
    if (!keys) return;
    for (const key of keys) {
      const cell = this.cells.get(key);
      if (!cell) continue;
      cell.delete(id);
      if (cell.size === 0) this.cells.delete(key);
    }
    this.cellKeys.delete(id);
  }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}
