export interface BoardEscapeState {
  textEditingTarget: boolean;
  editorOpen: boolean;
  createMenuOpen: boolean;
}

export type BoardEscapeAction = "defer-to-text-editor" | "close-editor" | "close-create-menu" | "pass-through";

/** Resolve the board-owned part of Escape priority; other UI and selection handle the remaining path. */
export function resolveBoardEscapeAction(state: BoardEscapeState): BoardEscapeAction {
  if (state.textEditingTarget) return "defer-to-text-editor";
  if (state.editorOpen) return "close-editor";
  if (state.createMenuOpen) return "close-create-menu";
  return "pass-through";
}
