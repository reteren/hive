import { board } from "../model/board.svelte";
import { registerNoteMenuItem } from "../notes/noteMenu";
import { setImportance, openModulePicker } from "./moduleActions.svelte";
import { importanceMenuLabel } from "./moduleLogic";

registerNoteMenuItem({
  id: "module.importance",
  label: (noteId) => importanceMenuLabel(board.notes[noteId]),
  run: (noteId) => openModulePicker(noteId, "importance"),
  visible: (noteId) => isContentNote(noteId),
  order: 40,
});

registerNoteMenuItem({
  id: "module.removeImportance",
  label: () => "Remove Importance",
  run: (noteId) => setImportance(noteId, null),
  visible: (noteId) => isContentNote(noteId) && Boolean(board.notes[noteId]?.importance),
  order: 41,
});

registerNoteMenuItem({
  id: "module.purpose",
  label: () => "Add Purpose",
  run: (noteId) => openModulePicker(noteId, "purpose"),
  visible: (noteId) => isContentNote(noteId),
  order: 42,
});

function isContentNote(noteId: string): boolean {
  const type = board.notes[noteId]?.type;
  return type === "note" || type === "pro" || type === "con";
}
