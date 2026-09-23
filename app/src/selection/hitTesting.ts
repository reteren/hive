import type { Note } from "../model/note";
import { noteBounds, type Bounds } from "../notes/layout.svelte";
import type { Point } from "../board/cameraMath";

/** A rectangle with board-space coordinates and non-negative dimensions. */
export function rectFromPoints(first: Point, second: Point): Bounds {
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  };
}

/** Edges count as touching, matching the board's marquee-selection rule. */
export function boundsTouch(first: Bounds, second: Bounds): boolean {
  return (
    first.x <= second.x + second.width &&
    first.x + first.width >= second.x &&
    first.y <= second.y + second.height &&
    first.y + first.height >= second.y
  );
}

export function pointInBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

/** Notes under a point in top-to-bottom paint order. */
export function hitTestNotes(
  point: Point,
  notes: Readonly<Record<string, Note>>,
  paintOrder: readonly string[],
  getBounds: (note: Note) => Bounds = noteBounds,
): string[] {
  const hits: string[] = [];
  for (let index = paintOrder.length - 1; index >= 0; index -= 1) {
    const id = paintOrder[index];
    const note = notes[id];
    if (note && pointInBounds(point, getBounds(note))) hits.push(id);
  }
  return hits;
}

/** Notes that touch or intersect a marquee, returned in paint order. */
export function notesTouchingMarquee(
  marquee: Bounds,
  notes: Readonly<Record<string, Note>>,
  paintOrder: readonly string[],
  getBounds: (note: Note) => Bounds = noteBounds,
): string[] {
  return paintOrder.filter((id) => {
    const note = notes[id];
    return note !== undefined && boundsTouch(marquee, getBounds(note));
  });
}
