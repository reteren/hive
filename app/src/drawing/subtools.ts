import type { DrawTool } from "./types";

export interface DrawSubtoolInfo {
  id: DrawTool;
  label: string;
  /** KeyboardEvent.code of the draw-mode shortcut (see DRAW_SHORTCUTS in drawInput.ts). */
  key: string;
  hint?: string;
}

/** Draw sub-tools in hotbar order; they appear under the Draw button only while draw mode is on. */
export const DRAW_SUBTOOLS: readonly DrawSubtoolInfo[] = [
  { id: "brush", label: "Brush", key: "KeyB" },
  { id: "eraser", label: "Eraser", key: "KeyE", hint: "Eraser does not affect GIFs." },
  { id: "fill", label: "Fill", key: "KeyF" },
  { id: "select-rect", label: "Select rectangle", key: "KeyM" },
  { id: "select-lasso", label: "Lasso", key: "KeyL" },
  { id: "select-polygon", label: "Polygon", key: "KeyP" },
];
