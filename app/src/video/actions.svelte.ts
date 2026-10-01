import { execute } from "../history/history.svelte";
import { addNote, board, removeNote } from "../model/board.svelte";
import { newId, type Note } from "../model/note";
import type { MediaRef } from "../attachments/types";
import type { Point } from "../board/cameraMath";
import { captureSelectionSnapshot, clearSelection, includeSelected, restoreSelectionSnapshot, selectOnly } from "../selection/selection.svelte";
import { uniqueName } from "../notes/naming";
import { fitVideoSize } from "./logic";

/** Add imported videos as one undoable action, centered at the user's drop/picker point. */
export function createVideoNotes(mediaItems: readonly MediaRef[], center: Point): string[] {
  const videos = mediaItems.filter((media) => media.kind === "video");
  if (videos.length === 0) return [];

  const occupiedNames = Object.values(board.notes).map((note) => note.name);
  const notes = videos.map((media, index): Note => {
    const size = fitVideoSize(media.naturalWidth, media.naturalHeight);
    const name = uniqueName(media.name?.trim() || "Video", occupiedNames);
    occupiedNames.push(name);
    const offset = index * 2.2;
    return {
      id: newId(),
      type: "video",
      name,
      text: "",
      x: center.x + offset - size.width / 2,
      y: center.y + offset - size.height / 2,
      width: size.width,
      height: null,
      createdAt: Date.now(),
      media: { ...media },
    };
  });
  const ids = notes.map(({ id }) => id);
  const startIndex = board.order.length;
  const previousSelection = captureSelectionSnapshot();

  execute({
    label: videos.length === 1 ? "Import video" : "Import videos",
    target: videos.length === 1 ? notes[0].name : `${videos.length} videos`,
    do: () => {
      notes.forEach((note, index) => addNote(note, startIndex + index));
      clearSelection();
      if (ids[0]) selectOnly(ids[0]);
      for (const id of ids.slice(1)) includeSelected(id);
    },
    undo: () => {
      for (const id of [...ids].reverse()) removeNote(id);
      restoreSelectionSnapshot(previousSelection);
    },
  });

  return ids;
}
