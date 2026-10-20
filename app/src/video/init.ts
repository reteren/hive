import { registerNoteMenuItem } from "../notes/noteMenu";
import { board, updateNote } from "../model/board.svelte";
import { execute } from "../history/history.svelte";
import { registerVideoDropHandler } from "./import";
import { t } from "../i18n/i18n.svelte";

registerVideoDropHandler();

registerNoteMenuItem({
  id: "video.toggleFrame",
  label: (noteId) => board.notes[noteId]?.frameHidden ? t("Show node frame") : t("Hide node frame"),
  visible: (noteId) => board.notes[noteId]?.type === "video",
  run: (noteId) => {
    const note = board.notes[noteId];
    if (note?.type !== "video") return;
    const before = note.frameHidden;
    const frameHidden = before === true ? undefined : true;
    execute({
      label: frameHidden ? t("Hide video node frame") : t("Show video node frame"),
      target: note.name,
      do: () => updateNote(noteId, { frameHidden }),
      undo: () => updateNote(noteId, { frameHidden: before }),
    });
  },
  order: 75,
});
