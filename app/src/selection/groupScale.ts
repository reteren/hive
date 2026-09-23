import type { Point } from "../board/cameraMath";
import { snapToGrid } from "../board/gridMath";
import type { Bounds } from "../notes/layout.svelte";
import { MIN_NOTE_HEIGHT } from "../notes/layout.svelte";
import { MIN_NOTE_WIDTH, type ResizeEdge } from "./resize";
import type { GeometryChange, NoteFrame } from "./gestures";

export interface GroupScaleGesture {
  before: NoteFrame[];
  after: NoteFrame[];
  bounds: Bounds;
  edge: ResizeEdge;
  startWorld: Point;
}

/** Union of rendered note bounds, including measured heights for auto-height notes. */
export function unionBounds(bounds: readonly Bounds[]): Bounds | null {
  if (bounds.length === 0) return null;

  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function createGroupScaleGesture(
  frames: readonly NoteFrame[],
  bounds: Bounds,
  edge: ResizeEdge,
  startWorld: Point,
): GroupScaleGesture {
  const before = frames.map(copyFrame);
  return {
    before,
    after: before.map(copyFrame),
    bounds: { ...bounds },
    edge,
    startWorld: { ...startWorld },
  };
}

export function updateGroupScaleGesture(
  gesture: GroupScaleGesture,
  cursorWorld: Point,
  snap: boolean,
  step: number,
  preserveAspect = false,
): GroupScaleGesture {
  const after = scaleGroupFrames(
    gesture.before,
    gesture.bounds,
    gesture.edge,
    { x: cursorWorld.x - gesture.startWorld.x, y: cursorWorld.y - gesture.startWorld.y },
    snap,
    step,
    preserveAspect,
  );
  return { ...gesture, after };
}

/**
 * Scale note positions and dimensions around the group's top-left corner.
 * Auto-height notes scale their position only; width and height=null stay unchanged.
 */
export function scaleGroupFrames(
  frames: readonly NoteFrame[],
  bounds: Bounds,
  edge: ResizeEdge,
  delta: Point,
  snap: boolean,
  step: number,
  preserveAspect = false,
): NoteFrame[] {
  if (frames.length === 0) return [];

  const scales = edgeScales(bounds, edge, delta, snap, step);
  let scaleX = clampScale(scales.x, minimumWidthScale(frames));
  let scaleY = clampScale(scales.y, minimumHeightScale(frames));

  if (edge === "corner" && preserveAspect) {
    // Use the axis moved farther as a fraction of its original group dimension.
    // That edge drives the uniform scale; the other edge follows its aspect ratio.
    const xDominates = Math.abs(delta.x / bounds.width) >= Math.abs(delta.y / bounds.height);
    const uniformMinimum = Math.max(minimumWidthScale(frames), minimumHeightScale(frames));
    const uniform = clampScale(xDominates ? scales.x : scales.y, uniformMinimum);
    scaleX = uniform;
    scaleY = uniform;
  }

  return frames.map((frame) => ({
    ...frame,
    x: bounds.x + (frame.x - bounds.x) * scaleX,
    y: bounds.y + (frame.y - bounds.y) * scaleY,
    width: frame.width * scaleX,
    height: frame.height === null ? null : frame.height * scaleY,
  }));
}

export function cancelGroupScaleGesture(gesture: GroupScaleGesture): NoteFrame[] {
  return gesture.before.map(copyFrame);
}

export function groupScaleGestureChange(gesture: GroupScaleGesture, cancelled = false): GeometryChange | null {
  if (cancelled || framesEqual(gesture.before, gesture.after)) return null;
  return { before: gesture.before.map(copyFrame), after: gesture.after.map(copyFrame) };
}

function edgeScales(
  bounds: Bounds,
  edge: ResizeEdge,
  delta: Point,
  snap: boolean,
  step: number,
): { x: number; y: number } {
  const rawRight = bounds.x + bounds.width + delta.x;
  const rawBottom = bounds.y + bounds.height + delta.y;
  const right = snap && (edge === "right" || edge === "corner")
    ? snapToGrid({ x: rawRight, y: 0 }, step).x
    : rawRight;
  const bottom = snap && (edge === "bottom" || edge === "corner")
    ? snapToGrid({ x: 0, y: rawBottom }, step).y
    : rawBottom;

  return {
    x: edge === "right" || edge === "corner" ? (right - bounds.x) / bounds.width : 1,
    y: edge === "bottom" || edge === "corner" ? (bottom - bounds.y) / bounds.height : 1,
  };
}

function minimumWidthScale(frames: readonly NoteFrame[]): number {
  return Math.max(0, ...frames.flatMap((frame) => frame.height === null ? [] : [MIN_NOTE_WIDTH / frame.width]));
}

function minimumHeightScale(frames: readonly NoteFrame[]): number {
  const manualHeights = frames.flatMap((frame) => frame.height === null ? [] : [MIN_NOTE_HEIGHT / frame.height]);
  return Math.max(0, ...manualHeights);
}

function clampScale(scale: number, minimum: number): number {
  return Math.max(minimum, Math.max(0, scale));
}

function framesEqual(first: readonly NoteFrame[], second: readonly NoteFrame[]): boolean {
  return first.length === second.length && first.every((frame, index) => {
    const other = second[index];
    return (
      frame.id === other.id &&
      frame.x === other.x &&
      frame.y === other.y &&
      frame.width === other.width &&
      frame.height === other.height
    );
  });
}

function copyFrame(frame: NoteFrame): NoteFrame {
  return { ...frame };
}
