import { describe, expect, it } from "vitest";
import {
  accumulateDabMaxAlpha,
  brushWorldWidth,
  interpolateStrokePoints,
  sourceOverAlpha,
} from "../src/drawing/brush";
import { createDrawingTileStore, type DrawingCanvasAdapter } from "../src/drawing/tileStore.svelte";
import type { TileKey } from "../src/drawing/types";

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
});
