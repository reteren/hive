import { describe, expect, it } from "vitest";
import {
  accumulateDabMaxAlpha,
  accumulateSegmentMaxAlpha,
  accumulateStrokeSegment,
  calligraphySegmentAlpha,
  calligraphySegmentDistance,
  brushWorldWidth,
  createStrokeCoverage,
  interpolateStrokePoints,
  sourceOverAlpha,
  strokePassBatchCount,
} from "../src/drawing/brush";
import { isRgbaTransparent, tileKeysInRect } from "../src/drawing/tileStore.svelte";
import { drawLevelForZoom, levelPxPerUnit, levelTileUnits, parseTileKey, tileKey, type TileKey } from "../src/drawing/types";

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

  it("finds tile keys of a level inside a world rect and detects empty tiles", () => {
    const all = () => true;
    expect(tileKeysInRect({ x: -51, y: 77, width: 25, height: 25 }, 0, all)).toEqual(["-2:3"] satisfies TileKey[]);
    expect(tileKeysInRect({ x: 1, y: 1, width: 2, height: 2 }, 3, all)).toEqual(["3:0:0"]);
    expect(tileKeysInRect({ x: 0, y: 0, width: 30, height: 1 }, 0, all)).toEqual(["0:0", "1:0"]);
    expect(tileKeysInRect({ x: 0, y: 0, width: 30, height: 1 }, 0, (key) => key !== "0:0")).toEqual(["1:0"]);
    expect(isRgbaTransparent(new Uint8ClampedArray(16))).toBe(true);
    const pixels = new Uint8ClampedArray(16);
    pixels[7] = 1;
    expect(isRgbaTransparent(pixels)).toBe(false);
  });

  it("picks a level with 1.33–2.67 raster px per device px at any zoom", () => {
    expect(drawLevelForZoom(1)).toBe(0);
    expect(drawLevelForZoom(0.05)).toBe(4);
    expect(drawLevelForZoom(8)).toBe(-3);
    for (const zoom of [0.05, 0.08, 0.1, 0.3, 0.5, 1, 1.7, 3]) {
      for (const dpr of [1, 1.25, 1.5, 2]) {
        const ratio = levelPxPerUnit(drawLevelForZoom(zoom, dpr)) / (10 * zoom * dpr);
        expect(ratio).toBeGreaterThanOrEqual(1.33);
        expect(ratio).toBeLessThan(2.6667);
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

describe("calligraphy nib sweep", () => {
  it("covers every point of a fast segment plus the fixed-angle nib", () => {
    const from = { x: 10, y: 20 };
    const to = { x: 90, y: 100 };
    const angle = 28;
    const radians = angle * Math.PI / 180;
    const radius = 12;
    for (let step = 0; step <= 20; step += 1) {
      const t = step / 20;
      for (const nibOffset of [-radius, -radius / 2, 0, radius / 2, radius]) {
        const point = {
          x: from.x + (to.x - from.x) * t + Math.cos(radians) * nibOffset,
          y: from.y + (to.y - from.y) * t + Math.sin(radians) * nibOffset,
        };
        expect(calligraphySegmentDistance(point, from, to, angle)).toBeLessThanOrEqual(radius + 1e-8);
      }
    }
  });

  it("stays thin along the nib angle and spans the nib length across it", () => {
    const radius = 10;
    const horizontal = { from: { x: 0, y: 20 }, to: { x: 100, y: 20 } };
    expect(calligraphySegmentDistance({ x: 50, y: 21.3 }, horizontal.from, horizontal.to, 0)).toBeLessThan(radius);
    expect(calligraphySegmentDistance({ x: 50, y: 21.5 }, horizontal.from, horizontal.to, 0)).toBeGreaterThan(radius);

    const vertical = { from: { x: 20, y: 0 }, to: { x: 20, y: 100 } };
    expect(calligraphySegmentDistance({ x: 29, y: 50 }, vertical.from, vertical.to, 0)).toBeLessThan(radius);
    expect(calligraphySegmentDistance({ x: 31, y: 50 }, vertical.from, vertical.to, 0)).toBeGreaterThan(radius);
  });

  it("uses the Round edge falloff so hardness changes calligraphy coverage", () => {
    const soft = calligraphySegmentAlpha(5, 10, 0);
    const hard = calligraphySegmentAlpha(5, 10, 0.9);
    expect(soft).toBeGreaterThan(0);
    expect(soft).toBeLessThan(hard);
    expect(hard).toBe(255);
  });
});

describe("GPU stroke segment batches", () => {
  it("keeps every shader pass within its 64-segment capacity", () => {
    expect(strokePassBatchCount(0)).toBe(0);
    expect(strokePassBatchCount(64)).toBe(1);
    expect(strokePassBatchCount(65)).toBe(2);
    expect(strokePassBatchCount(130)).toBe(3);
  });
});

describe("smoothed stroke path (debug 23 p.1)", () => {
  it("turns at most a few degrees between pieces, ends exactly at p2 and never overshoots a sharp turn", async () => {
    const { smoothStrokeSamples } = await import("../src/drawing/brush");
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 40, y: 0 };
    const p2 = { x: 40, y: 40 };
    const p3 = { x: 0, y: 40 };
    const samples = smoothStrokeSamples(p0, p1, p2, p3);
    expect(samples.at(-1)).toEqual(p2);
    const path = [p1, ...samples];
    let maxTurn = 0;
    for (let index = 2; index < path.length; index += 1) {
      const a = Math.atan2(path[index - 1]!.y - path[index - 2]!.y, path[index - 1]!.x - path[index - 2]!.x);
      const b = Math.atan2(path[index]!.y - path[index - 1]!.y, path[index]!.x - path[index - 1]!.x);
      maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))));
    }
    expect(maxTurn * 180 / Math.PI).toBeLessThanOrEqual(4.5);
    for (const point of samples) {
      expect(point.x).toBeGreaterThanOrEqual(39);
      expect(point.x).toBeLessThanOrEqual(52);
      expect(point.y).toBeGreaterThanOrEqual(-0.5);
      expect(point.y).toBeLessThanOrEqual(40.5);
    }
  });

  it("keeps straight input straight and survives repeated points", async () => {
    const { smoothStrokeSamples } = await import("../src/drawing/brush");
    expect(smoothStrokeSamples({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 })).toEqual([{ x: 20, y: 0 }]);
    const samples = smoothStrokeSamples({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 10 });
    expect(samples.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(samples.at(-1)).toEqual({ x: 10, y: 10 });
  });
});

describe("raster level of huge brushes (debug 25 p.7)", () => {
  it("coarsens big soft brushes, keeps small and hard ones crisp", async () => {
    const { strokeRasterLevel } = await import("../src/drawing/brush");
    expect(strokeRasterLevel(60, 0, 0)).toBe(0);
    expect(strokeRasterLevel(800, 0, 0)).toBe(3);
    expect(strokeRasterLevel(800, 0.85, 0)).toBe(3);
    expect(strokeRasterLevel(300, 1, 0)).toBe(0);
    expect(strokeRasterLevel(1000, 1, 0)).toBe(1);
    expect(strokeRasterLevel(800, 0, 5)).toBe(6);
  });
});
