import type { Point } from "../board/cameraMath";
import { snapToGrid } from "../board/gridMath";
import type { Bounds } from "../notes/layout.svelte";
import { resizeNote, resizeEdgeAxes, type ResizeEdge } from "./resize";
import { MAX_NOTE_SCALE, normalizeNoteScale, type NoteKind } from "../model/note";

export const GESTURE_THRESHOLD_PX = 4;

export type SelectionGestureKind =
  | "move"
  | "body-move"
  | "resize"
  | "group-scale"
  | "zone-move"
  | "zone-resize"
  | "marquee";

/** A line tool takes pointer ownership away from active resize gestures. */
export function shouldCancelForLineTool(kind: SelectionGestureKind, lineToolActive: boolean): boolean {
  return lineToolActive && (kind === "resize" || kind === "group-scale" || kind === "zone-resize");
}

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
  /** Metadata used by bounded resize gestures; omitted by movement-only callers. */
  type?: NoteKind;
  /** The note's visual scale; frame dimensions are measured after this transform. */
  scale?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  statisticsExtensionWidth?: number;
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
  uniformScale = false,
): ResizeGesture {
  if (uniformScale) {
    return { ...gesture, after: scaleResizeFrame(gesture, cursorWorld, snap, step) };
  }
  const afterGeometry = resizeNote(
    gesture.before,
    gesture.visualHeight,
    gesture.edge,
    { x: cursorWorld.x - gesture.startWorld.x, y: cursorWorld.y - gesture.startWorld.y },
    snap,
    step,
    gesture.standaloneModule,
    { maxWidth: gesture.before.maxWidth, maxHeight: gesture.before.maxHeight },
  );
  return { ...gesture, after: { ...gesture.before, ...afterGeometry } };
}

/** Shift-resize changes the per-note transform, including for nodes with locked dimensions. */
function scaleResizeFrame(gesture: ResizeGesture, cursorWorld: Point, snap: boolean, step: number): NoteFrame {
  const frame = gesture.before;
  const axes = resizeEdgeAxes(gesture.edge);
  const width = Math.max(0.001, frame.width);
  const height = Math.max(0.001, gesture.visualHeight);
  const dx = cursorWorld.x - gesture.startWorld.x;
  const dy = cursorWorld.y - gesture.startWorld.y;
  let scaleX = 1;
  let scaleY = 1;

  if (axes.horizontal === "right") {
    const right = frame.x + width + dx;
    scaleX = (maybeSnapX(right, snap, step) - frame.x) / width;
  } else if (axes.horizontal === "left") {
    const left = maybeSnapX(frame.x + dx, snap, step);
    scaleX = (frame.x + width - left) / width;
  }
  if (axes.vertical === "bottom") {
    const bottom = frame.y + height + dy;
    scaleY = (maybeSnapY(bottom, snap, step) - frame.y) / height;
  } else if (axes.vertical === "top") {
    const top = maybeSnapY(frame.y + dy, snap, step);
    scaleY = (frame.y + height - top) / height;
  }

  const corner = axes.horizontal !== null && axes.vertical !== null;
  const factor = corner
    ? Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY
    : axes.horizontal !== null ? scaleX : scaleY;
  const currentScale = normalizeNoteScale(frame.scale);
  const nextScale = Math.min(MAX_NOTE_SCALE, Math.max(1, currentScale * factor));
  const ratio = nextScale / currentScale;
  const nextWidth = width * ratio;
  const nextHeight = height * ratio;

  return {
    ...frame,
    x: axes.horizontal === "left"
      ? frame.x + width - nextWidth
      : axes.horizontal === null ? frame.x - (nextWidth - width) / 2 : frame.x,
    y: axes.vertical === "top"
      ? frame.y + height - nextHeight
      : axes.vertical === null ? frame.y - (nextHeight - height) / 2 : frame.y,
    width: nextWidth,
    height: frame.height === null ? null : nextHeight,
    scale: nextScale > 1 ? nextScale : undefined,
  };
}

function maybeSnapX(value: number, snap: boolean, step: number): number {
  return snap ? snapToGrid({ x: value, y: 0 }, step).x : value;
}

function maybeSnapY(value: number, snap: boolean, step: number): number {
  return snap ? snapToGrid({ x: 0, y: value }, step).y : value;
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
    first.height === second.height &&
    normalizeNoteScale(first.scale) === normalizeNoteScale(second.scale)
  );
}

function copyFrame(frame: NoteFrame): NoteFrame {
  return { ...frame };
}
