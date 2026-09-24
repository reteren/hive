import { board } from "../model/board.svelte";
import { registerNoteMenuItem } from "../notes/noteMenu";
import { isLinkedImportance, setImportance, toggleModulePicker } from "./moduleActions.svelte";
import { importanceMenuLabel } from "./moduleLogic";

registerNoteMenuItem({
  id: "module.importance",
  label: (noteId) => importanceMenuLabel(board.notes[noteId], isLinkedImportance(noteId)),
  run: (noteId) => toggleModulePicker(noteId, "importance"),
  visible: (noteId) => isContentNote(noteId),
  order: 40,
});

registerNoteMenuItem({
  id: "module.removeImportance",
  label: () => "Remove Importance",
  run: (noteId) => setImportance(noteId, null),
  visible: (noteId) => isContentNote(noteId) && Boolean(board.notes[noteId]?.importance) &&
    !isLinkedImportance(noteId),
  order: 41,
});

registerNoteMenuItem({
  id: "module.purpose",
  label: () => "Add Purpose",
  run: (noteId) => toggleModulePicker(noteId, "purpose"),
  visible: (noteId) => isContentNote(noteId),
  order: 42,
});

registerNoteMenuItem({
  id: "module.mood",
  label: () => "Add Mood",
  run: (noteId) => toggleModulePicker(noteId, "mood"),
  visible: (noteId) => isContentNote(noteId),
  order: 43,
});

function isContentNote(noteId: string): boolean {
  const type = board.notes[noteId]?.type;
  return type === "note" || type === "pro" || type === "con";
}
