import type { Point } from "../board/cameraMath";
import { normalizeNoteScale } from "../model/note";
import { snapToGrid } from "../board/gridMath";
import type { Bounds } from "../notes/layout.svelte";
import { MIN_NOTE_HEIGHT, maximumNoteWidthForKind, minimumTextWidthForNote } from "../notes/layout.svelte";
import { preferences } from "../settings/preferences.svelte";
import {
  clampModuleHeight,
  isFixedSizeNodeKind,
  maximumWidthForKind,
  minimumHeightForKind,
  minimumWidthForKind,
  resizeEdgeAxes,
  resizeRuleForKind,
  type ResizeEdge,
} from "./resize";
import type { GeometryChange, NoteFrame } from "./gestures";

export interface GroupScaleGesture {
  before: NoteFrame[];
  after: NoteFrame[];
  bounds: Bounds;
  edge: ResizeEdge;
  startWorld: Point;
  moduleIds: ReadonlySet<string>;
  beaconIds: ReadonlySet<string>;
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
  moduleIds: ReadonlySet<string> = new Set(),
  beaconIds: ReadonlySet<string> = new Set(),
): GroupScaleGesture {
  const before = frames.map(copyFrame);
  return {
    before,
    after: before.map(copyFrame),
    bounds: { ...bounds },
    edge,
    startWorld: { ...startWorld },
    moduleIds: new Set(moduleIds),
    beaconIds: new Set(beaconIds),
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
    gesture.moduleIds,
    gesture.beaconIds,
  );
  return { ...gesture, after };
}

/** Scale note positions and dimensions around the fixed side opposite the dragged handle. */
export function scaleGroupFrames(
  frames: readonly NoteFrame[],
  bounds: Bounds,
  edge: ResizeEdge,
  delta: Point,
  snap: boolean,
  step: number,
  preserveAspect = false,
  moduleIds: ReadonlySet<string> = new Set(),
  beaconIds: ReadonlySet<string> = new Set(),
): NoteFrame[] {
  if (frames.length === 0) return [];

  const scales = edgeScales(bounds, edge, delta, snap, step);
  const axes = resizeEdgeAxes(edge);
  let scaleX = clampScale(scales.x, minimumWidthScale(frames, moduleIds, beaconIds));
  let scaleY = clampScale(scales.y, minimumHeightScale(frames, moduleIds, beaconIds));
  const imageFrames = frames.filter((frame) => frame.type === "image");
  let imageScaleX = clampSignedImageScale(scales.x, minimumWidthScale(imageFrames, new Set(), new Set()));
  let imageScaleY = clampSignedImageScale(scales.y, minimumHeightScale(imageFrames, new Set(), new Set()));

  if (axes.horizontal !== null && axes.vertical !== null && preserveAspect) {
    // The axis with the larger proportional scale change drives the uniform factor.
    const xDominates = Math.abs(scales.x - 1) >= Math.abs(scales.y - 1);
    const uniformMinimum = Math.max(minimumWidthScale(frames, moduleIds, beaconIds), minimumHeightScale(frames, moduleIds, beaconIds));
    const requested = xDominates ? scales.x : scales.y;
    const uniform = clampScale(requested, uniformMinimum);
    scaleX = uniform;
    scaleY = uniform;
    const imageUniformMinimum = Math.max(
      minimumWidthScale(imageFrames, new Set(), new Set()),
      minimumHeightScale(imageFrames, new Set(), new Set()),
    );
    imageScaleX = imageScaleY = clampSignedImageScale(requested, imageUniformMinimum);
  }

  return frames.map((frame) => {
    if (frame.type === "image") {
      const width = Math.max(4 * normalizeNoteScale(frame.scale), frame.width * Math.abs(imageScaleX));
      const height = Math.max(4 * normalizeNoteScale(frame.scale), (frame.height ?? width) * Math.abs(imageScaleY));
      const x = scaleImageAxisPosition(frame.x, frame.width, bounds.x, bounds.width, axes.horizontal, imageScaleX);
      const y = scaleImageAxisPosition(frame.y, frame.height ?? width, bounds.y, bounds.height, axes.vertical, imageScaleY);
      return {
        ...frame,
        x,
        y,
        width,
        height,
        flipX: toggleImageFlip(frame.flipX, axes.horizontal !== null && imageScaleX < 0),
        flipY: toggleImageFlip(frame.flipY, axes.vertical !== null && imageScaleY < 0),
      };
    }
    return {
      ...frame,
      x: axes.horizontal === "left"
        ? bounds.x + bounds.width - (bounds.x + bounds.width - frame.x) * scaleX
        : bounds.x + (frame.x - bounds.x) * scaleX,
      y: axes.vertical === "top"
        ? bounds.y + bounds.height - (bounds.y + bounds.height - frame.y) * scaleY
        : bounds.y + (frame.y - bounds.y) * scaleY,
      width: moduleIds.has(frame.id) || preservesGroupDimensions(frame, beaconIds)
        ? frame.width
        : Math.max(minimumWidthForFrame(frame), Math.min(frame.maxWidth ?? maximumWidthForKind(frame.type), frame.width * scaleX)),
      height: preservesGroupDimensions(frame, beaconIds) ? frame.height : moduleIds.has(frame.id)
        ? clampModuleHeight(((frame.height ?? MIN_NOTE_HEIGHT) * scaleY) / normalizeNoteScale(frame.scale), frame.type) * normalizeNoteScale(frame.scale)
        : frame.height === null ? null : Math.max(
          minimumHeightForKind(frame.type) * normalizeNoteScale(frame.scale),
          Math.min(frame.maxHeight ?? Infinity, frame.height * scaleY),
        ),
    };
  });
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
  const axes = resizeEdgeAxes(edge);
  let horizontalScale = 1;
  let verticalScale = 1;

  if (axes.horizontal === "left") {
    const rawLeft = bounds.x + delta.x;
    const left = snap ? snapToGrid({ x: rawLeft, y: 0 }, step).x : rawLeft;
    horizontalScale = (bounds.x + bounds.width - left) / bounds.width;
  } else if (axes.horizontal === "right") {
    const rawRight = bounds.x + bounds.width + delta.x;
    const right = snap ? snapToGrid({ x: rawRight, y: 0 }, step).x : rawRight;
    horizontalScale = (right - bounds.x) / bounds.width;
  }

  if (axes.vertical === "top") {
    const rawTop = bounds.y + delta.y;
    const top = snap ? snapToGrid({ x: 0, y: rawTop }, step).y : rawTop;
    verticalScale = (bounds.y + bounds.height - top) / bounds.height;
  } else if (axes.vertical === "bottom") {
    const rawBottom = bounds.y + bounds.height + delta.y;
    const bottom = snap ? snapToGrid({ x: 0, y: rawBottom }, step).y : rawBottom;
    verticalScale = (bottom - bounds.y) / bounds.height;
  }

  return {
    x: horizontalScale,
    y: verticalScale,
  };
}

function minimumWidthScale(frames: readonly NoteFrame[], moduleIds: ReadonlySet<string>, beaconIds: ReadonlySet<string>): number {
  return Math.max(0, ...frames.flatMap((frame) => moduleIds.has(frame.id) || preservesGroupDimensions(frame, beaconIds)
    ? []
    : [minimumWidthForFrame(frame) / frame.width]));
}

function minimumWidthForFrame(frame: NoteFrame): number {
  const scale = normalizeNoteScale(frame.scale);
  if (frame.type === "image") return 4 * scale;
  const minimum = minimumWidthForKind(frame.type) * scale;
  const textMinimum = preferences.fitWidthToText
    ? minimumTextWidthForNote(frame.id, (frame.maxWidth ?? maximumNoteWidthForKind(frame.type)) / scale) * scale
    : minimum;
  return Math.max(minimum, frame.minWidth ?? minimum, textMinimum);
}

function minimumHeightScale(frames: readonly NoteFrame[], moduleIds: ReadonlySet<string>, beaconIds: ReadonlySet<string>): number {
  const manualHeights = frames.flatMap((frame) => frame.height === null || moduleIds.has(frame.id) || preservesGroupDimensions(frame, beaconIds)
    ? []
    : [minimumHeightForKind(frame.type) * normalizeNoteScale(frame.scale) / frame.height]);
  return Math.max(0, ...manualHeights);
}

function preservesGroupDimensions(frame: NoteFrame, beaconIds: ReadonlySet<string>): boolean {
  return beaconIds.has(frame.id) || resizeRuleForKind(frame.type).groupDimensions === "preserve" || isFixedSizeNodeKind(frame.type);
}

function clampScale(scale: number, minimum: number): number {
  return Math.max(minimum, Math.max(0, scale));
}

function clampSignedImageScale(scale: number, minimum: number): number {
  return Math.sign(scale || 1) * Math.max(minimum, Math.abs(scale));
}

function scaleImageAxisPosition(
  position: number,
  dimension: number,
  boundsPosition: number,
  boundsDimension: number,
  handle: "left" | "right" | "top" | "bottom" | null,
  scale: number,
): number {
  if (handle === null) return position;
  const anchor = handle === "left" || handle === "top"
    ? boundsPosition + boundsDimension
    : boundsPosition;
  const nearEdge = scale < 0 ? position + dimension : position;
  return anchor + (nearEdge - anchor) * scale;
}

function toggleImageFlip(current: true | undefined, crossed: boolean): true | undefined {
  return (current === true) !== crossed ? true : undefined;
}

function framesEqual(first: readonly NoteFrame[], second: readonly NoteFrame[]): boolean {
  return first.length === second.length && first.every((frame, index) => {
    const other = second[index];
    return (
      frame.id === other.id &&
      frame.x === other.x &&
      frame.y === other.y &&
      frame.width === other.width &&
      frame.height === other.height &&
      normalizeNoteScale(frame.scale) === normalizeNoteScale(other.scale)
      && frame.flipX === other.flipX
      && frame.flipY === other.flipY
    );
  });
}

function copyFrame(frame: NoteFrame): NoteFrame {
  return { ...frame };
}
