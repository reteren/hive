export function clampSliderValue(value: number, max: number): number {
  const upper = Number.isFinite(max) ? Math.max(0, max) : 0;
  return Number.isFinite(value) ? Math.min(upper, Math.max(0, value)) : 0;
}

export function sliderPercent(value: number, max: number): number {
  const upper = Number.isFinite(max) ? Math.max(0, max) : 0;
  return upper === 0 ? 0 : clampSliderValue(value, upper) / upper * 100;
}

export function sliderValueAtPercent(percent: number, max: number): number {
  const upper = Number.isFinite(max) ? Math.max(0, max) : 0;
  const boundedPercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  return upper * boundedPercent / 100;
}

export interface SliderBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type SliderOrientation = "horizontal" | "vertical";

/** Map a pointer position to a low-to-high slider ratio for either orientation. */
export function sliderRatioAtPoint(
  bounds: SliderBounds,
  clientX: number,
  clientY: number,
  orientation: SliderOrientation,
): number {
  const extent = orientation === "vertical" ? bounds.bottom - bounds.top : bounds.right - bounds.left;
  if (extent <= 0) return 0;
  const ratio = orientation === "vertical"
    ? (bounds.bottom - clientY) / extent
    : (clientX - bounds.left) / extent;
  return Math.min(1, Math.max(0, ratio));
}

/** Apply the expected arrow key direction for a slider without relying on OS key repeat quirks. */
export function sliderValueAfterArrow(
  value: number,
  max: number,
  step: number | "any",
  key: string,
  orientation: SliderOrientation,
): number | null {
  const upper = Number.isFinite(max) ? Math.max(0, max) : 0;
  const direction = orientation === "vertical"
    ? key === "ArrowUp" ? 1 : key === "ArrowDown" ? -1 : 0
    : key === "ArrowRight" || key === "ArrowUp" ? 1 : key === "ArrowLeft" || key === "ArrowDown" ? -1 : 0;
  if (!direction || upper === 0) return null;
  const increment = typeof step === "number" && Number.isFinite(step) && step > 0 ? step : Math.max(upper / 100, Number.EPSILON);
  return clampSliderValue(clampSliderValue(value, upper) + direction * increment, upper);
}
