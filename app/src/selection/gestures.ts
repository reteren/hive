import type { Point } from "../board/cameraMath";
import { snapToGrid } from "../board/gridMath";
import type { Bounds } from "../notes/layout.svelte";
import { resizeNote, type ResizeEdge } from "./resize";

export const GESTURE_THRESHOLD_PX = 4;

export function crossedGestureThreshold(start: Point, current: Point): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= GESTURE_THRESHOLD_PX;
}

export interface NoteFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  /** null means the note is currently using auto-height. */
  height: number | null;
}

export interface MoveGesture {
  before: NoteFrame[];
  after: NoteFrame[];
  anchorId: string;
  startWorld: Point;
}

export interface GeometryChange {
  before: NoteFrame[];
  after: NoteFrame[];
}

export function createMoveGesture(frames: readonly NoteFrame[], anchorId: string, startWorld: Point): MoveGesture {
  const before = frames.map(copyFrame);
  return { before, after: before.map(copyFrame), anchorId, startWorld: { ...startWorld } };
}

/** Translate a group, snapping the dragged note's top-left corner when enabled. */
export function updateMoveGesture(
  gesture: MoveGesture,
  cursorWorld: Point,
  snap: boolean,
  step: number,
): MoveGesture {
  const anchor = gesture.before.find((frame) => frame.id === gesture.anchorId) ?? gesture.before[0];
  if (!anchor) return { ...gesture, after: [] };

  let deltaX = cursorWorld.x - gesture.startWorld.x;
  let deltaY = cursorWorld.y - gesture.startWorld.y;
  if (snap) {
    const snapped = snapToGrid({ x: anchor.x + deltaX, y: anchor.y + deltaY }, step);
    deltaX = snapped.x - anchor.x;
    deltaY = snapped.y - anchor.y;
  }

  return {
    ...gesture,
    after: gesture.before.map((frame) => ({ ...frame, x: frame.x + deltaX, y: frame.y + deltaY })),
  };
}

export interface ResizeGesture {
  before: NoteFrame;
  after: NoteFrame;
  edge: ResizeEdge;
  startWorld: Point;
  visualHeight: number;
  standaloneModule: boolean;
}

export function createResizeGesture(
  frame: NoteFrame,
  visualHeight: number,
  edge: ResizeEdge,
  startWorld: Point,
  standaloneModule = false,
): ResizeGesture {
  const before = copyFrame(frame);
  return { before, after: copyFrame(frame), edge, startWorld: { ...startWorld }, visualHeight, standaloneModule };
}

export function updateResizeGesture(
  gesture: ResizeGesture,
  cursorWorld: Point,
  snap: boolean,
  step: number,
): ResizeGesture {
  const afterGeometry = resizeNote(
    gesture.before,
    gesture.visualHeight,
    gesture.edge,
    { x: cursorWorld.x - gesture.startWorld.x, y: cursorWorld.y - gesture.startWorld.y },
    snap,
    step,
    gesture.standaloneModule,
  );
  return { ...gesture, after: { ...gesture.before, ...afterGeometry } };
}

export function cancelMoveGesture(gesture: MoveGesture): NoteFrame[] {
  return gesture.before.map(copyFrame);
}

export function cancelResizeGesture(gesture: ResizeGesture): NoteFrame {
  return copyFrame(gesture.before);
}

export function moveGestureChange(gesture: MoveGesture, cancelled = false): GeometryChange | null {
  return cancelled ? null : createChange(gesture.before, gesture.after);
}

export function resizeGestureChange(gesture: ResizeGesture, cancelled = false): GeometryChange | null {
  return cancelled ? null : createChange([gesture.before], [gesture.after]);
}

export function boundsAsFrame(id: string, bounds: Bounds, height: number | null): NoteFrame {
  return { id, x: bounds.x, y: bounds.y, width: bounds.width, height };
}

export function framesEqual(first: readonly NoteFrame[], second: readonly NoteFrame[]): boolean {
  if (first.length !== second.length) return false;
  return first.every((frame, index) => sameFrame(frame, second[index]));
}

function createChange(before: readonly NoteFrame[], after: readonly NoteFrame[]): GeometryChange | null {
  if (framesEqual(before, after)) return null;
  return { before: before.map(copyFrame), after: after.map(copyFrame) };
}

function sameFrame(first: NoteFrame, second: NoteFrame): boolean {
  return (
    first.id === second.id &&
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

function copyFrame(frame: NoteFrame): NoteFrame {
  return { ...frame };
}
