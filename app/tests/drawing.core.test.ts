import { describe, expect, it } from "vitest";
import {
  accumulateDabMaxAlpha,
  accumulateSegmentMaxAlpha,
  accumulateStrokeSegment,
  brushWorldWidth,
  createStrokeCoverage,
  interpolateStrokePoints,
  sourceOverAlpha,
} from "../src/drawing/brush";
import { createDrawingTileStore, type DrawingCanvasAdapter } from "../src/drawing/tileStore.svelte";
import { drawLevelForZoom, levelPxPerUnit, levelTileUnits, parseTileKey, tileKey, type TileKey } from "../src/drawing/types";

interface FakeCanvas extends HTMLCanvasElement {
  pixels: Uint8ClampedArray;
}

function fakeCanvasAdapter(): DrawingCanvasAdapter {
  return {
    createCanvas: () => ({ width: 512, height: 512, pixels: new Uint8ClampedArray(512 * 512 * 4) } as unknown as FakeCanvas),
    pixels: (canvas) => (canvas as FakeCanvas).pixels,
    async encode(canvas) {
      const copy = (canvas as FakeCanvas).pixels.slice();
      return new Blob([copy.buffer as ArrayBuffer], { type: "application/octet-stream" });
    },
    async restore(canvas, blob) {
      (canvas as FakeCanvas).pixels.set(new Uint8Array(await blob.arrayBuffer()));
    },
  };
}

describe("drawing core", () => {
  it("keeps the brush width in screen px while board width changes with zoom", () => {
    expect(brushWorldWidth(10, 1)).toBe(1);
    expect(brushWorldWidth(10, 2)).toBe(0.5);
  });

  it("interpolates long pointer jumps without leaving gaps", () => {
    const points = interpolateStrokePoints([{ x: 0, y: 0 }, { x: 100, y: 0 }], 20);
    expect(points).toHaveLength(6);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 100, y: 0 });
    for (let index = 1; index < points.length; index += 1) {
      expect(Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)).toBeLessThanOrEqual(20);
    }
  });

  it("uses max alpha inside one stroke and accumulates only across separate strokes", () => {
    const mask = new Uint8ClampedArray(25);
    accumulateDabMaxAlpha(mask, 5, 5, 2.5, 2.5, 2, 1);
    const onePass = mask.slice();
    accumulateDabMaxAlpha(mask, 5, 5, 2.5, 2.5, 2, 1);
    expect(mask).toEqual(onePass);

    const firstStroke = sourceOverAlpha(0, 128, 0.5);
    const secondStroke = sourceOverAlpha(firstStroke, 128, 0.5);
    expect(firstStroke).toBe(64);
    expect(secondStroke).toBeGreaterThan(firstStroke);
  });

  it("round-trips snapshots and prunes a fully transparent tile", async () => {
    const store = createDrawingTileStore(fakeCanvasAdapter());
    const tile = store.tile("-2:3", true) as unknown as FakeCanvas;
    tile.pixels[3] = 200;
    store.commit(["-2:3"]);
    const before = await store.snapshot(["-2:3"]);
    expect(before.get("-2:3")).toBeInstanceOf(Blob);

    tile.pixels.fill(0);
    store.commit(["-2:3"]);
    expect(store.tile("-2:3", false)).toBeNull();
    expect(store.allKeys()).toEqual([]);

    await store.restore(before);
    expect(store.allKeys()).toEqual(["-2:3"]);
    expect((store.tile("-2:3", false) as unknown as FakeCanvas).pixels[3]).toBe(200);
    expect(store.keysInRect({ x: -51.2, y: 76.8, width: 25.6, height: 25.6 })).toEqual(["-2:3"] satisfies TileKey[]);
  });

  it("picks a level with 1.5–3 raster px per device px at any zoom", () => {
    expect(drawLevelForZoom(1)).toBe(0);
    expect(drawLevelForZoom(0.05)).toBe(4);
    expect(drawLevelForZoom(8)).toBe(-3);
    for (const zoom of [0.05, 0.08, 0.1, 0.3, 0.5, 1, 1.7, 3]) {
      for (const dpr of [1, 1.25, 1.5, 2]) {
        const ratio = levelPxPerUnit(drawLevelForZoom(zoom, dpr)) / (10 * zoom * dpr);
        expect(ratio).toBeGreaterThanOrEqual(1.5);
        expect(ratio).toBeLessThan(3.0001);
      }
    }
  });

  it("keeps level-0 keys in the original format and adds a prefix for other levels", () => {
    expect(tileKey(-2, 3)).toBe("-2:3");
    expect(tileKey(-2, 3, 4)).toBe("4:-2:3");
    expect(parseTileKey("-2:3")).toEqual({ col: -2, row: 3, level: 0 });
    expect(parseTileKey("4:-2:3")).toEqual({ col: -2, row: 3, level: 4 });
    expect(parseTileKey("0:1:2")).toBeNull();
    expect(parseTileKey("9:1:2")).toBeNull();
    expect(levelTileUnits(0)).toBe(25.6);
    expect(levelTileUnits(2)).toBe(102.4);
  });

  it("lists levels coarsest first and finds existing tiles of every level", () => {
    const store = createDrawingTileStore(fakeCanvasAdapter());
    (store.tile("0:0", true) as unknown as FakeCanvas).pixels[3] = 1;
    (store.tile("3:0:0", true) as unknown as FakeCanvas).pixels[3] = 1;
    (store.tile("-1:5:5", true) as unknown as FakeCanvas).pixels[3] = 1;
    store.commit(["0:0", "3:0:0", "-1:5:5"]);
    expect(store.levels()).toEqual([3, 0, -1]);
    expect(store.existingKeysInRect({ x: 1, y: 1, width: 2, height: 2 })).toEqual(["3:0:0", "0:0"]);
    expect(store.keysInRect({ x: 1, y: 1, width: 2, height: 2 }, true, 3)).toEqual(["3:0:0"]);
    (store.tile("3:0:0", false) as unknown as FakeCanvas).pixels.fill(0);
    store.commit(["3:0:0"]);
    expect(store.levels()).toEqual([0, -1]);
  });

  it("rasterizes a soft stroke as one continuous shape without ripples along its edge", () => {
    const width = 120;
    const height = 40;
    const mask = new Uint8ClampedArray(width * height);
    accumulateSegmentMaxAlpha(mask, width, height, 10, 20, 110, 20, 12, 0.1);
    const onePass = mask.slice();
    accumulateSegmentMaxAlpha(mask, width, height, 10, 20, 110, 20, 12, 0.1);
    expect(mask).toEqual(onePass);
    // Row 6 px from the centre line: the soft edge has the same alpha everywhere along the stroke.
    const edgeRow = [...mask.subarray(26 * width + 20, 26 * width + 100)];
    expect(edgeRow[0]).toBeGreaterThan(0);
    expect(edgeRow[0]).toBeLessThan(255);
    expect(new Set(edgeRow).size).toBe(1);
  });

  it("does not build up while holding still but composites a later pass smoothly where a stroke crosses itself", () => {
    const size = 80;
    const radius = 12;
    const window = radius * 1.5;
    const single = createStrokeCoverage(size * size);
    accumulateStrokeSegment(single, size, size, 0, 40, 80, 40, 0, 80, radius, 0.1, window);
    const once = single.value.slice();
    // Holding still at the end: zero-length pieces at the same path length.
    accumulateStrokeSegment(single, size, size, 80, 40, 80, 40, 80, 80, radius, 0.1, window);
    expect(single.value).toEqual(once);

    // Same stroke, later crossing it vertically (far along the path).
    accumulateStrokeSegment(single, size, size, 40, 0, 40, 80, 400, 480, radius, 0.1, window);
    const horizontalOnly = createStrokeCoverage(size * size);
    accumulateStrokeSegment(horizontalOnly, size, size, 0, 40, 80, 40, 0, 80, radius, 0.1, window);
    const verticalOnly = createStrokeCoverage(size * size);
    accumulateStrokeSegment(verticalOnly, size, size, 40, 0, 40, 80, 0, 80, radius, 0.1, window);
    // No crease: around the crossing every pixel is at least as strong as either line alone.
    for (let y = 25; y < 55; y += 1) {
      for (let x = 25; x < 55; x += 1) {
        const offset = y * size + x;
        expect(single.value[offset]).toBeGreaterThanOrEqual(Math.max(horizontalOnly.value[offset]!, verticalOnly.value[offset]!));
      }
    }
  });
});
