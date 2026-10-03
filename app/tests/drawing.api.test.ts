import { describe, expect, it } from "vitest";
import { drawingLoad, drawingReadTile, drawingSave } from "../src/drawing/api";
import type { DrawingIndex } from "../src/drawing/types";

describe("drawing API browser fallback", () => {
  it("copies tile bytes and index data, then removes deleted tiles", async () => {
    const key = "-2:3";
    const index: DrawingIndex = { version: 1, pxPerUnit: 20, tileSizePx: 512, tiles: [key] };
    const png = new Uint8Array([137, 80, 78, 71]);
    await drawingSave([{ key, png }], index);
    png[0] = 0;
    index.tiles.length = 0;
    expect((await drawingReadTile(key))[0]).toBe(137);
    expect((await drawingLoad()).index?.tiles).toEqual([key]);
    const read = await drawingReadTile(key);
    read[0] = 0;
    expect((await drawingReadTile(key))[0]).toBe(137);
    await drawingSave([{ key, png: null }], { version: 1, pxPerUnit: 20, tileSizePx: 512, tiles: [] });
    expect((await drawingLoad()).index?.tiles).toEqual([]);
    await expect(drawingReadTile(key)).rejects.toThrow(/missing/);
  });
});
