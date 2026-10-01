import { execute } from "../history/history.svelte";
import { addNote, board, removeNote } from "../model/board.svelte";
import { newId, R5_BASE_WIDTHS, type Note } from "../model/note";
import type { Point } from "../board/cameraMath";
import { captureSelectionSnapshot, clearSelection, restoreSelectionSnapshot, selectOnly } from "../selection/selection.svelte";
import { uniqueName } from "../notes/naming";
import type { YouTubeRef } from "../attachments/types";

export function createYouTubeNote(youtube: YouTubeRef, center: Point): string {
  const name = uniqueName(youtube.title?.trim() || youtube.videoId, Object.values(board.notes).map((note) => note.name));
  const id = newId();
  const width = R5_BASE_WIDTHS.youtube;
  const note: Note = {
    id,
    type: "youtube",
    name,
    text: "",
    x: center.x - width / 2,
    y: center.y - 13.5,
    width,
    height: null,
    createdAt: Date.now(),
    headerHidden: true,
    youtube: { ...youtube },
  };
  const index = board.order.length;
  const previousSelection = captureSelectionSnapshot();

  execute({
    label: "Add YouTube video",
    target: name,
    do: () => {
      addNote(note, index);
      clearSelection();
      selectOnly(id);
    },
    undo: () => {
      removeNote(id);
      restoreSelectionSnapshot(previousSelection);
    },
  });

  return id;
}
