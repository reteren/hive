import { encodeRgbaPng } from "./png";
import { drawingGpu, requireDrawingGpu, type DrawingGpu, type GpuTexture } from "./gpu/glEngine";
import { TileSpatialIndex } from "./tileSpatialIndex";
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
import { t } from "../i18n/i18n.svelte";

const MAX_TILE_COORDINATE = 10_000_000;
const MAX_TILES_PER_RECT = 100_000;
/** Resident tiles keep one RGBA8 mip chain on the GPU (about 1.33 MiB each). */
export const MAX_RESIDENT_DRAWING_TILES = 96;
/** Undo copies kept on the GPU; older ones are compressed into RAM in idle time. */
const MAX_GPU_COPIES = 160;

export interface MutableDrawingTileStore extends DrawingTileStore {
  /** Replace all tiles from saved PNGs without saving or recording Undo (project load). */
  replaceFromPngs(pngs: ReadonlyMap<TileKey, Blob>): Promise<void>;
  /** Keep the full on-disk key index while loading only tiles needed near the viewport. */
  setKnownKeys(keys: readonly TileKey[]): void;
  /** Protect visible native fallback tiles while background composites stream their sources. */
  setVisibleKeys(keys: readonly TileKey[]): void;
  setTileLoader(loader: ((keys: readonly TileKey[]) => Promise<ReadonlyMap<TileKey, Blob>>) | null): void;
  ensureTiles(keys: readonly TileKey[]): Promise<void>;
  markSaved(keys: readonly TileKey[], revisions: ReadonlyMap<TileKey, number>): void;
  dirtyVersions(keys: readonly TileKey[]): ReadonlyMap<TileKey, number>;
  /** PNG (straight alpha) of each tile for saving; null for a missing or fully transparent tile (dropped). */
  exportPngs(keys: readonly TileKey[]): Promise<Map<TileKey, Uint8Array | null>>;
  /** Synchronous snapshot (GPU copies), for capturing tiles bit by bit during a gesture. */
  snapshotNow(keys: readonly TileKey[]): TileSnapshot;
  /** List stored tile keys in stable level/row/column order. */
  allKeys(): readonly TileKey[];
  /** Keys whose content changed in the most recent revision. */
  readonly lastCommitKeys: readonly TileKey[];
  /** Called after a user commit with changed and remaining tile keys. */
  setCommitListener(listener: DrawingCommitListener | null): void;
  /** GPU bytes currently held by resident drawing tiles (not Undo or transient brush buffers). */
  readonly residentGpuBytes: number;
}

export type DrawingCommitListener = (changedKeys: readonly TileKey[]) => void;

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
    // Allocating 1 MB textures is the slow part of copying; demoted copies hand theirs back.
    this.gpuCopy = copyPool.pop() ?? gpu.createTexture(DRAW_TILE_SIZE_PX, DRAW_TILE_SIZE_PX, false);
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
    if (!this.packed) throw new Error(t("Drawing Undo data is missing."));
    gpu.writePremultiplied(target, await inflate(await this.packed));
  }

  /** Move the pixels from VRAM to compressed RAM. */
  demote(gpu: DrawingGpu): void {
    if (!this.gpuCopy) return;
    const raw = gpu.readPremultiplied(this.gpuCopy);
    if (copyPool.length < MAX_POOLED_COPIES) copyPool.push(this.gpuCopy);
    else gpu.deleteTexture(this.gpuCopy);
    this.gpuCopy = null;
    this.packed = deflate(raw);
  }
}

const liveCopies: TileCopy[] = [];
const MAX_POOLED_COPIES = 64;
const copyPool: GpuTexture[] = [];
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
    (lastCol - firstCol + 1) * (lastRow - firstRow + 1) > MAX_TILES_PER_RECT) {
    throw new RangeError(t("Drawing operation covers more than {maxTilesPerRect} tiles; split it into smaller pieces.", { maxTilesPerRect: MAX_TILES_PER_RECT }));
  }

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
  const state = $state({ revision: 0, contentRevision: 0, lastCommitKeys: [] as TileKey[] });
  const tiles = new Map<TileKey, GpuTexture>();
  const tileIndex = new TileSpatialIndex();
  let sortedKeysCache: readonly TileKey[] | null = null;
  const lastUsed = new Map<TileKey, number>();
  const dirtyVersions = new Map<TileKey, number>();
  const loadInFlight = new Map<TileKey, Promise<void>>();
  let visibleKeys = new Set<TileKey>();
  let useClock = 0;
  let tileLoader: ((keys: readonly TileKey[]) => Promise<ReadonlyMap<TileKey, Blob>>) | null = null;
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
    tileIndex.add(key);
    sortedKeysCache = null;
    tiles.set(key, texture);
    lastUsed.set(key, ++useClock);
  }

  function deleteTile(key: TileKey): void {
    const texture = tiles.get(key);
    tiles.delete(key);
    if (texture) drawingGpu()?.deleteTexture(texture);
    tileIndex.delete(key);
    lastUsed.delete(key);
    dirtyVersions.delete(key);
    sortedKeysCache = null;
  }

  function evictTile(key: TileKey): void {
    const texture = tiles.get(key);
    if (!texture) return;
    tiles.delete(key);
    drawingGpu()?.deleteTexture(texture);
    lastUsed.delete(key);
  }

  function evictToBudget(protectedKeys: ReadonlySet<TileKey> = visibleKeys): boolean {
    let evicted = false;
    while (tiles.size > MAX_RESIDENT_DRAWING_TILES) {
      let oldestKey: TileKey | null = null;
      let oldestUse = Number.POSITIVE_INFINITY;
      for (const [key, used] of lastUsed) {
        if (protectedKeys.has(key) || dirtyVersions.has(key)) continue;
        if (used < oldestUse) { oldestKey = key; oldestUse = used; }
      }
      if (oldestKey === null) return evicted;
      evictTile(oldestKey);
      evicted = true;
    }
    return evicted;
  }

  function installPngs(pngs: ReadonlyMap<TileKey, Blob>): Promise<void> {
    return Promise.all([...pngs].map(async ([key, blob]) => {
      if (!validKey(key)) throw new Error(t("Invalid drawing tile key: {key}", { key: key }));
      const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
      return [key, bitmap] as const;
    })).then((decoded) => {
      const engine = drawingGpu();
      if (engine) {
        const gl = engine.gl;
        for (const [key, bitmap] of decoded) {
          if (!tileIndex.has(key)) continue;
          const texture = engine.createTexture(DRAW_TILE_SIZE_PX, DRAW_TILE_SIZE_PX, true);
          gl.bindTexture(gl.TEXTURE_2D, texture.tex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, Math.min(DRAW_TILE_SIZE_PX, bitmap.width), Math.min(DRAW_TILE_SIZE_PX, bitmap.height), gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
          texture.mipsDirty = true;
          setTile(key, texture);
        }
      }
      for (const [, bitmap] of decoded) bitmap.close();
    });
  }

  function levels(): number[] {
    return tileIndex.levels();
  }

  function keysInRect(rect: WorldRect, includeMissing = false, level = 0): TileKey[] {
    return includeMissing
      ? tileKeysInRect(rect, level, () => true)
      : tileIndex.query(rect, level);
  }

  function allKeys(): readonly TileKey[] {
    sortedKeysCache ??= tileIndex.allKeys();
    return sortedKeysCache;
  }

  function bump(keys: readonly TileKey[]): void {
    state.lastCommitKeys = [...keys];
    state.revision += 1;
  }

  function commit(keys: readonly TileKey[]): void {
    const changedKeys = [...new Set(keys.filter(validKey))];
    if (!changedKeys.length) return;
    for (const key of changedKeys) dirtyVersions.set(key, (dirtyVersions.get(key) ?? 0) + 1);
    state.contentRevision += 1;
    bump(changedKeys);
    try {
      commitListener?.(changedKeys);
    } catch (error) {
      console.error("Could not notify drawing persistence", error);
    }
    evictToBudget();
  }

  function clearAll(): void {
    for (const key of [...tiles.keys()]) deleteTile(key);
    tileIndex.clear();
    dirtyVersions.clear();
    lastUsed.clear();
    loadInFlight.clear();
    visibleKeys.clear();
    sortedKeysCache = null;
  }

  // A lost context takes every texture with it; the project reload restores them from disk.
  const gpu = drawingGpu();
  gpu?.onContextLost(() => {
    tiles.clear();
    lastUsed.clear();
    liveCopies.length = 0;
    copyPool.length = 0;
    bump([]);
  });

  const store: MutableDrawingTileStore = {
    has(key) {
      return tileIndex.has(key);
    },
    texture(key, create) {
      if (!validKey(key)) return null;
      const existing = tiles.get(key);
      if (existing) {
        lastUsed.set(key, ++useClock);
        return existing;
      }
      if (!create || tileIndex.has(key)) return null;
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
      const unique = [...new Set(keys)];
      await store.ensureTiles(unique);
      const unavailable = unique.filter((key) => tileIndex.has(key) && !tiles.has(key));
      if (unavailable.length) throw new Error(t("Could not snapshot {count} drawing tiles within the GPU residency budget.", { count: unavailable.length }));
      const snapshot: TileSnapshot = new Map();
      const chunkSize = 8;
      for (let start = 0; start < unique.length; start += chunkSize) {
        for (const [key, copy] of store.snapshotNow(unique.slice(start, start + chunkSize))) snapshot.set(key, copy);
        if (start + chunkSize < unique.length) await yieldToMain();
      }
      return snapshot;
    },
    setKnownKeys(keys) {
      clearAll();
      for (const key of keys) {
        if (!validKey(key)) throw new Error(t("Invalid drawing tile key: {key}", { key: key }));
        tileIndex.add(key);
      }
      sortedKeysCache = null;
      state.contentRevision += 1;
      bump([]);
    },
    setVisibleKeys(keys) {
      visibleKeys = new Set(keys.filter((key) => tileIndex.has(key)));
      evictToBudget(visibleKeys);
    },
    setTileLoader(loader) { tileLoader = loader; },
    async ensureTiles(keys) {
      const ordered = [...new Set(keys)].filter((key) => tileIndex.has(key));
      const protectedKeys = new Set([...visibleKeys, ...ordered.slice(0, MAX_RESIDENT_DRAWING_TILES)]);
      const missing = ordered.slice(0, MAX_RESIDENT_DRAWING_TILES).filter((key) => !tiles.has(key));
      // Keep an LRU of offscreen tiles when there is room; release only enough clean tiles to fit
      // the new viewport. Dirty textures stay resident until their debounced save completes.
      const neededCapacity = Math.min(missing.length, MAX_RESIDENT_DRAWING_TILES);
      while (tiles.size + neededCapacity > MAX_RESIDENT_DRAWING_TILES) {
        let oldestKey: TileKey | null = null;
        let oldestUse = Number.POSITIVE_INFINITY;
        for (const [key, used] of lastUsed) {
          if (protectedKeys.has(key) || dirtyVersions.has(key)) continue;
          if (used < oldestUse) { oldestKey = key; oldestUse = used; }
        }
        if (oldestKey === null) break;
        evictTile(oldestKey);
      }
      const capacity = Math.max(0, MAX_RESIDENT_DRAWING_TILES - tiles.size);
      const requested = missing.slice(0, capacity);
      const toLoad = requested.filter((key) => !loadInFlight.has(key));
      for (let start = 0; start < toLoad.length; start += 8) {
        const batch = toLoad.slice(start, start + 8);
        let pending: Promise<void>;
        pending = (async () => {
          if (!tileLoader) return;
          const result = await tileLoader(batch);
          const available = new Map([...result].filter(([key]) => batch.includes(key) && tileIndex.has(key) && !tiles.has(key)));
          if (available.size) await installPngs(available);
        })().finally(() => {
          for (const key of batch) if (loadInFlight.get(key) === pending) loadInFlight.delete(key);
        });
        for (const key of batch) loadInFlight.set(key, pending);
        await pending;
      }
      await Promise.all([...new Set(requested.map((key) => loadInFlight.get(key)).filter((pending): pending is Promise<void> => pending !== undefined))]);
      evictToBudget(protectedKeys);
      if (requested.some((key) => tiles.has(key))) bump(requested);
    },
    dirtyVersions(keys) {
      return new Map(keys.flatMap((key) => dirtyVersions.has(key) ? [[key, dirtyVersions.get(key)!] as const] : []));
    },
    markSaved(keys, revisions) {
      for (const key of keys) if (dirtyVersions.get(key) === revisions.get(key)) dirtyVersions.delete(key);
      const residentBefore = tiles.size;
      evictToBudget();
      if (tiles.size < residentBefore) bump(keys);
    },
    snapshotNow(keys) {
      const engine = requireDrawingGpu();
      const snapshot: TileSnapshot = new Map();
      for (const key of new Set(keys)) {
        if (!validKey(key)) throw new Error(t("Invalid drawing tile key: {key}", { key: key }));
        const texture = tiles.get(key);
        if (!texture && tileIndex.has(key)) throw new Error(t("Drawing tile {key} is not resident; load it before taking a synchronous snapshot.", { key: key }));
        snapshot.set(key, texture ? new TileCopy(engine, texture) : null);
      }
      return snapshot;
    },
    async restore(snapshot) {
      const engine = requireDrawingGpu();
      for (const [key, copy] of snapshot) {
        if (!validKey(key)) throw new Error(t("Invalid drawing tile key: {key}", { key: key }));
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
    get contentRevision() { return state.contentRevision; },
    get residentGpuBytes() {
      let bytes = 0;
      for (const texture of tiles.values()) {
        const base = texture.width * texture.height * 4;
        bytes += texture.mipmapped ? base * (4 / 3) : base;
      }
      return Math.ceil(bytes);
    },
    get lastCommitKeys() { return state.lastCommitKeys; },
    async replaceFromPngs(pngs) {
      clearAll();
      for (const key of pngs.keys()) {
        if (!validKey(key)) throw new Error(t("Invalid drawing tile key: {key}", { key: key }));
        tileIndex.add(key);
      }
      await installPngs(pngs);
      evictToBudget();
      state.contentRevision += 1;
      bump([...pngs.keys()]);
    },
    async exportPngs(keys) {
      const engine = drawingGpu();
      const result = new Map<TileKey, Uint8Array | null>();
      const pending: Promise<void>[] = [];
      let sliceStart = performance.now();
      for (const key of new Set(keys)) {
        // Yield before another synchronous GPU readback once this slice uses its small time budget.
        if (performance.now() - sliceStart > 2) {
          await yieldToMain();
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

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** World-space origin and side of a tile. */
export function tileWorldOrigin(key: TileKey): { x: number; y: number; size: number } | null {
  const parsed = parseTileKey(key);
  if (!parsed) return null;
  const size = levelTileUnits(parsed.level);
  return { x: parsed.col * size, y: parsed.row * size, size };
}
