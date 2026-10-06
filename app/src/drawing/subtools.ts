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
  { id: "eraser", label: "Eraser", key: "KeyE", hint: "Erases drawings only. Right-click an image → Erase for pictures." },
  { id: "fill", label: "Fill", key: "KeyF" },
  { id: "select-rect", label: "Select rectangle", key: "KeyM" },
  { id: "select-lasso", label: "Lasso", key: "KeyL" },
  { id: "select-polygon", label: "Polygon", key: "KeyP" },
  { id: "text", label: "Text", key: "KeyT", hint: "Click to type; Enter adds a line; Ctrl+Enter commits; Esc cancels." },
  { id: "shape", label: "Shape", key: "KeyU", hint: "Drag to draw; adjust, then Enter or click outside to commit; Esc cancels. Shift keeps proportions." },
  { id: "spray", label: "Spray", key: "KeyY" },
  { id: "effect", label: "Effects", key: "KeyJ", hint: "Blur, Smudge or Swirl — pick one in the Draw panel." },
];
