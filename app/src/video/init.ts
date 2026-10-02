import { registerNoteMenuItem } from "../notes/noteMenu";
import { board, updateNote } from "../model/board.svelte";
import { execute } from "../history/history.svelte";
import { registerVideoDropHandler } from "./import";

registerVideoDropHandler();

registerNoteMenuItem({
  id: "video.toggleFrame",
  label: (noteId) => board.notes[noteId]?.frameHidden ? "Show node frame" : "Hide node frame",
  visible: (noteId) => board.notes[noteId]?.type === "video",
  run: (noteId) => {
    const note = board.notes[noteId];
    if (note?.type !== "video") return;
    const before = note.frameHidden;
    const frameHidden = before === true ? undefined : true;
    execute({
      label: frameHidden ? "Hide video node frame" : "Show video node frame",
      target: note.name,
      do: () => updateNote(noteId, { frameHidden }),
      undo: () => updateNote(noteId, { frameHidden: before }),
    });
  },
  order: 75,
});
