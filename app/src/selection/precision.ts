import type { Point } from "../board/cameraMath";

export const ALT_PRECISION_DIVISOR = 5;

export interface PrecisionDeltaTracker {
  pointer: Point;
  delta: Point;
  alt: boolean;
}

export interface PrecisionDeltaUpdate {
  tracker: PrecisionDeltaTracker;
  delta: Point;
}

export function createPrecisionDeltaTracker(pointer: Point, alt = false): PrecisionDeltaTracker {
  return { pointer: { ...pointer }, delta: { x: 0, y: 0 }, alt };
}

/** Switches sensitivity at the last pointer position while preserving accumulated travel. */
export function setPrecisionAlt(tracker: PrecisionDeltaTracker, alt: boolean): PrecisionDeltaTracker {
  return tracker.alt === alt ? tracker : { ...tracker, alt };
}

/** Accumulates raw pointer segments at 1x or 0.2x sensitivity without mode-change jumps. */
export function updatePrecisionDelta(
  tracker: PrecisionDeltaTracker,
  pointer: Point,
  alt = tracker.alt,
): PrecisionDeltaUpdate {
  const current = setPrecisionAlt(tracker, alt);
  const strength = current.alt ? 1 / ALT_PRECISION_DIVISOR : 1;
  const delta = {
    x: current.delta.x + (pointer.x - current.pointer.x) * strength,
    y: current.delta.y + (pointer.y - current.pointer.y) * strength,
  };

  return {
    tracker: { pointer: { ...pointer }, delta, alt: current.alt },
    delta,
  };
}
