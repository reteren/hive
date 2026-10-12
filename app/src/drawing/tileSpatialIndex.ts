import { levelTileUnits, parseTileKey, tileKey, type TileKey, type WorldRect } from "./types";

interface LevelRows {
  rows: number[];
  columnsByRow: Map<number, number[]>;
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Sparse tile-coordinate index. Range queries visit stored rows and columns, never empty cells. */
export class TileSpatialIndex {
  private readonly byLevel = new Map<number, LevelRows>();
  private readonly keys = new Set<TileKey>();
  private levelsCache: readonly number[] | null = null;
  private allKeysCache: readonly TileKey[] | null = null;

  get size(): number {
    return this.keys.size;
  }

  has(key: TileKey): boolean {
    return this.keys.has(key);
  }

  add(key: TileKey): boolean {
    if (this.keys.has(key)) return false;
    const parsed = parseTileKey(key);
    if (!parsed) return false;
    let level = this.byLevel.get(parsed.level);
    if (!level) {
      level = { rows: [], columnsByRow: new Map() };
      this.byLevel.set(parsed.level, level);
    }
    let columns = level.columnsByRow.get(parsed.row);
    if (!columns) {
      columns = [];
      level.columnsByRow.set(parsed.row, columns);
      level.rows.splice(lowerBound(level.rows, parsed.row), 0, parsed.row);
    }
    columns.splice(lowerBound(columns, parsed.col), 0, parsed.col);
    this.keys.add(key);
    this.levelsCache = null;
    this.allKeysCache = null;
    return true;
  }

  delete(key: TileKey): boolean {
    if (!this.keys.delete(key)) return false;
    const parsed = parseTileKey(key);
    if (!parsed) return true;
    const level = this.byLevel.get(parsed.level);
    const columns = level?.columnsByRow.get(parsed.row);
    if (!level || !columns) return true;
    const columnAt = lowerBound(columns, parsed.col);
    if (columns[columnAt] === parsed.col) columns.splice(columnAt, 1);
    if (columns.length === 0) {
      level.columnsByRow.delete(parsed.row);
      const rowAt = lowerBound(level.rows, parsed.row);
      if (level.rows[rowAt] === parsed.row) level.rows.splice(rowAt, 1);
    }
    if (level.rows.length === 0) this.byLevel.delete(parsed.level);
    this.levelsCache = null;
    this.allKeysCache = null;
    return true;
  }

  clear(): void {
    this.byLevel.clear();
    this.keys.clear();
    this.levelsCache = null;
    this.allKeysCache = null;
  }

  levels(): number[] {
    this.levelsCache ??= [...this.byLevel.keys()].sort((a, b) => b - a);
    return [...this.levelsCache];
  }

  allKeys(): readonly TileKey[] {
    this.allKeysCache ??= [...this.keys].sort((left, right) => {
      const a = parseTileKey(left)!;
      const b = parseTileKey(right)!;
      return b.level - a.level || a.row - b.row || a.col - b.col;
    });
    return this.allKeysCache;
  }

  query(rect: WorldRect, levelNumber: number): TileKey[] {
    const x2 = rect.x + rect.width;
    const y2 = rect.y + rect.height;
    const left = Math.min(rect.x, x2);
    const top = Math.min(rect.y, y2);
    const right = Math.max(rect.x, x2);
    const bottom = Math.max(rect.y, y2);
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return [];
    const level = this.byLevel.get(levelNumber);
    if (!level) return [];

    const size = levelTileUnits(levelNumber);
    const firstCol = Math.floor(left / size);
    const lastCol = Math.ceil(right / size) - 1;
    const firstRow = Math.floor(top / size);
    const lastRow = Math.ceil(bottom / size) - 1;
    const keys: TileKey[] = [];
    for (let rowIndex = lowerBound(level.rows, firstRow); rowIndex < upperBound(level.rows, lastRow); rowIndex += 1) {
      const row = level.rows[rowIndex]!;
      const columns = level.columnsByRow.get(row)!;
      for (let colIndex = lowerBound(columns, firstCol); colIndex < upperBound(columns, lastCol); colIndex += 1) {
        keys.push(tileKey(columns[colIndex]!, row, levelNumber));
      }
    }
    return keys;
  }
}
