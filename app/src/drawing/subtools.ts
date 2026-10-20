import type { DrawTool } from "./types";
import { t } from "../i18n/i18n.svelte";

export interface DrawSubtoolInfo {
  id: DrawTool;
  label: string;
  /** KeyboardEvent.code of the draw-mode shortcut (see DRAW_SHORTCUTS in drawInput.ts). */
  key: string;
  hint?: string;
}

/** Draw sub-tools in hotbar order; they appear under the Draw button only while draw mode is on. */
export const DRAW_SUBTOOLS: readonly DrawSubtoolInfo[] = [
  { id: "brush", get label() { return t("Brush"); }, key: "KeyB" },
  { id: "eraser", get label() { return t("Eraser"); }, key: "KeyE", get hint() { return t("Erases drawings only. Right-click an image → Erase for pictures."); } },
  { id: "fill", get label() { return t("Fill"); }, key: "KeyF" },
  { id: "select-rect", get label() { return t("Select rectangle"); }, key: "KeyM" },
  { id: "select-lasso", get label() { return t("Lasso"); }, key: "KeyL" },
  { id: "select-polygon", get label() { return t("Polygon"); }, key: "KeyP" },
  { id: "text", get label() { return t("Text"); }, key: "KeyT", hint: "Click to type; Enter adds a line; Ctrl+Enter commits; Esc cancels." },
  { id: "shape", get label() { return t("Shape"); }, key: "KeyU", hint: "Drag to draw; adjust, then Enter or click outside to commit; Esc cancels. Shift keeps proportions." },
  { id: "effect", get label() { return t("Effects"); }, key: "KeyJ", get hint() { return t("Blur, Smudge or Swirl — pick one in the Draw panel."); } },
];
