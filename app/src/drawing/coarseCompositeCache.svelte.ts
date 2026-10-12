import type { DrawingGpu, GpuTexture } from "./gpu/glEngine";
import { compositeSourceQuad, MAX_COMPOSITE_TARGET_TILES, MAX_COARSE_SOURCE_BATCH_SIZE } from "./lod";
import { tileWorldOrigin } from "./tileStore.svelte";
import type { MutableDrawingTileStore } from "./tileStore.svelte";
import { DRAW_TILE_SIZE_PX, parseTileKey, type TileKey } from "./types";

/** A bounded cache of non-mipmapped 512² composites (1 MiB per entry). */
export const MAX_COARSE_COMPOSITE_CACHE_BYTES = MAX_COMPOSITE_TARGET_TILES * DRAW_TILE_SIZE_PX * DRAW_TILE_SIZE_PX * 4;
const COMPOSITE_BYTES = DRAW_TILE_SIZE_PX * DRAW_TILE_SIZE_PX * 4;
export const COARSE_COMPOSITE_SOURCE_BATCH_SIZE = MAX_COARSE_SOURCE_BATCH_SIZE;

interface CompositeEntry {
  key: TileKey;
  level: number;
  texture: GpuTexture | null;
  contentRevision: number;
  needsClear: boolean;
  empty: boolean;
  sources: TileKey[] | null;
  nextSource: number;
  complete: boolean;
  lastUsed: number;
}

/**
 * Builds one target tile at a time, yielding after each small source batch. Source levels are fed in
 * coarsest-to-finest order, matching the normal renderer's Porter-Duff composition.
 */
export class CoarseCompositeCache {
  private readonly entries = new Map<TileKey, CompositeEntry>();
  private readonly queued = new Set<TileKey>();
  private readonly queue: TileKey[] = [];
  private readonly state = $state({ revision: 0 });
  private clock = 0;
  private contentRevision: number;
  private scheduled = false;
  private running = false;
  private disposed = false;
  private notBefore = 0;
  private readonly stopContextLost: () => void;

  constructor(private readonly gpu: DrawingGpu, private readonly store: MutableDrawingTileStore) {
    this.contentRevision = store.contentRevision;
    this.stopContextLost = gpu.onContextLost(() => {
      this.entries.clear();
      this.queue.length = 0;
      this.queued.clear();
      this.contentRevision = store.contentRevision;
      this.changed();
    });
  }

  get revision(): number { return this.state.revision; }

  get gpuBytes(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (entry.texture) count += 1;
    return count * COMPOSITE_BYTES;
  }

  get cachedTileCount(): number { return this.entries.size; }

  get pendingTileCount(): number { return this.queue.length + Number(this.running); }

  texture(key: TileKey): GpuTexture | null {
    this.syncContentRevision();
    const entry = this.entries.get(key);
    if (!entry || entry.contentRevision !== this.store.contentRevision || entry.needsClear || entry.empty) return null;
    entry.lastUsed = ++this.clock;
    return entry.texture;
  }

  /** Queue only target tiles in the current viewport; building happens after the current frame. */
  request(keys: readonly TileKey[], level: number): void {
    if (this.disposed || this.gpu.isLost) return;
    this.syncContentRevision();
    const wanted = new Set(keys);
    if (this.queue.some((key) => !wanted.has(key))) {
      for (const key of this.queue) if (!wanted.has(key)) this.queued.delete(key);
      const retained = this.queue.filter((key) => wanted.has(key));
      this.queue.length = 0;
      this.queue.push(...retained);
    }
    for (const key of keys) {
      const parsed = parseTileKey(key);
      if (!parsed || parsed.level !== level) continue;
      let entry = this.entries.get(key);
      if (entry && entry.contentRevision !== this.store.contentRevision) {
        entry.contentRevision = this.store.contentRevision;
        entry.sources = null;
        entry.nextSource = 0;
        entry.complete = false;
        entry.needsClear = true;
        entry.empty = false;
      }
      if (!entry) {
        const reusable = this.makeRoom(key);
        if (reusable === false) continue;
        entry = reusable ?? {
          key,
          level,
          texture: this.gpu.createTexture(DRAW_TILE_SIZE_PX, DRAW_TILE_SIZE_PX, false),
          contentRevision: this.store.contentRevision,
          needsClear: false,
          empty: false,
          sources: null,
          nextSource: 0,
          complete: false,
          lastUsed: ++this.clock,
        };
        entry.key = key;
        entry.level = level;
        entry.contentRevision = this.store.contentRevision;
        entry.needsClear = reusable !== null;
        entry.empty = false;
        entry.sources = null;
        entry.nextSource = 0;
        entry.complete = false;
        entry.lastUsed = ++this.clock;
        this.entries.set(key, entry);
      }
      entry.lastUsed = ++this.clock;
      if (!entry.complete && !this.queued.has(key)) {
        this.queued.add(key);
        this.queue.push(key);
      }
    }
    this.schedule();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopContextLost();
    for (const entry of this.entries.values()) this.gpu.deleteTexture(entry.texture);
    this.entries.clear();
    this.queue.length = 0;
    this.queued.clear();
  }

  private syncContentRevision(): void {
    if (this.contentRevision === this.store.contentRevision) return;
    // Mark every old entry stale by revision in O(1); texture clearing/reuse happens a tile at a time
    // in the idle worker so a commit never deletes dozens of GPU resources on the input path.
    this.contentRevision = this.store.contentRevision;
  }

  private makeRoom(protectedKey: TileKey): CompositeEntry | null | false {
    if (this.entries.size * COMPOSITE_BYTES < MAX_COARSE_COMPOSITE_CACHE_BYTES) return null;
    let oldest: CompositeEntry | null = null;
    for (const entry of this.entries.values()) {
      if (entry.key === protectedKey || this.queued.has(entry.key)) continue;
      if (!oldest || entry.lastUsed < oldest.lastUsed) oldest = entry;
    }
    if (!oldest) return false;
    this.entries.delete(oldest.key);
    return oldest;
  }

  private schedule(delay = 0): void {
    if (this.scheduled || this.running || this.disposed || this.queue.length === 0) return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      void this.drainOne();
    };
    const wait = Math.max(delay, this.notBefore - Date.now());
    if (wait > 0) setTimeout(run, wait);
    else if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 100 });
    else setTimeout(run, 0);
  }

  private async drainOne(): Promise<void> {
    if (this.running || this.disposed || this.gpu.isLost) return;
    this.running = true;
    const key = this.queue.shift();
    if (key) this.queued.delete(key);
    try {
      if (!key) return;
      const entry = this.entries.get(key);
      if (!entry || entry.complete || !entry.texture) return;
      const buildRevision = entry.contentRevision;
      if (entry.sources === null) {
        const origin = tileWorldOrigin(key);
        if (!origin) {
          entry.complete = true;
          return;
        }
        const rect = { x: origin.x, y: origin.y, width: origin.size, height: origin.size };
        // Higher level numbers are coarser; include the target and every finer source below it.
        const sourceLevels = this.store.levels().filter((sourceLevel) => sourceLevel <= entry.level).sort((a, b) => b - a);
        entry.sources = sourceLevels.flatMap((sourceLevel) => this.store.keysInRect(rect, false, sourceLevel));
        if (entry.sources.length === 0) {
          if (entry.needsClear && entry.texture) this.gpu.clear(entry.texture);
          entry.needsClear = false;
          entry.empty = true;
          entry.complete = true;
          this.changed();
          return;
        }
      }

      const batch = entry.sources.slice(entry.nextSource, entry.nextSource + COARSE_COMPOSITE_SOURCE_BATCH_SIZE);
      await this.store.ensureTiles(batch);
      if (this.disposed || this.gpu.isLost || this.entries.get(key) !== entry) return;
      if (buildRevision !== this.store.contentRevision || buildRevision !== entry.contentRevision) {
        this.queueAgain(key);
        return;
      }

      const quads = [];
      for (const sourceKey of batch) {
        const sourceTexture = this.store.texture(sourceKey, false);
        if (!sourceTexture) {
          // Residency can be temporarily full of dirty tiles; retry after saves/evictions make room.
          this.queueAgain(key, 250);
          return;
        }
        this.gpu.ensureMips(sourceTexture);
        const quad = compositeSourceQuad(key, sourceKey, sourceTexture.tex);
        if (quad) quads.push(quad);
      }
      if (entry.needsClear) {
        this.gpu.clear(entry.texture);
        entry.needsClear = false;
      }
      this.gpu.drawInto(entry.texture, quads, "over");
      entry.empty = false;
      entry.nextSource += batch.length;
      entry.lastUsed = ++this.clock;
      if (entry.nextSource >= entry.sources.length) entry.complete = true;
      else this.queueAgain(key);
      this.changed();
    } catch (error) {
      console.error("Could not build a coarse drawing composite", error);
      if (key && this.entries.has(key)) this.queueAgain(key, 1000);
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  private queueAgain(key: TileKey, delay = 0): void {
    if (!this.queued.has(key)) {
      this.queued.add(key);
      this.queue.push(key);
    }
    if (delay > 0) this.notBefore = Math.max(this.notBefore, Date.now() + delay);
    this.schedule(delay);
  }

  private changed(): void {
    this.state.revision += 1;
  }
}
