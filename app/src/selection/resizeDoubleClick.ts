import type { ResizeEdge } from "./resize";

export type ResizeDoubleClickAction = "edit" | "auto-height" | "auto-width" | "none";

/** A body click keeps its editing intent even if a resize handle overlaps it. */
export function resizeDoubleClickAction(
  edge: ResizeEdge,
  insideEditableBody: boolean,
  allowAutoHeight = true,
  autoHeightWithinLimit = true,
  allowAutoWidth = true,
  fixedSize = false,
): ResizeDoubleClickAction {
  if (fixedSize) return "none";
  if (edge === "left" || edge === "right") {
    return insideEditableBody ? "none" : allowAutoWidth ? "auto-width" : "none";
  }
  if (edge !== "top" && edge !== "bottom") return "none";
  return insideEditableBody ? "edit" : allowAutoHeight && autoHeightWithinLimit ? "auto-height" : "none";
}
