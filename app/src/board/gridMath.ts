import type { Point } from "./cameraMath";
import { PX_PER_UNIT } from "./cameraMath";

/** Presets are expressed in board units (u); a custom positive step is also allowed. */
export const GRID_STEP_PRESETS = Object.freeze([1, 2, 5, 10, 20, 50, 100] as const);
export const GRID_MAJOR_EVERY = 5;
export const MIN_GRID_SPACING_PX = 8;
export const AUTO_GRID_MIN_SPACING_PX = 20;
export const AUTO_GRID_MAX_SPACING_PX = 80;

export function isValidGridStep(step: number): boolean {
  return Number.isFinite(step) && step > 0;
}

/** Pick a power-of-two multiple that keeps the displayed grid close to 40 screen pixels. */
export function autoGridStep(baseStep: number, zoom: number): number {
  if (!isValidGridStep(baseStep) || !Number.isFinite(zoom) || zoom <= 0) return baseStep;

  const pixelsPerBaseStep = baseStep * PX_PER_UNIT * zoom;
  if (!Number.isFinite(pixelsPerBaseStep) || pixelsPerBaseStep <= 0) return baseStep;

  const targetSpacing = Math.sqrt(AUTO_GRID_MIN_SPACING_PX * AUTO_GRID_MAX_SPACING_PX);
  const exponent = Math.max(-40, Math.min(40, Math.round(Math.log2(targetSpacing / pixelsPerBaseStep))));
  const step = baseStep * 2 ** exponent;
  return isValidGridStep(step) ? Number(step.toPrecision(12)) : baseStep;
}

export function formatGridStep(step: number): string {
  return isValidGridStep(step) ? Number(step.toPrecision(4)).toString() : String(step);
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
