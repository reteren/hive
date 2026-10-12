import { describe, expect, it } from "vitest";
import { FarTileCache, farTilesForRect, farZoomBucket } from "../src/board/farTileCache";

describe("far bitmap tile cache", () => {
  it("indexes objects back to every tile and removes reverse references when invalidated", () => {
    const cache = new FarTileCache<string>();
    cache.set(0, 0, { x: 0, y: 0, width: 10, height: 10 }, "left", {
      noteIds: ["n1"], linkIds: ["l1"], zoneIds: [],
    });
    cache.set(1, 0, { x: 10, y: 0, width: 10, height: 10 }, "right", {
      noteIds: ["n1", "n2"], linkIds: ["l2"], zoneIds: ["z1"],
    });

    expect(cache.invalidateObject("note", "n1").map((entry) => entry.value)).toEqual(["left", "right"]);
    expect(cache.invalidateObject("link", "l1")).toEqual([]);
    expect(cache.invalidateObject("zone", "z1")).toEqual([]);
    expect(cache.size).toBe(0);
  });

  it("keeps requested tiles and evicts the least recently used unrequested tile", () => {
    const cache = new FarTileCache<string>();
    for (let x = 0; x < 4; x += 1) {
      cache.set(x, 0, { x: x * 10, y: 0, width: 10, height: 10 }, `${x}`, {
        noteIds: [], linkIds: [], zoneIds: [],
      });
    }
    cache.get(1, 0);
    const removed = cache.retain(new Set(["0:0"]), 2);

    expect(removed.map((entry) => entry.value)).toEqual(["2", "3"]);
    expect(cache.get(0, 0)?.value).toBe("0");
    expect(cache.get(1, 0)?.value).toBe("1");
  });

  it("maps world rectangles to screen-space tiles and keeps zoom stable within a bucket", () => {
    expect(farTilesForRect({ x: -4, y: 4, width: 8, height: 8 }, 8)).toEqual([
      { x: -1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 1 }, { x: 0, y: 1 },
    ]);
    expect(farZoomBucket(0.1)).toBe(farZoomBucket(0.104));
    expect(farZoomBucket(0.1)).not.toBe(farZoomBucket(0.12));
  });
});
