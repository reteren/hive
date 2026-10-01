import type { Point } from "../board/cameraMath";
import { snapToGrid } from "../board/gridMath";
import { MIN_NOTE_HEIGHT, MIN_NOTE_WIDTH, maximumNoteWidthForKind, minimumTextWidthForNote } from "../notes/layout.svelte";
import { estimatedCreationHeight } from "../notes/creationPosition";
import { MODULE_NOTE_HEIGHT, MODULE_NOTE_WIDTH } from "../modules/moduleLogic";
import { preferences } from "../settings/preferences.svelte";
import { BEACON_SIZE, DEFAULT_NOTE_WIDTH, normalizeNoteScale, R5_BASE_WIDTHS, type NoteKind } from "../model/note";
import { board } from "../model/board.svelte";
import { inboxMinHeight } from "../inbox/inboxLayout";
import { userDictionary } from "../spell/dictionary.svelte";
import { measureDictionaryHeightLimits } from "../spell/dictionarySizing";
import { comboHostMinimumWidth, comboMinimumHeightForNote } from "../combo/layout";
import type { NoteFrame } from "./gestures";

export { MIN_NOTE_WIDTH };

export const RESIZE_EDGES = [
  "top-left",
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
] as const;

export type ResizeEdge = (typeof RESIZE_EDGES)[number];

export type ResizeDimensionMode = "free" | "locked" | "shrink-only";
export type ResizeHandleMode = "all" | "vertical" | "bottom-if-shrinkable" | "none";

export interface NodeResizeRule {
  width: ResizeDimensionMode;
  height: ResizeDimensionMode;
  handles: ResizeHandleMode;
  groupDimensions: "scale" | "preserve";
}

const FIXED_RULE: NodeResizeRule = { width: "locked", height: "locked", handles: "none", groupDimensions: "preserve" };
const RULES: Partial<Record<NoteKind, NodeResizeRule>> = {
  beacon: FIXED_RULE,
  time: FIXED_RULE,
  message: FIXED_RULE,
  stats: FIXED_RULE,
  progress: FIXED_RULE,
  goal: FIXED_RULE,
  trash: FIXED_RULE,
  archive: FIXED_RULE,
  source: FIXED_RULE,
  markas: FIXED_RULE,
  tierlist: FIXED_RULE,
  image: { width: "free", height: "free", handles: "all", groupDimensions: "scale" },
  list: { width: "locked", height: "free", handles: "bottom-if-shrinkable", groupDimensions: "preserve" },
  purpose: { width: "locked", height: "free", handles: "none", groupDimensions: "scale" },
  mood: { width: "locked", height: "free", handles: "none", groupDimensions: "scale" },
  inbox: { width: "locked", height: "shrink-only", handles: "bottom-if-shrinkable", groupDimensions: "preserve" },
  glossary: { width: "locked", height: "shrink-only", handles: "bottom-if-shrinkable", groupDimensions: "preserve" },
  map: { width: "free", height: "free", handles: "all", groupDimensions: "scale" },
};

const MODULE_RULE: NodeResizeRule = { width: "locked", height: "free", handles: "vertical", groupDimensions: "scale" };
const DEFAULT_RULE: NodeResizeRule = { width: "free", height: "free", handles: "all", groupDimensions: "scale" };
export const MAP_MIN_WIDTH = 20;
export const MAP_MIN_HEIGHT = 15;
export const CALENDAR_MIN_HEIGHT = 34;

export function resizeRuleForKind(kind: NoteKind | undefined): NodeResizeRule {
  if (kind) {
    const rule = RULES[kind];
    if (rule) return rule;
  }
  return isStandaloneModuleKind(kind) ? MODULE_RULE : DEFAULT_RULE;
}

export function isFixedSizeNodeKind(kind: NoteKind | undefined): boolean {
  const rule = resizeRuleForKind(kind);
  return rule.width === "locked" && rule.height === "locked";
}

export function isResizeWidthLocked(kind: NoteKind | undefined): boolean {
  return resizeRuleForKind(kind).width === "locked";
}

export function isStandaloneModuleKind(kind: NoteKind | undefined): boolean {
  return kind === "importance" || kind === "purpose" || kind === "mood";
}

export function hasResizeHandle(kind: NoteKind | undefined, edge: ResizeEdge, canShrink = false): boolean {
  switch (resizeRuleForKind(kind).handles) {
    case "none": return false;
    case "vertical": return resizeEdgeAxes(edge).vertical !== null;
    case "bottom-if-shrinkable": return edge === "bottom" && canShrink;
    case "all": return true;
  }
}

export function clampModuleHeight(height: number, kind?: NoteKind): number {
  const minimum = kind ? minimumHeightForKind(kind) : MODULE_NOTE_HEIGHT;
  return Math.min(MODULE_NOTE_HEIGHT * 2, Math.max(minimum, height));
}

export interface ResizeEdgeAxes {
  horizontal: "left" | "right" | null;
  vertical: "top" | "bottom" | null;
}

const EDGE_AXES: Record<ResizeEdge, ResizeEdgeAxes> = {
  "top-left": { horizontal: "left", vertical: "top" },
  top: { horizontal: null, vertical: "top" },
  "top-right": { horizontal: "right", vertical: "top" },
  right: { horizontal: "right", vertical: null },
  "bottom-right": { horizontal: "right", vertical: "bottom" },
  bottom: { horizontal: null, vertical: "bottom" },
  "bottom-left": { horizontal: "left", vertical: "bottom" },
  left: { horizontal: "left", vertical: null },
};

export interface ResizedGeometry {
  x: number;
  y: number;
  width: number;
  height: number | null;
  flipX?: true;
  flipY?: true;
}

export interface ResizeLimits {
  maxWidth?: number;
  maxHeight?: number;
}

export function defaultWidthForKind(kind: NoteKind | undefined): number {
  if (!kind) return DEFAULT_NOTE_WIDTH;
  if (kind === "beacon") return BEACON_SIZE;
  if (kind in R5_BASE_WIDTHS) return R5_BASE_WIDTHS[kind as keyof typeof R5_BASE_WIDTHS];
  if (kind === "importance" || kind === "purpose" || kind === "mood") return MODULE_NOTE_WIDTH;
  return kind === "pro" || kind === "con" ? 18 : DEFAULT_NOTE_WIDTH;
}

export function maximumWidthForKind(kind: NoteKind | undefined): number {
  if (!kind) return Number.POSITIVE_INFINITY;
  return maximumNoteWidthForKind(kind);
}

export function minimumWidthForKind(kind: NoteKind | undefined): number {
  return kind === "image" ? 4 : kind === "map" ? MAP_MIN_WIDTH : kind === "pdf" ? 30 : defaultWidthForKind(kind);
}

export function minimumHeightForKind(kind: NoteKind | undefined): number {
  if (kind === "image") return 4;
  if (kind === "map") return MAP_MIN_HEIGHT;
  if (kind === "pdf") return 30;
  if (kind === "calendar") return CALENDAR_MIN_HEIGHT;
  const width = defaultWidthForKind(kind);
  const initialHeight = kind === "beacon" ? BEACON_SIZE : kind === "importance" ? MODULE_NOTE_HEIGHT : null;
  return estimatedCreationHeight({ type: kind ?? "note", width, height: initialHeight, text: "" });
}

export function clampShrinkOnlyHeight(requested: number, minimum: number, autoHeight: number): number {
  const safeAutoHeight = Number.isFinite(autoHeight) ? Math.max(0, autoHeight) : Math.max(0, requested);
  const safeMinimum = Math.min(safeAutoHeight, Number.isFinite(minimum) ? Math.max(0, minimum) : 0);
  const safeRequested = Number.isFinite(requested) ? requested : safeAutoHeight;
  return Math.min(safeAutoHeight, Math.max(safeMinimum, safeRequested));
}

export function resizeEdgeAxes(edge: ResizeEdge): ResizeEdgeAxes {
  return EDGE_AXES[edge];
}

/** Resize around the opposite edge, snapping the dragged edge itself. */
export function resizeNote(
  initial: NoteFrame,
  visualHeight: number,
  edge: ResizeEdge,
  delta: Point,
  snap: boolean,
  step: number,
  standaloneModule = false,
  limits: ResizeLimits = {},
  preserveImageAspectRatio = false,
): ResizedGeometry {
  if (isFixedSizeNodeKind(initial.type)) {
    return { x: initial.x, y: initial.y, width: initial.width, height: initial.height };
  }
  if (initial.type === "list") {
    const list = board.notes[initial.id];
    if (edge !== "bottom" || list?.type !== "list" || (list.listItems?.length ?? 0) <= 7) {
      return { x: initial.x, y: initial.y, width: initial.width, height: initial.height };
    }
  }

  const rule = resizeRuleForKind(initial.type);
  const axes = resizeEdgeAxes(edge);
  const scale = normalizeNoteScale(initial.scale);
  const maxWidth = limits.maxWidth ?? initial.maxWidth ?? maximumWidthForKind(initial.type) * scale;
  const maxHeight = initial.type === "image" || initial.type === "map"
    ? Number.POSITIVE_INFINITY
    : limits.maxHeight ?? initial.maxHeight ?? (initial.type ? MIN_NOTE_HEIGHT * 1.5 * scale : Number.POSITIVE_INFINITY);
  const hostedMinimumWidth = board.notes[initial.id]
    ? comboHostMinimumWidth(board.notes[initial.id])
    : null;
  const hostedMinimumHeight = board.notes[initial.id]
    ? comboMinimumHeightForNote(initial.id, board.notes[initial.id])
    : null;
  const minimumHeight = Math.max(
    initial.minHeight ?? minimumHeightForKind(initial.type) * scale,
    hostedMinimumHeight === null ? 0 : hostedMinimumHeight * scale,
  );
  let x = initial.x;
  let y = initial.y;
  let width = initial.width;
  let height = initial.height;
  const minimumWidth = initial.type === "map"
    ? initial.minWidth ?? MAP_MIN_WIDTH * scale
    : initial.type === "image"
      ? Math.max(4 * scale, initial.minWidth ?? 0)
    : Math.max(
      minimumWidthForKind(initial.type) * scale,
      hostedMinimumWidth === null ? 0 : hostedMinimumWidth * scale,
      initial.minWidth ?? (preferences.fitWidthToText
        ? minimumTextWidthForNote(initial.id, maxWidth / scale) * scale
        : MIN_NOTE_WIDTH * scale),
    );

  if (initial.type === "image") {
    const verticalHandle = axes.vertical === "top" ? "left" : axes.vertical === "bottom" ? "right" : null;
    return resizeImage(
      initial,
      visualHeight,
      axes.horizontal,
      verticalHandle,
      delta,
      snap,
      step,
      minimumWidth,
      minimumHeight,
      maxWidth,
      maxHeight,
      preserveImageAspectRatio,
    );
  }

  if (!isResizeWidthLocked(initial.type) && !standaloneModule && axes.horizontal === "right") {
    let right = initial.x + initial.width + delta.x;
    if (snap) right = snapToGrid({ x: right, y: 0 }, step).x;
    width = Math.max(minimumWidth, Math.min(maxWidth, right - initial.x));
  } else if (!isResizeWidthLocked(initial.type) && !standaloneModule && axes.horizontal === "left") {
    let left = initial.x + delta.x;
    if (snap) left = snapToGrid({ x: left, y: 0 }, step).x;
    const fixedRight = initial.x + initial.width;
    width = Math.max(minimumWidth, Math.min(maxWidth, fixedRight - left));
    x = fixedRight - width;
  }

  if (axes.vertical === "bottom") {
    let bottom = initial.y + visualHeight + delta.y;
    if (snap) bottom = snapToGrid({ x: 0, y: bottom }, step).y;
    if (rule.height === "shrink-only") {
      const autoHeight = Math.max(0, limits.maxHeight ?? initial.maxHeight ?? visualHeight);
      const requestedHeight = bottom - initial.y;
      if (initial.height === null && requestedHeight >= autoHeight) {
        height = null;
      } else {
        const minHeight = minimumShrinkHeight(initial, autoHeight / scale) * scale;
        const maximumHeight = initial.height === null ? autoHeight : Math.min(initial.height, autoHeight);
        height = clampShrinkOnlyHeight(requestedHeight, minHeight, maximumHeight);
      }
    } else height = standaloneModule
      ? clampModuleHeight((bottom - initial.y) / scale, initial.type) * scale
      : Math.max(minimumHeight, Math.min(maxHeight, bottom - initial.y));
  } else if (axes.vertical === "top") {
    let top = initial.y + delta.y;
    if (snap) top = snapToGrid({ x: 0, y: top }, step).y;
    const fixedBottom = initial.y + visualHeight;
    height = standaloneModule
      ? clampModuleHeight((fixedBottom - top) / scale, initial.type) * scale
      : Math.max(minimumHeight, Math.min(maxHeight, fixedBottom - top));
    y = fixedBottom - height;
  }

  return { x, y, width, height };
}

function resizeImage(
  initial: NoteFrame,
  visualHeight: number,
  horizontalHandle: "left" | "right" | null,
  verticalHandle: "left" | "right" | null,
  delta: Point,
  snap: boolean,
  step: number,
  minimumWidth: number,
  minimumHeight: number,
  maxWidth: number,
  maxHeight: number,
  preserveAspect: boolean,
): ResizedGeometry {
  const initialWidth = Math.max(0.001, initial.width);
  const initialHeight = Math.max(0.001, initial.height ?? visualHeight);
  const scaleX = imageAxisScale(initial.x, initialWidth, horizontalHandle, delta.x, snap, step, "x");
  const scaleY = imageAxisScale(initial.y, initialHeight, verticalHandle, delta.y, snap, step, "y");
  const corner = horizontalHandle !== null && verticalHandle !== null;
  let width: number;
  let height: number;
  let crossedX = false;
  let crossedY = false;

  if (preserveAspect) {
    const requestedScale = corner
      ? Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY
      : horizontalHandle !== null ? scaleX : scaleY;
    const minimumFactor = Math.max(minimumWidth / initialWidth, minimumHeight / initialHeight);
    const maximumFactor = Math.max(minimumFactor, Math.min(maxWidth / initialWidth, maxHeight / initialHeight));
    const factor = Math.min(maximumFactor, Math.max(minimumFactor, Math.abs(requestedScale)));
    width = initialWidth * factor;
    height = initialHeight * factor;
    crossedX = horizontalHandle !== null && scaleX < 0;
    crossedY = verticalHandle !== null && scaleY < 0;
  } else {
    const xResult = resizeImageAxis(initialWidth, horizontalHandle, scaleX, minimumWidth, maxWidth);
    const yResult = resizeImageAxis(initialHeight, verticalHandle, scaleY, minimumHeight, maxHeight);
    width = xResult.dimension;
    height = yResult.dimension;
    crossedX = xResult.crossed;
    crossedY = yResult.crossed;
  }

  return {
    x: imageAxisPosition(initial.x, initialWidth, horizontalHandle, width, crossedX),
    y: imageAxisPosition(initial.y, initialHeight, verticalHandle, height, crossedY),
    width,
    height,
    flipX: toggleImageFlip(initial.flipX, crossedX),
    flipY: toggleImageFlip(initial.flipY, crossedY),
  };
}

function imageAxisScale(
  position: number,
  dimension: number,
  handle: "left" | "right" | null,
  delta: number,
  snap: boolean,
  step: number,
  axis: "x" | "y",
): number {
  if (handle === null) return 1;
  const rawHandle = handle === "left" ? position + delta : position + dimension + delta;
  const snappedHandle = !snap ? rawHandle : axis === "x"
    ? snapToGrid({ x: rawHandle, y: 0 }, step).x
    : snapToGrid({ x: 0, y: rawHandle }, step).y;
  const oppositeEdge = handle === "left" ? position + dimension : position;
  return (handle === "left" ? oppositeEdge - snappedHandle : snappedHandle - oppositeEdge) / dimension;
}

function resizeImageAxis(
  dimension: number,
  handle: "left" | "right" | null,
  signedScale: number,
  minimum: number,
  maximum: number,
): { dimension: number; crossed: boolean } {
  if (handle === null) return { dimension, crossed: false };
  const crossed = signedScale < 0;
  return {
    dimension: Math.max(minimum, Math.min(maximum, dimension * Math.abs(signedScale))),
    crossed,
  };
}

function imageAxisPosition(
  position: number,
  dimension: number,
  handle: "left" | "right" | null,
  resizedDimension: number,
  crossed: boolean,
): number {
  if (handle === null) return position - (resizedDimension - dimension) / 2;
  const oppositeEdge = handle === "left" ? position + dimension : position;
  if (handle === "left") return crossed ? oppositeEdge : oppositeEdge - resizedDimension;
  return crossed ? oppositeEdge - resizedDimension : oppositeEdge;
}

function toggleImageFlip(current: true | undefined, crossed: boolean): true | undefined {
  return (current === true) !== crossed ? true : undefined;
}

function minimumShrinkHeight(initial: NoteFrame, autoHeight: number): number {
  if (initial.type === "inbox") {
    const note = board.notes[initial.id];
    return note ? Math.max(minimumHeightForKind(initial.type), inboxMinHeight(note)) : minimumHeightForKind(initial.type);
  }
  if (initial.type === "glossary") {
    return Math.max(
      minimumHeightForKind(initial.type),
      measureDictionaryHeightLimits(initial.id, userDictionary.words.length, autoHeight).minimumHeight,
    );
  }
  return minimumHeightForKind(initial.type);
}
