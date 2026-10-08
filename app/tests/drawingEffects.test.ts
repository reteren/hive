import { describe, expect, it } from "vitest";
import {
  clampEffectBounds,
  effectBounds,
  effectRadiusAtLevel,
  effectSourcePadding,
  effectWorldRadius,
} from "../src/drawing/effects/effectMath";
import {
  DEFAULT_EFFECT_SETTINGS,
  normalizeEffectMode,
  normalizeEffectSettings,
  normalizeEffectStrength,
} from "../src/drawing/effects/effectSettings.svelte";

describe("drawing effects", () => {
  it("keeps effect brush width in screen pixels across raster levels", () => {
    expect(effectWorldRadius(20, 1)).toBe(1);
    expect(effectRadiusAtLevel(20, 1, 0)).toBe(20);
    expect(effectRadiusAtLevel(20, 0.05, 6)).toBeCloseTo(6.25);
  });

  it("expands a swept brush into finite raster bounds", () => {
    expect(effectBounds({ x: 4.2, y: 5.8 }, { x: 10, y: 2 }, 3)).toEqual({
      left: 1,
      top: -1,
      right: 13,
      bottom: 9,
    });
    expect(clampEffectBounds({ left: -5, top: 3, right: 12, bottom: 520 }, 512)).toEqual({
      left: 0,
      top: 3,
      right: 12,
      bottom: 512,
    });
    expect(clampEffectBounds({ left: -5, top: 0, right: 0, bottom: 10 }, 512)).toBeNull();
  });

  it("allocates a sample margin for blur, smudge, and progressive swirl", () => {
    expect(effectSourcePadding("blur", 100)).toBe(26);
    expect(effectSourcePadding("smudge", 100)).toBe(52);
    expect(effectSourcePadding("swirl", 100, 0.1)).toBe(13);
  });

  it("normalizes effect controls", () => {
    expect(normalizeEffectMode("swirl")).toBe("swirl");
    expect(normalizeEffectMode("unsupported")).toBe("blur");
    expect(normalizeEffectStrength(1.4, 0.5)).toBe(1);
    expect(normalizeEffectStrength(-0.3, 0.5)).toBe(0);
    expect(normalizeEffectStrength(Number.NaN, 0.5)).toBe(0.5);
    expect(DEFAULT_EFFECT_SETTINGS.swirlSpeed).toBe(2.4);
    expect(normalizeEffectSettings({ swirlSpeed: 12 }).swirlSpeed).toBe(8);
    expect(normalizeEffectSettings({ swirlSpeed: 0 }).swirlSpeed).toBe(0.1);
    expect(normalizeEffectSettings({ swirlSpeed: Number.NaN }).swirlSpeed).toBe(2.4);
  });
});
