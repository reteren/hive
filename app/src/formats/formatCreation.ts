import type { MediaRef } from "../attachments/types";
import { execute } from "../history/history.svelte";
import { addNote, board, removeNote } from "../model/board.svelte";
import { newId, R5_BASE_WIDTHS, type Note } from "../model/note";
import { captureSelectionSnapshot, clearSelection, includeSelected, restoreSelectionSnapshot, selectOnly } from "../selection/selection.svelte";
import { clearSelectedLink } from "../links/selection.svelte";
import { uniqueName } from "../notes/naming";
import type { Point } from "../board/cameraMath";
import { formatNodeKind, isFormatMediaKind } from "./formatLogic";

/** Create one undoable batch from a picker/drop gesture, centred on its world point. */
export function createFormatNotes(mediaRefs: readonly MediaRef[], center: Point): string[] {
  const accepted = mediaRefs.filter((media) => isFormatMediaKind(media.kind) && formatNodeKind(media));
  if (accepted.length !== mediaRefs.length || accepted.length === 0) return [];

  const reservedNames = Object.values(board.notes).map((note) => note.name);
  const notes = accepted.map((media, index): Note => {
    const type = formatNodeKind(media)!;
    const name = uniqueName(media.name?.trim() || (type === "pdf" ? "PDF.pdf" : "File.txt"), reservedNames);
    reservedNames.push(name);
    const width = R5_BASE_WIDTHS[type];
    const height = type === "pdf" ? 30 : null;
    const cascade = index * 2.2;
    return {
      id: newId(),
      type,
      name,
      text: "",
      x: center.x + cascade - width / 2,
      y: center.y + cascade - (height ?? 24) / 2,
      width,
      height,
      createdAt: Date.now(),
      media: { ...media },
    };
  });
  const startIndex = board.order.length;
  const ids = notes.map((note) => note.id);
  const previousSelection = captureSelectionSnapshot();

  execute({
    label: notes.length === 1 ? "Import file" : "Import files",
    target: notes.length === 1 ? notes[0]?.name : `${notes.length} files`,
    do: () => {
      notes.forEach((note, index) => addNote(note, startIndex + index));
      clearSelection();
      clearSelectedLink();
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
