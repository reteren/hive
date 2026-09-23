export interface LineToolEscapeState {
  focusedFloatingUi: boolean;
  contextMenuOpen: boolean;
  selectionContextPickOpen: boolean;
  lineToolActive: boolean;
}

export type LineToolEscapeAction = "defer" | "close-context-menu" | "cancel-line-tool" | "pass-through";

/** Give existing floating UI first use of Escape, then cancel a line tool on the next press. */
export function resolveLineToolEscapeAction(state: LineToolEscapeState): LineToolEscapeAction {
  if (state.contextMenuOpen) return "close-context-menu";
  if (state.focusedFloatingUi || state.selectionContextPickOpen) return "defer";
  return state.lineToolActive ? "cancel-line-tool" : "pass-through";
}
