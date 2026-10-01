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
