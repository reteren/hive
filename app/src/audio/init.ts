import { registerNoteMenuItem } from "../notes/noteMenu";
import { board } from "../model/board.svelte";
import { selection } from "../selection/selection.svelte";
import { exportRecordings, recordingExports } from "./exportRecordings";
import { t } from "../i18n/i18n.svelte";

/** Right-clicking one of several selected nodes exports the audio of the whole selection. */
function exportTargets(noteId: string) {
  const ids = selection.ids.includes(noteId) ? selection.ids : [noteId];
  return recordingExports(ids.map((id) => board.notes[id]));
}

registerNoteMenuItem({
  id: "audio.export",
  label: (noteId) => exportTargets(noteId).length > 1 ? t("Export recordings…") : t("Export…"),
  visible: (noteId) => board.notes[noteId]?.type === "audio" && exportTargets(noteId).length > 0,
  run: (noteId) => { void exportRecordings(exportTargets(noteId)); },
  order: 30,
});
