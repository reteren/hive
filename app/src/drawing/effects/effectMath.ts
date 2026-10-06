import { levelPxPerUnit } from "../types";

export interface EffectPoint {
  x: number;
  y: number;
}

export interface EffectBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function effectWorldRadius(size: number, zoom: number): number {
  const safeSize = Number.isFinite(size) ? Math.max(1, Math.min(400, size)) : 10;
  const safeZoom = Number.isFinite(zoom) ? Math.max(0.05, Math.min(4, zoom)) : 1;
  return safeSize / (20 * safeZoom);
}

/** Convert the screen-space brush diameter to a raster radius at a drawing pyramid level. */
export function effectRadiusAtLevel(size: number, zoom: number, level: number): number {
  return Math.max(0.5, effectWorldRadius(size, zoom) * levelPxPerUnit(level));
}

/** Bounds touched by a round brush moving from `from` to `to`, in raster pixels. */
export function effectBounds(from: EffectPoint, to: EffectPoint, radius: number, padding = 0): EffectBounds {
  const reach = Math.max(0, radius) + Math.max(0, padding);
  return {
    left: Math.floor(Math.min(from.x, to.x) - reach),
    top: Math.floor(Math.min(from.y, to.y) - reach),
    right: Math.ceil(Math.max(from.x, to.x) + reach),
    bottom: Math.ceil(Math.max(from.y, to.y) + reach),
  };
}

/** Texture neighborhood needed by each effect pass so filtering can sample across tile edges. */
export function effectSourcePadding(mode: "blur" | "smudge" | "swirl", radius: number, swirlAngle = 0): number {
  const sampleReach = mode === "blur" ? radius * 0.24
    : mode === "smudge" ? radius * 0.5
      : radius * Math.min(2, Math.abs(swirlAngle)) + 1;
  return Math.min(1024, Math.max(2, Math.ceil(sampleReach) + 2));
}

export function clampEffectBounds(bounds: EffectBounds, size: number): EffectBounds | null {
  const left = Math.max(0, Math.min(size, bounds.left));
  const top = Math.max(0, Math.min(size, bounds.top));
  const right = Math.max(0, Math.min(size, bounds.right));
  const bottom = Math.max(0, Math.min(size, bounds.bottom));
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}
