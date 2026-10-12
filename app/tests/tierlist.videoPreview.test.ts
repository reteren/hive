import { describe, expect, it } from "vitest";
import { trimTierlistFrameCache } from "../src/tierlist/videoPreview";

describe("tierlist video frame cache", () => {
  it("evicts least-recently-used resolved canvases and releases their backing store", () => {
    const first = { width: 100, height: 100 } as HTMLCanvasElement;
    const second = { width: 100, height: 100 } as HTMLCanvasElement;
    const entries = new Map([
      ["first", { promise: Promise.resolve(first), canvas: first, settled: true, refs: 0 }],
      ["second", { promise: Promise.resolve(second), canvas: second, settled: true, refs: 0 }],
    ]);

    trimTierlistFrameCache(entries, 1, 100_000);

    expect([...entries.keys()]).toEqual(["second"]);
    expect(first.width).toBe(0);
    expect(first.height).toBe(0);
    expect(second.width).toBe(100);
  });
});
