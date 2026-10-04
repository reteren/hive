export interface SelectionOutlineMetrics {
  underlayStrokeWidth: number;
  dashStrokeWidth: number;
  dashLength: number;
  dashGap: number;
  dashOffset: number;
}

/** Outline values in the transformed selection layer's units for a fixed screen-space result. */
export function selectionOutlineMetrics(zoom: number): SelectionOutlineMetrics {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    underlayStrokeWidth: 2 / scale,
    dashStrokeWidth: 1.25 / scale,
    dashLength: 4 / scale,
    dashGap: 3 / scale,
    dashOffset: -7 / scale,
  };
}
