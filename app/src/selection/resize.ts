import type { Point } from "../board/cameraMath";
import { snapToGrid } from "../board/gridMath";
import { MIN_NOTE_HEIGHT } from "../notes/layout.svelte";
import type { NoteFrame } from "./gestures";

export const MIN_NOTE_WIDTH = 12;

export type ResizeEdge = "right" | "bottom" | "corner";

export interface ResizedGeometry {
  width: number;
  height: number | null;
}

/** Resize from the right and/or bottom edge, snapping the dragged edge itself. */
export function resizeNote(
  initial: NoteFrame,
  visualHeight: number,
  edge: ResizeEdge,
  delta: Point,
  snap: boolean,
  step: number,
): ResizedGeometry {
  let width = initial.width;
  let height = initial.height;

  if (edge === "right" || edge === "corner") {
    let right = initial.x + initial.width + delta.x;
    if (snap) right = snapToGrid({ x: right, y: 0 }, step).x;
    width = Math.max(MIN_NOTE_WIDTH, right - initial.x);
  }

  if (edge === "bottom" || edge === "corner") {
    let bottom = initial.y + visualHeight + delta.y;
    if (snap) bottom = snapToGrid({ x: 0, y: bottom }, step).y;
    height = Math.max(MIN_NOTE_HEIGHT, bottom - initial.y);
  }

  return { width, height };
}
