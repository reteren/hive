import { describe, expect, it } from "vitest";
import {
  createStroke,
  MAX_TRANSIENT_STROKE_GPU_BYTES,
  strokeStateGpuBytes,
} from "../src/drawing/brush";
import type { DrawingGpu, StrokeStateSnapshot, StrokeStateTile } from "../src/drawing/gpu/glEngine";
import { currentDrawLevel, levelPxPerUnit, type BrushSettings } from "../src/drawing/types";

const settings: BrushSettings = {
  color: "#e8e8e8", size: 10, opacity: 0.65, hardness: 0.2,
  tip: "round", calligraphyAngle: 45, sprayDensity: 120, sprayDotSize: 3,
};

function fakeGpu() {
  let created = 0;
  let spilled = 0;
  let restored = 0;
  let resumedWithPriorPathState = 0;
  const statePasses = new Map<StrokeStateTile, number>();
  const restoredTiles = new WeakSet<StrokeStateTile>();
  const savedPasses = new WeakMap<StrokeStateSnapshot, number>();
  const visitsPerTile = new Map<string, number>();
  const spillRgba = new Uint8Array(512 * 512 * 4);
  const spillPosition = new Float32Array(512 * 512);
  spillPosition.fill(Math.fround(-1e30));
  for (let pixel = 0; pixel < 512; pixel += 1) {
    spillRgba[pixel * 4] = 127;
    spillPosition[pixel] = pixel;
  }
  const texture = () => ({} as WebGLTexture);
  const gpu = {
    createStrokeState(size: number): StrokeStateTile {
      created += 1;
      const buffers = () => ({ state: texture(), position: texture(), fbo: {} as WebGLFramebuffer });
      const tile = { size, current: buffers(), next: buffers(), mipsDirty: true };
      statePasses.set(tile, 0);
      return tile;
    },
    deleteStrokeState(tile: StrokeStateTile) { statePasses.delete(tile); },
    syncStrokeRect() {},
    strokePass(tile: StrokeStateTile, origin: { x: number; y: number }) {
      const priorPasses = statePasses.get(tile) ?? 0;
      if (restoredTiles.has(tile) && priorPasses > 0) resumedWithPriorPathState += 1;
      statePasses.set(tile, priorPasses + 1);
      const key = `${origin.x}:${origin.y}`;
      visitsPerTile.set(key, (visitsPerTile.get(key) ?? 0) + 1);
    },
    ensureStrokeMips() {},
    readStrokeCoverage(_tile: StrokeStateTile, rect: { width: number; height: number }) {
      return new Uint8Array(rect.width * rect.height);
    },
    readStrokeState(tile: StrokeStateTile): StrokeStateSnapshot {
      spilled += 1;
      const snapshot = { rgba: spillRgba, position: spillPosition, nextRgba: spillRgba, nextPosition: spillPosition };
      savedPasses.set(snapshot, statePasses.get(tile) ?? 0);
      return snapshot;
    },
    writeStrokeState(tile: StrokeStateTile, snapshot: StrokeStateSnapshot) {
      restored += 1;
      statePasses.set(tile, savedPasses.get(snapshot) ?? 0);
      restoredTiles.add(tile);
    },
  } as unknown as DrawingGpu;
  return { gpu, stats: () => ({ created, spilled, restored, resumedWithPriorPathState, visitsPerTile }) };
}

describe("long stroke transient GPU budget", () => {
  it.each([0.05, 1])("spills and streams a 320+ tile return stroke at zoom %s", async (zoom) => {
    const level = currentDrawLevel(zoom);
    const ppu = levelPxPerUnit(level);
    const tileWorld = 512 / ppu;
    const steps = 322;
    const end = tileWorld * steps;
    const { gpu, stats } = fakeGpu();
    const stroke = createStroke(settings, zoom, level, gpu, MAX_TRANSIENT_STROKE_GPU_BYTES);
    stroke.add({ x: 0, y: 0 });
    for (let step = 1; step <= steps; step += 1) stroke.add({ x: end * step / steps, y: 0 });

    expect(stroke.tileCount).toBeGreaterThanOrEqual(320);
    expect(stroke.spilledTileCount).toBeGreaterThan(0);
    expect(stroke.spilledCpuBytes).toBeLessThan(stroke.tileCount * 32_000);
    expect(stroke.peakGpuBytes).toBeLessThanOrEqual(MAX_TRANSIENT_STROKE_GPU_BYTES);
    expect(stroke.spilledCpuBytes).toBeLessThan(stroke.tileCount * 32_000);
    expect(stroke.residentGpuBytes).toBeLessThanOrEqual(MAX_TRANSIENT_STROKE_GPU_BYTES);

    // Return across already-spilled tiles after a full-path interval, then finish through the
    // streamed source API so this one action never rehydrates every tile at once.
    for (let step = steps - 1; step >= 0; step -= 1) stroke.add({ x: end * step / steps, y: 0 });
    const finished = stroke.finish();
    expect(finished).not.toBeNull();
    let streamed = 0;
    await finished!.source.visitPieces?.(() => { streamed += 1; });

    const result = stats();
    expect(streamed).toBe(stroke.tileCount);
    expect(result.spilled).toBeGreaterThan(0);
    expect(result.restored).toBeGreaterThan(0);
    expect(result.resumedWithPriorPathState).toBeGreaterThan(0);
    expect([...result.visitsPerTile.values()].some((count) => count > 1)).toBe(true);
    expect(stroke.peakGpuBytes).toBeLessThanOrEqual(MAX_TRANSIENT_STROKE_GPU_BYTES);
    expect(strokeStateGpuBytes()).toBeGreaterThan(4 * 1024 * 1024);
    stroke.dispose();
    expect(stroke.residentGpuBytes).toBe(0);
  }, 30_000);
});
