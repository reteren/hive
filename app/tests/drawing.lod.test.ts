import { describe, expect, it } from "vitest";
import { CoarseCompositeCache, COARSE_COMPOSITE_SOURCE_BATCH_SIZE, MAX_COARSE_COMPOSITE_CACHE_BYTES } from "../src/drawing/coarseCompositeCache.svelte";
import { compositeSourceQuad, drawingLodPlan, MAX_COMPOSITE_TARGET_TILES } from "../src/drawing/lod";
import { DRAW_TILE_SIZE_PX, drawLevelForZoom, levelTileUnits, tileKey, type TileKey, type WorldRect } from "../src/drawing/types";
import { TileSpatialIndex } from "../src/drawing/tileSpatialIndex";
import type { DrawingGpu, GpuTexture } from "../src/drawing/gpu/glEngine";
import type { MutableDrawingTileStore } from "../src/drawing/tileStore.svelte";

describe("drawing coarse LOD cache", () => {
  it("keeps the visible composite grid bounded and draws coarser data underneath", () => {
    const levels = [6, 4, 2, 0, -3];
    for (const zoom of [0.05, 0.3, 1]) {
      const width = 1400 / (zoom * 10);
      const height = 900 / (zoom * 10);
      const plan = drawingLodPlan({ x: 25_000 - width / 2, y: 25_000 - height / 2, width, height }, drawLevelForZoom(zoom), levels);
      expect(plan.compositeKeys.length).toBeGreaterThan(0);
      expect(plan.compositeKeys.length).toBeLessThanOrEqual(MAX_COMPOSITE_TARGET_TILES);
      expect(plan.targetLevel).toBeGreaterThanOrEqual(drawLevelForZoom(zoom));
      expect(plan.fallbackLevels.every((level) => level > plan.targetLevel)).toBe(true);
    }
  });

  it("coarsens an oversized viewport before enumerating its tile grid", () => {
    const plan = drawingLodPlan({ x: -5000, y: -5000, width: 10_000, height: 10_000 }, 0, [6, 0]);
    expect(plan.targetLevel).toBeGreaterThan(0);
    expect(plan.compositeKeys.length).toBeLessThanOrEqual(MAX_COMPOSITE_TARGET_TILES);
  });

  it("maps each finer source tile into the target tile without changing level order", () => {
    const texture = {} as WebGLTexture;
    const quad = compositeSourceQuad("4:0:0", tileKey(1, 0), texture);
    expect(quad?.dst).toEqual({ x: 32, y: 0, width: 32, height: 32 });
    expect(quad?.src.texture).toBe(texture);
    expect(compositeSourceQuad("4:0:0", "6:0:0", texture)).toBeNull();
  });

  it("probes a 50,000-unit diagonal drawing at zoom 0.05, 0.3 and 1", () => {
    const index = new TileSpatialIndex();
    const end = 50_000;
    const tileSize = levelTileUnits(0);
    for (let cell = 0; cell <= Math.ceil(end / tileSize); cell += 1) index.add(tileKey(cell, cell, 0));
    const metrics = [0.05, 0.3, 1].map((zoom) => {
      const width = 1400 / (zoom * 10);
      const height = 900 / (zoom * 10);
      const rect = { x: end / 2 - width / 2, y: end / 2 - height / 2, width, height };
      const plan = drawingLodPlan(rect, drawLevelForZoom(zoom), index.levels());
      const fineSources = index.query(rect, 0);
      return {
        zoom,
        targetLevel: plan.targetLevel,
        targetTilesDrawnPerFrame: plan.compositeKeys.length,
        fineTilesToAggregate: fineSources.length,
        maxFineTilesLoadedPerBatch: Math.min(fineSources.length, COARSE_COMPOSITE_SOURCE_BATCH_SIZE),
      };
    });

    expect(metrics.map(({ zoom }) => zoom)).toEqual([0.05, 0.3, 1]);
    expect(metrics.every((entry) => entry.targetTilesDrawnPerFrame <= MAX_COMPOSITE_TARGET_TILES)).toBe(true);
    expect(metrics.every((entry) => entry.maxFineTilesLoadedPerBatch <= COARSE_COMPOSITE_SOURCE_BATCH_SIZE)).toBe(true);
    expect(MAX_COARSE_COMPOSITE_CACHE_BYTES).toBe(3 * MAX_COMPOSITE_TARGET_TILES * DRAW_TILE_SIZE_PX * DRAW_TILE_SIZE_PX * 4);
  });

  it("incrementally loads and composites every visible fine tile within the cache and frame budgets", async () => {
    const index = new TileSpatialIndex();
    const end = 50_000;
    const sourceTileWorldSize = levelTileUnits(0);
    for (let cell = 0; cell <= Math.ceil(end / sourceTileWorldSize); cell += 1) index.add(tileKey(cell, cell, 0));
    const metrics: { zoom: number; loaded: number; drawn: number; gpuBytes: number }[] = [];

    for (const zoom of [0.05, 0.3, 1]) {
      const width = 1400 / (zoom * 10);
      const height = 900 / (zoom * 10);
      const rect = { x: end / 2 - width / 2, y: end / 2 - height / 2, width, height };
      const plan = drawingLodPlan(rect, drawLevelForZoom(zoom), index.levels());
      const loaded = new Map<string, GpuTexture>();
      let maxLoadedBatch = 0;
      let tileDraws = 0;
      const fakeGpu = {
        isLost: false,
        createTexture(w: number, h: number, mipmapped: boolean) {
          return { tex: {} as WebGLTexture, fbo: {} as WebGLFramebuffer, width: w, height: h, mipmapped, mipsDirty: false };
        },
        deleteTexture() {},
        ensureMips() {},
        drawInto(_target: GpuTexture, quads: readonly unknown[]) { if (quads.length) tileDraws += 1; },
        onContextLost() { return () => {}; },
      } as unknown as DrawingGpu;
      const fakeStore = {
        contentRevision: 0,
        levels: () => index.levels(),
        keysInRect: (queryRect: WorldRect, _includeMissing: boolean | undefined, level: number | undefined) => index.query(queryRect, level ?? 0),
        texture: (key: TileKey) => loaded.get(key) ?? null,
        async ensureTiles(keys: readonly TileKey[]) {
          maxLoadedBatch = Math.max(maxLoadedBatch, keys.length);
          for (const key of keys) if (!loaded.has(key)) loaded.set(key, fakeGpu.createTexture(512, 512, true));
        },
      } as unknown as MutableDrawingTileStore;
      const cache = new CoarseCompositeCache(fakeGpu, fakeStore);
      cache.request(plan.compositeKeys, plan.targetLevel);
      for (let frame = 0; frame < 1000 && cache.pendingTileCount > 0; frame += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      const drawn = plan.compositeKeys.filter((key) => cache.texture(key) !== null).length;
      const residentSourceBytes = loaded.size * Math.ceil(512 * 512 * 4 * (4 / 3));
      metrics.push({ zoom, loaded: loaded.size, drawn, gpuBytes: residentSourceBytes + cache.gpuBytes });
      expect(cache.pendingTileCount).toBe(0);
      expect(maxLoadedBatch).toBeLessThanOrEqual(COARSE_COMPOSITE_SOURCE_BATCH_SIZE);
      expect(drawn).toBeGreaterThan(0);
      expect(plan.visibleTileUpperBound).toBeLessThanOrEqual(96);
      expect(cache.gpuBytes).toBeLessThanOrEqual(MAX_COARSE_COMPOSITE_CACHE_BYTES);
      cache.dispose();
    }

    expect(metrics.map(({ zoom }) => zoom)).toEqual([0.05, 0.3, 1]);
  });
});
