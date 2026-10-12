import type { Rect } from "./spatialIndex";

export type FarTileObjectKind = "note" | "link" | "zone";

export interface FarTileEntry<T> {
  key: string;
  x: number;
  y: number;
  rect: Rect;
  value: T;
  noteIds: readonly string[];
  linkIds: readonly string[];
  zoneIds: readonly string[];
  lastUsed: number;
}

/** A bounded bitmap-tile cache with reverse object indexes for targeted invalidation. */
export class FarTileCache<T> {
  private readonly entries = new Map<string, FarTileEntry<T>>();
  private readonly tilesByObject: Record<FarTileObjectKind, Map<string, Set<string>>> = {
    note: new Map(),
    link: new Map(),
    zone: new Map(),
  };
  private clock = 0;

  get size(): number {
    return this.entries.size;
  }

  get(x: number, y: number): FarTileEntry<T> | undefined {
    const entry = this.entries.get(tileKey(x, y));
    if (entry) entry.lastUsed = ++this.clock;
    return entry;
  }

  set(
    x: number,
    y: number,
    rect: Rect,
    value: T,
    objectIds: { noteIds: readonly string[]; linkIds: readonly string[]; zoneIds: readonly string[] },
  ): FarTileEntry<T> {
    const key = tileKey(x, y);
    this.remove(key);
    const entry: FarTileEntry<T> = { key, x, y, rect, value, ...objectIds, lastUsed: ++this.clock };
    this.entries.set(key, entry);
    this.index("note", entry.noteIds, key);
    this.index("link", entry.linkIds, key);
    this.index("zone", entry.zoneIds, key);
    return entry;
  }

  /** Remove and return cached tiles that contain this object. */
  invalidateObject(kind: FarTileObjectKind, id: string): FarTileEntry<T>[] {
    const keys = this.tilesByObject[kind].get(id);
    if (!keys) return [];
    const removed: FarTileEntry<T>[] = [];
    for (const key of [...keys]) {
      const entry = this.remove(key);
      if (entry) removed.push(entry);
    }
    return removed;
  }

  /** Remove cached tiles intersecting a changed object's current bounds. */
  invalidateRect(rect: Rect, tileWorldSize: number): FarTileEntry<T>[] {
    const removed: FarTileEntry<T>[] = [];
    if (tileWorldSize > 0) {
      for (const { x, y } of farTilesForRect(rect, tileWorldSize)) {
        const entry = this.remove(tileKey(x, y));
        if (entry) removed.push(entry);
      }
    }
    return removed;
  }

  /** Retain the most recently used requested tiles, with a hard upper bound. */
  retain(keys: ReadonlySet<string>, maxEntries: number): FarTileEntry<T>[] {
    const candidates = [...this.entries.values()]
      .filter((entry) => !keys.has(entry.key))
      .sort((a, b) => a.lastUsed - b.lastUsed);
    const removed: FarTileEntry<T>[] = [];
    const targetSize = Math.max(keys.size, maxEntries);
    for (const entry of candidates) {
      if (this.entries.size <= targetSize) break;
      const value = this.remove(entry.key);
      if (value) removed.push(value);
    }
    return removed;
  }

  clear(): FarTileEntry<T>[] {
    const removed = [...this.entries.values()];
    this.entries.clear();
    for (const index of Object.values(this.tilesByObject)) index.clear();
    return removed;
  }

  private remove(key: string): FarTileEntry<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.unindex("note", entry.noteIds, key);
    this.unindex("link", entry.linkIds, key);
    this.unindex("zone", entry.zoneIds, key);
    return entry;
  }

  private index(kind: FarTileObjectKind, ids: readonly string[], key: string): void {
    for (const id of ids) {
      const keys = this.tilesByObject[kind].get(id) ?? new Set<string>();
      keys.add(key);
      this.tilesByObject[kind].set(id, keys);
    }
  }

  private unindex(kind: FarTileObjectKind, ids: readonly string[], key: string): void {
    for (const id of ids) {
      const keys = this.tilesByObject[kind].get(id);
      if (!keys) continue;
      keys.delete(key);
      if (keys.size === 0) this.tilesByObject[kind].delete(id);
    }
  }
}

export function farTileKey(x: number, y: number): string {
  return tileKey(x, y);
}

export function farZoomBucket(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const step = Math.log(1.15);
  return Math.pow(1.15, Math.round(Math.log(safeZoom) / step));
}

export function farTilesForRect(rect: Rect, tileWorldSize: number): Array<{ x: number; y: number }> {
  if (tileWorldSize <= 0 || rect.width < 0 || rect.height < 0) return [];
  const left = Math.floor(rect.x / tileWorldSize);
  const top = Math.floor(rect.y / tileWorldSize);
  const right = Math.floor((rect.x + rect.width) / tileWorldSize);
  const bottom = Math.floor((rect.y + rect.height) / tileWorldSize);
  const tiles: Array<{ x: number; y: number }> = [];
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) tiles.push({ x, y });
  }
  return tiles;
}

function tileKey(x: number, y: number): string {
  return `${x}:${y}`;
}
