import type { ResizeEdge } from "./resize";

export type ResizeDoubleClickAction = "edit" | "auto-height" | "none";

/** A body click keeps its editing intent even if a resize handle overlaps it. */
export function resizeDoubleClickAction(
  edge: ResizeEdge,
  insideEditableBody: boolean,
  allowAutoHeight = true,
  autoHeightWithinLimit = true,
): ResizeDoubleClickAction {
  if (edge !== "top" && edge !== "bottom") return "none";
  return insideEditableBody ? "edit" : allowAutoHeight && autoHeightWithinLimit ? "auto-height" : "none";
}
