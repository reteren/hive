import type { ShownMessage } from "../time/types";

export interface OverhiveCard extends ShownMessage { title: string; available: boolean }
export interface OverhiveSnapshot { cards: OverhiveCard[]; reduceMotion: boolean; revision?: number }
export interface CardRect { x: number; y: number; width: number; height: number }

/** Bound native hit regions to the viewport; zero-sized animation frames must stay click-through. */
export function clippedCardRects(rects: readonly CardRect[], width: number, height: number): CardRect[] {
  return rects.flatMap((rect) => {
    if (![rect.x, rect.y, rect.width, rect.height, width, height].every(Number.isFinite)) return [];
    const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
    const right = Math.min(width, rect.x + rect.width), bottom = Math.min(height, rect.y + rect.height);
    return right > x && bottom > y ? [{ x, y, width: right - x, height: bottom - y }] : [];
  });
}
