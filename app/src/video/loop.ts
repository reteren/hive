import { board, updateNote } from "../model/board.svelte";
import { execute } from "../history/history.svelte";
import { t } from "../i18n/i18n.svelte";

/** Turn endless repeat of a video node on or off (one Undo step; saved with the project). */
export function toggleVideoLoop(noteId: string): void {
  const note = board.notes[noteId];
  if (note?.type !== "video") return;
  const before = note.loop;
  const loop = before === true ? undefined : true;
  execute({
    label: loop ? t("Loop video") : t("Stop looping"),
    target: note.name,
    do: () => updateNote(noteId, { loop }),
    undo: () => updateNote(noteId, { loop: before }),
  });
}
