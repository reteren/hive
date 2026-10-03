import {
  DRAW_PX_PER_UNIT,
  DRAW_TILE_SIZE_PX,
  DRAW_TILE_SIZE_UNITS,
  parseTileKey,
  tileKey,
  type DrawingTileStore,
  type TileKey,
  type TileSnapshot,
  type WorldRect,
} from "./types";

const MAX_TILE_COORDINATE = 10_000_000;
const MAX_TILES_PER_RECT = 10_000;

export interface DrawingCanvasAdapter {
  createCanvas(): HTMLCanvasElement;
  pixels(canvas: HTMLCanvasElement): Uint8ClampedArray;
  encode(canvas: HTMLCanvasElement): Promise<Blob>;
  restore(canvas: HTMLCanvasElement, blob: Blob): Promise<void>;
}

export interface MutableDrawingTileStore extends DrawingTileStore {
  /** Replace all in-memory tiles without saving or recording Undo (project load). */
  replaceFromSnapshot(snapshot: TileSnapshot): Promise<void>;
  /** List stored tile keys in stable row/column order. */
  allKeys(): TileKey[];
  /** Keys whose backing canvases changed in the most recent revision. */
  readonly lastCommitKeys: readonly TileKey[];
  /** Called after a user commit with changed and remaining tile keys. */
  setCommitListener(listener: DrawingCommitListener | null): void;
}

export type DrawingCommitListener = (changedKeys: readonly TileKey[], tileKeys: readonly TileKey[]) => void;

/** Pure alpha scan, kept independent of browser or native canvas implementations. */
export function isRgbaTransparent(pixels: Uint8ClampedArray): boolean {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) return false;
  }
  return true;
}

/** Keep a pixel when the source is at least as opaque; useful for one-stroke max-alpha masks. */
export function mergeMaxAlpha(target: Uint8ClampedArray, source: Uint8ClampedArray): void {
  if (target.length !== source.length || target.length % 4 !== 0) {
    throw new RangeError("RGBA buffers must have the same length.");
  }
  for (let offset = 3; offset < target.length; offset += 4) {
    if (source[offset] > target[offset]) target[offset] = source[offset];
  }
}

export const browserDrawingCanvasAdapter: DrawingCanvasAdapter = {
  createCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = DRAW_TILE_SIZE_PX;
    canvas.height = DRAW_TILE_SIZE_PX;
    return canvas;
  },
  pixels(canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not read a drawing tile canvas.");
    return context.getImageData(0, 0, DRAW_TILE_SIZE_PX, DRAW_TILE_SIZE_PX).data;
  },
  encode(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode a drawing tile as PNG."));
      }, "image/png");
    });
  },
  async restore(canvas, blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      canvas.width = DRAW_TILE_SIZE_PX;
      canvas.height = DRAW_TILE_SIZE_PX;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not restore a drawing tile canvas.");
      context.clearRect(0, 0, DRAW_TILE_SIZE_PX, DRAW_TILE_SIZE_PX);
      context.drawImage(bitmap, 0, 0, DRAW_TILE_SIZE_PX, DRAW_TILE_SIZE_PX);
    } finally {
      bitmap.close();
    }
  },
};

export function createDrawingTileStore(adapter: DrawingCanvasAdapter = browserDrawingCanvasAdapter): MutableDrawingTileStore {
  const state = $state({ revision: 0, lastCommitKeys: [] as TileKey[] });
  const tiles = new Map<TileKey, HTMLCanvasElement>();
  let commitListener: DrawingCommitListener | null = null;

  function validKey(key: TileKey): boolean {
    const parsed = parseTileKey(key);
    return parsed !== null && Number.isSafeInteger(parsed.col) && Number.isSafeInteger(parsed.row) &&
      Math.abs(parsed.col) <= MAX_TILE_COORDINATE && Math.abs(parsed.row) <= MAX_TILE_COORDINATE;
  }

  function allKeys(): TileKey[] {
    return [...tiles.keys()].sort((left, right) => {
      const a = parseTileKey(left)!;
      const b = parseTileKey(right)!;
      return a.row - b.row || a.col - b.col;
    });
  }

  function commit(keys: readonly TileKey[]): void {
    const changedKeys = new Set<TileKey>();
    for (const key of keys) {
      if (!validKey(key)) continue;
      changedKeys.add(key);
      const canvas = tiles.get(key);
      if (canvas && isRgbaTransparent(adapter.pixels(canvas))) tiles.delete(key);
    }
    if (!changedKeys.size) return;
    state.lastCommitKeys = [...changedKeys];
    state.revision += 1;
    try {
      commitListener?.([...changedKeys], allKeys());
    } catch (error) {
      console.error("Could not notify drawing persistence", error);
    }
  }

  async function restoreEntries(snapshot: TileSnapshot): Promise<void> {
    const prepared = await Promise.all([...snapshot].map(async ([key, blob]) => {
      if (!validKey(key)) throw new Error(`Invalid drawing tile key: ${key}`);
      if (!blob) return [key, null] as const;
      const canvas = adapter.createCanvas();
      await adapter.restore(canvas, blob);
      return [key, canvas] as const;
    }));
    for (const [key, canvas] of prepared) {
      if (canvas) tiles.set(key, canvas);
      else tiles.delete(key);
    }
  }

  const store: MutableDrawingTileStore = {
    tile(key, create) {
      if (!validKey(key)) return null;
      const existing = tiles.get(key);
      if (existing || !create) return existing ?? null;
      const canvas = adapter.createCanvas();
      tiles.set(key, canvas);
      return canvas;
    },
    keysInRect(rect: WorldRect, includeMissing = false) {
      const x2 = rect.x + rect.width;
      const y2 = rect.y + rect.height;
      const left = Math.min(rect.x, x2);
      const top = Math.min(rect.y, y2);
      const right = Math.max(rect.x, x2);
      const bottom = Math.max(rect.y, y2);
      if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return [];

      const firstCol = Math.floor(left / DRAW_TILE_SIZE_UNITS);
      const firstRow = Math.floor(top / DRAW_TILE_SIZE_UNITS);
      const lastCol = Math.ceil(right / DRAW_TILE_SIZE_UNITS) - 1;
      const lastRow = Math.ceil(bottom / DRAW_TILE_SIZE_UNITS) - 1;
      if (Math.abs(firstCol) > MAX_TILE_COORDINATE || Math.abs(lastCol) > MAX_TILE_COORDINATE ||
        Math.abs(firstRow) > MAX_TILE_COORDINATE || Math.abs(lastRow) > MAX_TILE_COORDINATE ||
        (lastCol - firstCol + 1) * (lastRow - firstRow + 1) > MAX_TILES_PER_RECT) return [];

      const keys: TileKey[] = [];
      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let col = firstCol; col <= lastCol; col += 1) {
          const key = tileKey(col, row);
          if (includeMissing || tiles.has(key)) keys.push(key);
        }
      }
      return keys;
    },
    async snapshot(keys) {
      const entries = await Promise.all([...new Set(keys)].map(async (key) => {
        if (!validKey(key)) throw new Error(`Invalid drawing tile key: ${key}`);
        const canvas = tiles.get(key);
        return [key, canvas ? await adapter.encode(canvas) : null] as const;
      }));
      return new Map(entries);
    },
    async restore(snapshot) {
      await restoreEntries(snapshot);
      commit([...snapshot.keys()]);
    },
    commit,
    get revision() { return state.revision; },
    get lastCommitKeys() { return state.lastCommitKeys; },
    async replaceFromSnapshot(snapshot) {
      await restoreEntries(snapshot);
      const keys = new Set([...tiles.keys(), ...snapshot.keys()]);
      for (const key of keys) if (!snapshot.has(key)) tiles.delete(key);
      state.lastCommitKeys = [...keys];
      state.revision += 1;
    },
    allKeys,
    setCommitListener(listener) { commitListener = listener; },
  };
  return store;
}

export const drawingTileStore = createDrawingTileStore();
/** Contract name shared with the drawing tools. */
export const drawingStore: DrawingTileStore = drawingTileStore;

/** Convert a tile-local pixel coordinate to its world-space origin. */
export function tileWorldOrigin(key: TileKey): { x: number; y: number } | null {
  const parsed = parseTileKey(key);
  return parsed ? {
    x: parsed.col * DRAW_TILE_SIZE_PX / DRAW_PX_PER_UNIT,
    y: parsed.row * DRAW_TILE_SIZE_PX / DRAW_PX_PER_UNIT,
  } : null;
}
