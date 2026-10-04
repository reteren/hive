import { encodeRgbaPng } from "./png";
import { drawingGpu, requireDrawingGpu, type DrawingGpu, type GpuTexture } from "./gpu/glEngine";
import {
  DRAW_TILE_SIZE_PX,
  levelTileUnits,
  parseTileKey,
  tileKey,
  type DrawingTileStore,
  type TileKey,
  type TileSnapshot,
  type WorldRect,
} from "./types";

const MAX_TILE_COORDINATE = 10_000_000;
const MAX_TILES_PER_RECT = 100_000;
/** Undo copies kept on the GPU; older ones are compressed into RAM in idle time. */
const MAX_GPU_COPIES = 160;

export interface MutableDrawingTileStore extends DrawingTileStore {
  /** Replace all tiles from saved PNGs without saving or recording Undo (project load). */
  replaceFromPngs(pngs: ReadonlyMap<TileKey, Blob>): Promise<void>;
  /** PNG (straight alpha) of each tile for saving; null for a missing or fully transparent tile (dropped). */
  exportPngs(keys: readonly TileKey[]): Promise<Map<TileKey, Uint8Array | null>>;
  /** List stored tile keys in stable level/row/column order. */
  allKeys(): TileKey[];
  /** Keys whose content changed in the most recent revision. */
  readonly lastCommitKeys: readonly TileKey[];
  /** Called after a user commit with changed and remaining tile keys. */
  setCommitListener(listener: DrawingCommitListener | null): void;
}

export type DrawingCommitListener = (changedKeys: readonly TileKey[], tileKeys: readonly TileKey[]) => void;

/** Pure alpha scan. */
export function isRgbaTransparent(pixels: Uint8ClampedArray | Uint8Array): boolean {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) return false;
  }
  return true;
}

/**
 * One tile's content kept for Undo/Redo: a GPU copy while recent, later a deflated premultiplied
 * byte buffer. `null` entries of a TileSnapshot mean "tile absent".
 */
export class TileCopy {
  private gpuCopy: GpuTexture | null;
  private packed: Promise<Uint8Array> | null = null;

  constructor(gpu: DrawingGpu, source: GpuTexture) {
    this.gpuCopy = gpu.createTexture(DRAW_TILE_SIZE_PX, DRAW_TILE_SIZE_PX, false);
    gpu.copyTexture(source, this.gpuCopy);
    liveCopies.push(this);
    scheduleDemotion();
  }

  get onGpu(): boolean {
    return this.gpuCopy !== null;
  }

  /** Write this content into a tile texture. */
  async writeInto(gpu: DrawingGpu, target: GpuTexture): Promise<void> {
    if (this.gpuCopy) {
      gpu.copyTexture(this.gpuCopy, target);
      return;
    }
    if (!this.packed) throw new Error("Drawing Undo data is missing.");
    gpu.writePremultiplied(target, await inflate(await this.packed));
  }

  /** Move the pixels from VRAM to compressed RAM. */
  demote(gpu: DrawingGpu): void {
    if (!this.gpuCopy) return;
    const raw = gpu.readPremultiplied(this.gpuCopy);
    gpu.deleteTexture(this.gpuCopy);
    this.gpuCopy = null;
    this.packed = deflate(raw);
  }
}

const liveCopies: TileCopy[] = [];
let demotionScheduled = false;

function scheduleDemotion(): void {
  if (demotionScheduled || liveCopies.length <= MAX_GPU_COPIES) return;
  demotionScheduled = true;
  const run = () => {
    demotionScheduled = false;
    const gpu = drawingGpu();
    if (!gpu || gpu.isLost) return;
    const started = performance.now();
    // A few per slice: each readback stalls the GPU for about a millisecond.
    while (liveCopies.length > MAX_GPU_COPIES && performance.now() - started < 8) {
      liveCopies.shift()?.demote(gpu);
    }
    scheduleDemotion();
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 50);
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Tile keys of one level intersecting a world rect (pure; shared with tests). */
export function tileKeysInRect(rect: WorldRect, level: number, accept: (key: TileKey) => boolean): TileKey[] {
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;
  const left = Math.min(rect.x, x2);
  const top = Math.min(rect.y, y2);
  const right = Math.max(rect.x, x2);
  const bottom = Math.max(rect.y, y2);
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return [];

  const size = levelTileUnits(level);
  const firstCol = Math.floor(left / size);
  const firstRow = Math.floor(top / size);
  const lastCol = Math.ceil(right / size) - 1;
  const lastRow = Math.ceil(bottom / size) - 1;
  if (Math.abs(firstCol) > MAX_TILE_COORDINATE || Math.abs(lastCol) > MAX_TILE_COORDINATE ||
    Math.abs(firstRow) > MAX_TILE_COORDINATE || Math.abs(lastRow) > MAX_TILE_COORDINATE ||
    (lastCol - firstCol + 1) * (lastRow - firstRow + 1) > MAX_TILES_PER_RECT) return [];

  const keys: TileKey[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let col = firstCol; col <= lastCol; col += 1) {
      const key = tileKey(col, row, level);
      if (accept(key)) keys.push(key);
    }
  }
  return keys;
}

export function createDrawingTileStore(): MutableDrawingTileStore {
  const state = $state({ revision: 0, lastCommitKeys: [] as TileKey[] });
  const tiles = new Map<TileKey, GpuTexture>();
  const levelCounts = new Map<number, number>();
  let commitListener: DrawingCommitListener | null = null;

  function validKey(key: TileKey): boolean {
    const parsed = parseTileKey(key);
    return parsed !== null && Number.isSafeInteger(parsed.col) && Number.isSafeInteger(parsed.row) &&
      Math.abs(parsed.col) <= MAX_TILE_COORDINATE && Math.abs(parsed.row) <= MAX_TILE_COORDINATE;
  }

  function setTile(key: TileKey, texture: GpuTexture): void {
    const previous = tiles.get(key);
    if (previous === texture) return;
    if (previous) drawingGpu()?.deleteTexture(previous);
    else {
      const level = parseTileKey(key)!.level;
      levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
    }
    tiles.set(key, texture);
  }

  function deleteTile(key: TileKey): void {
    const texture = tiles.get(key);
    if (!texture) return;
    tiles.delete(key);
    drawingGpu()?.deleteTexture(texture);
    const level = parseTileKey(key)!.level;
    const count = (levelCounts.get(level) ?? 1) - 1;
    if (count > 0) levelCounts.set(level, count);
    else levelCounts.delete(level);
  }

  function levels(): number[] {
    return [...levelCounts.keys()].sort((a, b) => b - a);
  }

  function keysInRect(rect: WorldRect, includeMissing = false, level = 0): TileKey[] {
    return tileKeysInRect(rect, level, (key) => includeMissing || tiles.has(key));
  }

  function allKeys(): TileKey[] {
    return [...tiles.keys()].sort((left, right) => {
      const a = parseTileKey(left)!;
      const b = parseTileKey(right)!;
      return b.level - a.level || a.row - b.row || a.col - b.col;
    });
  }

  function bump(keys: readonly TileKey[]): void {
    state.lastCommitKeys = [...keys];
    state.revision += 1;
  }

  function commit(keys: readonly TileKey[]): void {
    const changedKeys = [...new Set(keys.filter(validKey))];
    if (!changedKeys.length) return;
    bump(changedKeys);
    try {
      commitListener?.(changedKeys, allKeys());
    } catch (error) {
      console.error("Could not notify drawing persistence", error);
    }
  }

  function clearAll(): void {
    for (const key of [...tiles.keys()]) deleteTile(key);
  }

  // A lost context takes every texture with it; the project reload restores them from disk.
  const gpu = drawingGpu();
  gpu?.onContextLost(() => {
    tiles.clear();
    levelCounts.clear();
    liveCopies.length = 0;
    bump([]);
  });

  const store: MutableDrawingTileStore = {
    has(key) {
      return tiles.has(key);
    },
    texture(key, create) {
      if (!validKey(key)) return null;
      const existing = tiles.get(key);
      if (existing || !create) return existing ?? null;
      const texture = requireDrawingGpu().createTexture(DRAW_TILE_SIZE_PX, DRAW_TILE_SIZE_PX, true);
      setTile(key, texture);
      return texture;
    },
    keysInRect,
    existingKeysInRect(rect) {
      return levels().flatMap((level) => keysInRect(rect, false, level));
    },
    levels,
    async snapshot(keys) {
      const engine = requireDrawingGpu();
      const snapshot: TileSnapshot = new Map();
      for (const key of new Set(keys)) {
        if (!validKey(key)) throw new Error(`Invalid drawing tile key: ${key}`);
        const texture = tiles.get(key);
        snapshot.set(key, texture ? new TileCopy(engine, texture) : null);
      }
      return snapshot;
    },
    async restore(snapshot) {
      const engine = requireDrawingGpu();
      for (const [key, copy] of snapshot) {
        if (!validKey(key)) throw new Error(`Invalid drawing tile key: ${key}`);
        if (!copy) {
          deleteTile(key);
          continue;
        }
        const target = tiles.get(key) ?? engine.createTexture(DRAW_TILE_SIZE_PX, DRAW_TILE_SIZE_PX, true);
        await copy.writeInto(engine, target);
        setTile(key, target);
      }
      commit([...snapshot.keys()]);
    },
    commit,
    get revision() { return state.revision; },
    get lastCommitKeys() { return state.lastCommitKeys; },
    async replaceFromPngs(pngs) {
      const engine = drawingGpu();
      const decoded = await Promise.all([...pngs].map(async ([key, blob]) => {
        if (!validKey(key)) throw new Error(`Invalid drawing tile key: ${key}`);
        const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
        return [key, bitmap] as const;
      }));
      clearAll();
      if (engine) {
        const gl = engine.gl;
        for (const [key, bitmap] of decoded) {
          const texture = engine.createTexture(DRAW_TILE_SIZE_PX, DRAW_TILE_SIZE_PX, true);
          gl.bindTexture(gl.TEXTURE_2D, texture.tex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, Math.min(DRAW_TILE_SIZE_PX, bitmap.width), Math.min(DRAW_TILE_SIZE_PX, bitmap.height), gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
          texture.mipsDirty = true;
          setTile(key, texture);
        }
      }
      for (const [, bitmap] of decoded) bitmap.close();
      bump([...pngs.keys()]);
    },
    async exportPngs(keys) {
      const engine = drawingGpu();
      const result = new Map<TileKey, Uint8Array | null>();
      const pending: Promise<void>[] = [];
      let sliceStart = performance.now();
      for (const key of new Set(keys)) {
        // Readbacks are spread over frames so saving never stalls drawing for long.
        if (performance.now() - sliceStart > 6) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          sliceStart = performance.now();
        }
        const texture = tiles.get(key);
        if (!engine || !texture || engine.isLost) {
          result.set(key, null);
          continue;
        }
        const pixels = engine.readStraight(texture);
        if (isRgbaTransparent(pixels)) {
          // Erasing can empty a tile; it is dropped here, where its pixels are read anyway.
          deleteTile(key);
          bump([key]);
          result.set(key, null);
          continue;
        }
        pending.push(encodeRgbaPng(pixels, DRAW_TILE_SIZE_PX, DRAW_TILE_SIZE_PX)
          .then(async (blob) => { result.set(key, new Uint8Array(await blob.arrayBuffer())); }));
      }
      await Promise.all(pending);
      return result;
    },
    allKeys,
    setCommitListener(listener) { commitListener = listener; },
  };
  return store;
}

export const drawingTileStore = createDrawingTileStore();
/** Contract name shared with the drawing tools. */
export const drawingStore: DrawingTileStore = drawingTileStore;

/** World-space origin and side of a tile. */
export function tileWorldOrigin(key: TileKey): { x: number; y: number; size: number } | null {
  const parsed = parseTileKey(key);
  if (!parsed) return null;
  const size = levelTileUnits(parsed.level);
  return { x: parsed.col * size, y: parsed.row * size, size };
}
