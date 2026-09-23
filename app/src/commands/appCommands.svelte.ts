import { registerCommand } from "./registry.svelte";
import { commandSearchState, openCommandSearch } from "./commandSearch.svelte";
import { keymapPanelState, openKeymapPanel } from "./keymapPanel.svelte";
import { undoLogPanel, redo, toggleUndoLog, undo } from "../history/history.svelte";
import { display } from "../settings/display.svelte";
import { sequentialRenameState, startSequentialRename } from "../notes/sequentialRenameState.svelte";

function runUndo(): void {
  try {
    undo();
  } catch {
    // The history wrapper reports a short failure caption without moving its cursor.
  }
}

function runRedo(): void {
  try {
    redo();
  } catch {
    // The history wrapper reports a short failure caption without moving its cursor.
  }
}

registerCommand({
  id: "edit.undo",
  label: "Undo",
  keys: ["Ctrl+KeyZ"],
  run: runUndo,
});

registerCommand({
  id: "edit.redo",
  label: "Redo",
  keys: ["Ctrl+Shift+KeyZ", "Ctrl+KeyY"],
  run: runRedo,
});

registerCommand({
  id: "ui.toggleUndoLog",
  label: "Toggle Undo Log",
  keys: ["Ctrl+Alt+KeyZ"],
  run: toggleUndoLog,
  isActive: () => undoLogPanel.open,
});

registerCommand({
  id: "ui.toggleRightPanel",
  label: "Toggle Display Panel",
  keys: ["KeyN"],
  run: () => {
    display.rightPanelOpen = !display.rightPanelOpen;
  },
  isActive: () => display.rightPanelOpen,
});

registerCommand({
  id: "ui.commandSearch",
  label: "Command Search",
  keys: ["F3"],
  run: openCommandSearch,
  isActive: () => commandSearchState.open,
});

registerCommand({
  id: "ui.keymap",
  label: "Edit Key Bindings",
  keys: ["Ctrl+Shift+KeyK"],
  run: openKeymapPanel,
  isActive: () => keymapPanelState.open,
});

registerCommand({
  id: "notes.renameSequence",
  label: "Rename Selection Sequentially",
  keys: ["F2"],
  run: startSequentialRename,
  isActive: () => sequentialRenameState.session !== null,
});
