import type { MediaRef } from "../attachments/types";
import { execute } from "../history/history.svelte";
import { addNotes, board, removeNotes } from "../model/board.svelte";
import { DEFAULT_NOTE_WIDTH, newId, R5_BASE_WIDTHS, type Note } from "../model/note";
import { captureSelectionSnapshot, clearSelection, restoreSelectionSnapshot, selection } from "../selection/selection.svelte";
import { clearSelectedLink } from "../links/selection.svelte";
import type { Point } from "../board/cameraMath";
import { formatNodeKind, isFormatMediaKind } from "./formatLogic";
import { grid } from "../board/grid.svelte";
import { boardCreationNameAllocator, creationNameAllocator, mapCreationBatch, placeCreationGrid, queryBoardCreationRightEdge, yieldCreationWork } from "../notes/creationPosition";
import { t, tp } from "../i18n/i18n.svelte";

/** A Format file has no decoded text yet; keep the first viewport compact and scrollable. */
export const FORMAT_INITIAL_HEIGHT = 40;

/** Create one undoable batch from a picker/drop gesture, centred on its world point. */
export function createFormatNotes(mediaRefs: readonly MediaRef[], center: Point): string[] {
  const accepted = mediaRefs.filter((media) => isFormatMediaKind(media.kind) && formatNodeKind(media));
  if (accepted.length !== mediaRefs.length || accepted.length === 0) return [];

  const createName = creationNameAllocator(Object.values(board.notes).map((note) => note.name));
  return commitFormatNotes(placeFormatNotes(accepted.map((media) => formatNote(media, center, createName)), center));
}

/** Prepare large file batches in yielding slices before one board/history mutation. */
export async function createFormatNotesAsync(mediaRefs: readonly MediaRef[], center: Point): Promise<string[]> {
  const accepted = mediaRefs.filter((media) => isFormatMediaKind(media.kind) && formatNodeKind(media));
  if (accepted.length !== mediaRefs.length || accepted.length === 0) return [];
  const createName = await boardCreationNameAllocator();
  const unplaced = await mapCreationBatch(accepted, (media) => formatNote(media, center, createName));
  const notes = placeFormatNotes(unplaced, center);
  await yieldCreationWork();
  return commitFormatNotes(notes);
}

function formatNote(media: MediaRef, center: Point, createName: (name: string) => string): Note {
  const type = formatNodeKind(media)!;
  const name = createName(media.name?.trim() || (type === "pdf" ? "PDF.pdf" : "File.txt"));
  const width = type === "format" ? DEFAULT_NOTE_WIDTH : R5_BASE_WIDTHS.pdf;
  const height = type === "pdf" ? 30 : FORMAT_INITIAL_HEIGHT;
  return {
    id: newId(), type, name, text: "",
    x: center.x - width / 2, y: center.y - height / 2,
    width, height, createdAt: Date.now(), media: { ...media },
  };
}

function placeFormatNotes(unplaced: readonly Note[], center: Point): Note[] {
  return placeCreationGrid(
    unplaced.map((note) => ({ note, width: note.width, height: note.height ?? FORMAT_INITIAL_HEIGHT })),
    center, queryBoardCreationRightEdge, grid.snap, grid.step,
  ).map(({ note, x, y }) => ({ ...note, x, y }));
}

function commitFormatNotes(notes: readonly Note[]): string[] {
  if (notes.length === 0) return [];
  const startIndex = board.order.length;
  const ids = notes.map((note) => note.id);
  const previousSelection = captureSelectionSnapshot();

  execute({
    label: notes.length === 1 ? t("Import file") : t("Import files"),
    target: notes.length === 1 ? notes[0]?.name : tp(notes.length, "{count} file", "{count} files"),
    do: () => {
      addNotes(notes, startIndex);
      clearSelection();
      clearSelectedLink();
      selection.ids = [...ids];
      selection.primaryId = ids.at(-1) ?? null;
    },
    undo: () => {
      removeNotes(ids);
      restoreSelectionSnapshot(previousSelection);
    },
  });
  return ids;
}
