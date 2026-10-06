import { describe, expect, it } from "vitest";
import { BRUSH_TIPS, brushTipShaderIndex } from "../src/drawing/brushes/tips";
import { createSeededRandom, randomSprayDabs, sprayRate } from "../src/drawing/brushes/sprayMath";
import { DEFAULT_BRUSH } from "../src/drawing/types";
import { normalizeBrushSettings } from "../src/drawing/settings";

describe("brush tips and spray settings", () => {
  it("keeps the named tips mapped to stable shader values", () => {
    expect(BRUSH_TIPS.map(({ id }) => id)).toEqual(["round", "marker", "pencil", "calligraphy", "charcoal"]);
    expect(BRUSH_TIPS.map(({ id }) => brushTipShaderIndex(id))).toEqual([0, 1, 2, 3, 4]);
  });

  it("upgrades old brush settings and clamps persisted tip and spray options", () => {
    expect(normalizeBrushSettings({ color: "#123456", size: 8, opacity: 0.6, hardness: 0.4 })).toEqual({
      ...DEFAULT_BRUSH, color: "#123456", size: 8, opacity: 0.6, hardness: 0.4,
    });
    expect(normalizeBrushSettings({ tip: "unknown", calligraphyAngle: 240, sprayDensity: 0, sprayDotSize: 99 }))
      .toMatchObject({ tip: "round", calligraphyAngle: 180, sprayDensity: 1, sprayDotSize: 32 });
  });

  it("uses a repeatable per-stroke random sequence and stays inside the brush circle", () => {
    const first = randomSprayDabs({ x: 10, y: -5 }, 50, 6, 200, createSeededRandom(42));
    const second = randomSprayDabs({ x: 10, y: -5 }, 50, 6, 200, createSeededRandom(42));
    expect(first).toEqual(second);
    for (const point of first) expect(Math.hypot(point.x - 10, point.y + 5)).toBeLessThanOrEqual(22 + 1e-9);
  });

  it("scales spray density by brush area and pen pressure with a bounded maximum rate", () => {
    expect(sprayRate(60, 24, 0.5)).toBe(240);
    expect(sprayRate(60, 24, 1)).toBe(480);
    expect(sprayRate(60, 24, 0)).toBe(0);
    expect(sprayRate(60, 48, 0.5)).toBe(960);
    expect(sprayRate(200, 400, 1)).toBe(3000);
  });
});
