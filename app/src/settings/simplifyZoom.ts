/**
 * Settings → General → Simplify notes when zoomed out: the zoom, in percent, below which notes are
 * drawn as plain shells instead of their full body. 0 is Off (notes always drawn in full).
 */
export const DEFAULT_SIMPLIFY_ZOOM_PERCENT = 20;
export const MAX_SIMPLIFY_ZOOM_PERCENT = 50;

/** Invalid saved values use the fallback; values are whole percents from 0 (Off) to the maximum. */
export function normalizeSimplifyZoomPercent(value: unknown, fallback = DEFAULT_SIMPLIFY_ZOOM_PERCENT): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_SIMPLIFY_ZOOM_PERCENT
    ? value
    : fallback;
}
