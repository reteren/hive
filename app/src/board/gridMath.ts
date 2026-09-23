import type { Point } from "./cameraMath";
import { PX_PER_UNIT } from "./cameraMath";

/** Presets are expressed in board units (u); a custom positive step is also allowed. */
export const GRID_STEP_PRESETS = Object.freeze([1, 2, 5, 10, 20, 50, 100] as const);
export const GRID_MAJOR_EVERY = 5;
export const MIN_GRID_SPACING_PX = 8;

export function isValidGridStep(step: number): boolean {
  return Number.isFinite(step) && step > 0;
}

/** Return the integer multiple used to keep the drawn grid legible at low zoom. */
export function gridLineStride(step: number, zoom: number): number {
  if (!isValidGridStep(step) || !Number.isFinite(zoom) || zoom <= 0) return 1;

  const pixelsPerStep = step * PX_PER_UNIT * zoom;
  if (!Number.isFinite(pixelsPerStep)) return 1;
  if (pixelsPerStep <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.ceil(MIN_GRID_SPACING_PX / pixelsPerStep));
}

/** Round each coordinate to its nearest grid multiple without changing the input point. */
export function snapToGrid(point: Point, step: number): Point {
  if (!isValidGridStep(step)) {
    throw new RangeError("Grid step must be a positive finite number.");
  }

  return {
    x: Math.round(point.x / step) * step,
    y: Math.round(point.y / step) * step,
  };
}
