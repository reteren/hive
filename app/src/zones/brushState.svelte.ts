import { BRUSH_MAX, BRUSH_MIN, BRUSH_STEP, normalizeBrushSize } from "./brush";

/**
 * Zone brush UI state (contract). `size` is always a normalized value (multiple of 20, 20..300);
 * change it only through the panel/commands worker's setter so the value stays normalized and
 * persisted in view settings.
 */
export const brushState = $state({
  size: BRUSH_MIN * 3,
});

export function setBrushSize(size: number): void {
  brushState.size = normalizeBrushSize(Number.isFinite(size) ? size : BRUSH_MIN);
}

export function stepBrushSize(direction: 1 | -1): void {
  setBrushSize(Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, brushState.size + direction * BRUSH_STEP)));
}
