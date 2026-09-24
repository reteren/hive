import type { Point } from "../board/cameraMath";
import { snapToGrid } from "../board/gridMath";
import { MIN_NOTE_HEIGHT } from "../notes/layout.svelte";
import { MODULE_NOTE_HEIGHT } from "../modules/moduleLogic";
import type { NoteKind } from "../model/note";
import type { NoteFrame } from "./gestures";

export const MIN_NOTE_WIDTH = 12;

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

export function isStandaloneModuleKind(kind: NoteKind | undefined): boolean {
  return kind === "importance" || kind === "purpose" || kind === "mood";
}

export function hasResizeHandle(kind: NoteKind | undefined, edge: ResizeEdge): boolean {
  if (kind === "beacon") return false;
  return !isStandaloneModuleKind(kind) || (edge !== "left" && edge !== "right");
}

export function clampModuleHeight(height: number): number {
  return Math.min(MODULE_NOTE_HEIGHT * 2, Math.max(MODULE_NOTE_HEIGHT, height));
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
): ResizedGeometry {
  const axes = resizeEdgeAxes(edge);
  let x = initial.x;
  let y = initial.y;
  let width = initial.width;
  let height = initial.height;

  if (!standaloneModule && axes.horizontal === "right") {
    let right = initial.x + initial.width + delta.x;
    if (snap) right = snapToGrid({ x: right, y: 0 }, step).x;
    width = Math.max(MIN_NOTE_WIDTH, right - initial.x);
  } else if (!standaloneModule && axes.horizontal === "left") {
    let left = initial.x + delta.x;
    if (snap) left = snapToGrid({ x: left, y: 0 }, step).x;
    const fixedRight = initial.x + initial.width;
    width = Math.max(MIN_NOTE_WIDTH, fixedRight - left);
    x = fixedRight - width;
  }

  if (axes.vertical === "bottom") {
    let bottom = initial.y + visualHeight + delta.y;
    if (snap) bottom = snapToGrid({ x: 0, y: bottom }, step).y;
    height = standaloneModule
      ? clampModuleHeight(bottom - initial.y)
      : Math.max(MIN_NOTE_HEIGHT, bottom - initial.y);
  } else if (axes.vertical === "top") {
    let top = initial.y + delta.y;
    if (snap) top = snapToGrid({ x: 0, y: top }, step).y;
    const fixedBottom = initial.y + visualHeight;
    height = standaloneModule
      ? clampModuleHeight(fixedBottom - top)
      : Math.max(MIN_NOTE_HEIGHT, fixedBottom - top);
    y = fixedBottom - height;
  }

  return { x, y, width, height };
}
