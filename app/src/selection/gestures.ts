import type { Point } from "../board/cameraMath";
import { snapToGrid } from "../board/gridMath";
import type { Bounds } from "../notes/layout.svelte";
import type { HistoryCommand } from "../history/historyStack";
import { hasResizeHandle, resizeNote, resizeEdgeAxes, type ResizeEdge } from "./resize";
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
  /** Unscaled model dimensions captured before the gesture, used to avoid scale round-trip drift. */
  baseWidth?: number;
  baseHeight?: number | null;
  baseStatisticsExtensionWidth?: number;
  /** Marks a visual resize that changes only the per-node scale. */
  scaleGesture?: boolean;
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

export interface ScaleModeGesture {
  before: NoteFrame[];
  after: NoteFrame[];
  pivot: Point;
  startDistance: number;
  factor: number;
}

export type ScaleModeExitAction = "cancel" | "confirm" | "ignore";

export function scaleModeKeyAction(
  code: string,
  modifiers: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean },
): ScaleModeExitAction {
  if (code === "Escape" || (code === "KeyZ" && modifiers.ctrlKey && !modifiers.shiftKey && !modifiers.altKey && !modifiers.metaKey)) {
    return "cancel";
  }
  if (code === "Enter") return "confirm";
  if (["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(code)) {
    return "ignore";
  }
  return "confirm";
}

export function scaleModePointerAction(button: number): "cancel" | "confirm" {
  return button === 2 ? "cancel" : "confirm";
}

/** Whether a node outline should expose a resize or Shift-scale handle. */
export function shouldShowResizeHandle(
  kind: NoteKind | undefined,
  edge: ResizeEdge,
  canShrink: boolean,
  shiftHeld: boolean,
): boolean {
  return shiftHeld || hasResizeHandle(kind, edge, canShrink);
}

/** Begin a radial scale around the selection bounds' center. */
export function createScaleModeGesture(
  frames: readonly NoteFrame[],
  pivot: Point,
  startWorld: Point,
  minimumStartDistance = 0.001,
): ScaleModeGesture {
  const before = frames.map(copyFrame);
  const minimum = Number.isFinite(minimumStartDistance) && minimumStartDistance > 0
    ? minimumStartDistance
    : 0.001;
  const distance = Math.hypot(startWorld.x - pivot.x, startWorld.y - pivot.y);
  const startDistance = Math.max(distance, minimum);
  return {
    before,
    after: before.map(copyFrame),
    pivot: { ...pivot },
    startDistance,
    factor: 1,
  };
}

/** Scale note transforms from the original pointer distance, avoiding frame-to-frame drift. */
export function updateScaleModeGesture(gesture: ScaleModeGesture, cursorWorld: Point): ScaleModeGesture {
  const distance = Math.hypot(cursorWorld.x - gesture.pivot.x, cursorWorld.y - gesture.pivot.y);
  const factor = Number.isFinite(distance) ? distance / gesture.startDistance : gesture.factor;
  return {
    ...gesture,
    factor,
    after: scaleModeFrames(gesture.before, gesture.pivot, factor),
  };
}

/** Quantize scale once when radial scaling is confirmed, preserving exact base dimensions. */
export function normalizeScaleModeAtCommit(gesture: ScaleModeGesture): NoteFrame[] {
  const factor = Math.round(gesture.factor * 1000) / 1000;
  return gesture.before.map((before) => {
    const initialScale = normalizeNoteScale(before.scale);
    const unroundedScale = Math.min(MAX_NOTE_SCALE, Math.max(1, initialScale * factor));
    const roundedScale = Math.round(unroundedScale * 1000) / 1000;
    const scale = roundedScale < 1.001 ? 1 : Math.min(MAX_NOTE_SCALE, roundedScale);
    const extension = before.baseStatisticsExtensionWidth ??
      (before.statisticsExtensionWidth ?? 0) / initialScale;
    const baseWidth = before.baseWidth ??
      (before.width - (before.statisticsExtensionWidth ?? 0)) / initialScale;
    const baseHeight = before.baseHeight !== undefined
      ? before.baseHeight
      : before.height === null ? null : before.height / initialScale;
    const afterX = gesture.pivot.x + (before.x - gesture.pivot.x) * factor;
    const afterY = gesture.pivot.y + (before.y - gesture.pivot.y) * factor;

    return {
      ...before,
      x: afterX,
      y: afterY,
      width: (baseWidth + extension) * scale,
      height: baseHeight === null ? null : baseHeight * scale,
      scale: scale > 1 ? scale : undefined,
      baseWidth,
      baseHeight,
      baseStatisticsExtensionWidth: extension,
      statisticsExtensionWidth: extension * scale,
      scaleGesture: true,
    };
  });
}

export function cancelScaleModeGesture(gesture: ScaleModeGesture): NoteFrame[] {
  return gesture.before.map(copyFrame);
}

export function scaleModeGestureChange(gesture: ScaleModeGesture): GeometryChange | null {
  return createChange(gesture.before, gesture.after);
}

/** Build the reversible command used by confirmed selection moves and scales. */
export function geometryHistoryCommand(
  label: string,
  target: string,
  before: readonly NoteFrame[],
  after: readonly NoteFrame[],
  apply: (frames: readonly NoteFrame[]) => void,
): HistoryCommand {
  const beforeCopy = before.map(copyFrame);
  const afterCopy = after.map(copyFrame);
  return {
    label,
    target,
    do: () => apply(afterCopy.map(copyFrame)),
    undo: () => apply(beforeCopy.map(copyFrame)),
  };
}

function scaleModeFrames(frames: readonly NoteFrame[], pivot: Point, factor: number): NoteFrame[] {
  return frames.map((frame) => {
    const initialScale = normalizeNoteScale(frame.scale);
    const scale = Math.min(MAX_NOTE_SCALE, Math.max(1, initialScale * factor));
    const ratio = scale / initialScale;
    return {
      ...frame,
      x: pivot.x + (frame.x - pivot.x) * factor,
      y: pivot.y + (frame.y - pivot.y) * factor,
      width: frame.width * ratio,
      height: frame.height === null ? null : frame.height * ratio,
      scale,
      ...(frame.statisticsExtensionWidth === undefined
        ? {}
        : { statisticsExtensionWidth: frame.statisticsExtensionWidth * ratio }),
      scaleGesture: true,
    };
  });
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

/** Quantize per-node scale once on pointer-up while retaining exact model dimensions. */
export function normalizeScaleResizeAtCommit(gesture: ResizeGesture): NoteFrame {
  const frame = gesture.after;
  if (!frame.scaleGesture) return copyFrame(frame);

  const initialScale = normalizeNoteScale(gesture.before.scale);
  const roundedScale = Math.round(normalizeNoteScale(frame.scale) * 1000) / 1000;
  const scale = roundedScale < 1.001 ? 1 : Math.min(MAX_NOTE_SCALE, roundedScale);
  const extension = gesture.before.baseStatisticsExtensionWidth ??
    (gesture.before.statisticsExtensionWidth ?? 0) / initialScale;
  const baseWidth = gesture.before.baseWidth ??
    (gesture.before.width - (gesture.before.statisticsExtensionWidth ?? 0)) / initialScale;
  const baseHeight = gesture.before.baseHeight !== undefined
    ? gesture.before.baseHeight
    : gesture.before.height === null ? null : gesture.before.height / initialScale;
  const width = (baseWidth + extension) * scale;
  const visualHeight = baseHeight === null
    ? gesture.visualHeight / initialScale * scale
    : baseHeight * scale;
  const height = baseHeight === null ? null : baseHeight * scale;
  const axes = resizeEdgeAxes(gesture.edge);

  return {
    ...frame,
    x: axes.horizontal === "left"
      ? gesture.before.x + gesture.before.width - width
      : axes.horizontal === null ? gesture.before.x - (width - gesture.before.width) / 2 : gesture.before.x,
    y: axes.vertical === "top"
      ? gesture.before.y + gesture.visualHeight - visualHeight
      : axes.vertical === null ? gesture.before.y - (visualHeight - gesture.visualHeight) / 2 : gesture.before.y,
    width,
    height,
    scale: scale > 1 ? scale : undefined,
    baseWidth,
    baseHeight,
    baseStatisticsExtensionWidth: extension,
    statisticsExtensionWidth: extension * scale,
    scaleGesture: true,
  };
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
    scale: nextScale,
    scaleGesture: true,
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
