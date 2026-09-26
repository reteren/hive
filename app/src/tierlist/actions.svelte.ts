import { execute, type HistoryCommand } from "../history/history.svelte";
import { addNote, board, removeNote, updateNote } from "../model/board.svelte";
import { DEFAULT_NOTE_WIDTH, newId, type Note } from "../model/note";
import type { TierCard, TierRow } from "../model/nodeData";
import type { Point } from "../board/cameraMath";
import { grid } from "../board/grid.svelte";
import { estimatedCreationHeight, notePositionAt } from "../notes/creationPosition";
import { editing } from "../notes/editing.svelte";
import { clearSelectedLink } from "../links/selection.svelte";
import {
  captureSelectionSnapshot,
  clearSelection,
  restoreSelectionSnapshot,
  selectOnly,
} from "../selection/selection.svelte";
import {
  DEFAULT_NEW_TIER_COLOR,
  addTierCard,
  appendTierRow,
  copyTierRows,
  deleteTierCard,
  deleteTierRow,
  effectiveTierRows,
  moveTierCard,
  recolorTierRow,
  renameTierRow,
  reorderTierRow,
  nextTierlistNoteName,
  tierRowsEqual,
  updateTierCardText,
} from "./logic";

export function rowsForTierlist(noteId: string): TierRow[] {
  const note = board.notes[noteId];
  if (!note || note.type !== "tierlist") return [];
  return effectiveTierRows(note);
}

export function changeTierlist(noteId: string, label: string, nextRows: readonly TierRow[]): boolean {
  const command = createTierlistChangeCommand(noteId, label, nextRows);
  if (!command) return false;
  execute(command);
  return true;
}

export function createTierlistChangeCommand(
  noteId: string,
  label: string,
  nextRows: readonly TierRow[],
): HistoryCommand | null {
  const note = board.notes[noteId];
  if (!note || note.type !== "tierlist") return null;
  const before = effectiveTierRows(note);
  const after = copyTierRows(nextRows);
  if (tierRowsEqual(before, after)) return null;
  return {
    label,
    target: note.name,
    do: () => updateNote(noteId, { tiers: copyTierRows(after) }),
    undo: () => updateNote(noteId, { tiers: copyTierRows(before) }),
  };
}

export function addTierlistRow(noteId: string): void {
  const rows = rowsForTierlist(noteId);
  changeTierlist(noteId, "Add tier row", appendTierRow(rows, "New tier", DEFAULT_NEW_TIER_COLOR));
}

export function renameTierlistRow(noteId: string, rowId: string, name: string): void {
  const cleanName = name.trim();
  if (!cleanName) return;
  changeTierlist(noteId, "Rename tier row", renameTierRow(rowsForTierlist(noteId), rowId, cleanName));
}

export function recolorTierlistRow(noteId: string, rowId: string, color: string): void {
  changeTierlist(noteId, "Recolour tier row", recolorTierRow(rowsForTierlist(noteId), rowId, color));
}

export function reorderTierlistRow(noteId: string, rowId: string, targetIndex: number): void {
  changeTierlist(noteId, "Reorder tier rows", reorderTierRow(rowsForTierlist(noteId), rowId, targetIndex));
}

export function removeTierlistRow(
  noteId: string,
  rowId: string,
  choice: "move-below" | "delete-cards" | "cancel",
): void {
  const next = deleteTierRow(rowsForTierlist(noteId), rowId, choice);
  if (next) changeTierlist(noteId, "Delete tier row", next);
}

export function addTextTierCard(noteId: string, rowId: string): string {
  const card: TierCard = { id: newId(), kind: "text", text: "" };
  changeTierlist(noteId, "Add tier card", addTierCard(rowsForTierlist(noteId), rowId, card));
  return card.id;
}

export function addNoteTierCard(noteId: string, rowId: string, sourceNoteId: string): HistoryCommand | null {
  const card: TierCard = { id: newId(), kind: "note", noteId: sourceNoteId };
  return createTierlistChangeCommand(
    noteId,
    "Add node preview to Tierlist",
    addTierCard(rowsForTierlist(noteId), rowId, card),
  );
}

/** Copy a card between Tierlists while preserving the source and making the copy independently undoable. */
export function duplicateTierlistCard(
  sourceNoteId: string,
  sourceRowId: string,
  cardId: string,
  targetNoteId: string,
  targetRowId: string,
  targetIndex?: number,
): boolean {
  if (sourceNoteId === targetNoteId) return false;
  const sourceCard = rowsForTierlist(sourceNoteId)
    .find((row) => row.id === sourceRowId)?.cards.find((card) => card.id === cardId);
  if (!sourceCard) return false;

  const duplicate: TierCard = { ...sourceCard, id: newId() };
  return changeTierlist(
    targetNoteId,
    "Copy tier card",
    addTierCard(rowsForTierlist(targetNoteId), targetRowId, duplicate, targetIndex),
  );
}

/** Create a normal note from a text card and remove the card as one Undoable action. */
export function createTierlistTextCardNoteCommand(
  noteId: string,
  rowId: string,
  cardId: string,
  center: Point,
): HistoryCommand | null {
  const tierlist = board.notes[noteId];
  if (!tierlist || tierlist.type !== "tierlist") return null;

  const beforeRows = effectiveTierRows(tierlist);
  const card = beforeRows.find((row) => row.id === rowId)?.cards.find((item) => item.id === cardId);
  if (card?.kind !== "text") return null;

  const name = nextTierlistNoteName(Object.values(board.notes).map((item) => item.name));
  const width = DEFAULT_NOTE_WIDTH;
  const text = card.text;
  const height = estimatedCreationHeight({ type: "note", width, height: null, text });
  const position = notePositionAt(center, width, height, false, grid.step);
  const id = newId();
  const note: Note = {
    id,
    type: "note",
    name,
    text,
    x: position.x,
    y: position.y,
    width,
    height: null,
    createdAt: Date.now(),
  };
  const afterRows = deleteTierCard(beforeRows, rowId, cardId);
  const index = board.order.length;
  const previousSelection = captureSelectionSnapshot();
  const previousEditing = editing.noteId;

  return {
    label: "Move text card to board",
    target: `${tierlist.name} → ${note.name}`,
    do: () => {
      updateNote(tierlist.id, { tiers: copyTierRows(afterRows) });
      addNote(note, index);
      clearSelection();
      clearSelectedLink();
      selectOnly(id);
      editing.noteId = id;
    },
    undo: () => {
      removeNote(id);
      updateNote(tierlist.id, { tiers: copyTierRows(beforeRows) });
      restoreSelectionSnapshot(previousSelection);
      if (editing.noteId === id) editing.noteId = previousEditing;
    },
  };
}

export function moveTierlistCard(
  noteId: string,
  sourceRowId: string,
  cardId: string,
  targetRowId: string,
  targetIndex?: number,
): void {
  changeTierlist(
    noteId,
    "Move tier card",
    moveTierCard(rowsForTierlist(noteId), sourceRowId, cardId, targetRowId, targetIndex),
  );
}

export function deleteTierlistCard(noteId: string, rowId: string, cardId: string): void {
  changeTierlist(noteId, "Delete tier card", deleteTierCard(rowsForTierlist(noteId), rowId, cardId));
}

export function editTextTierCard(noteId: string, rowId: string, cardId: string, text: string): void {
  changeTierlist(noteId, "Edit tier card", updateTierCardText(rowsForTierlist(noteId), rowId, cardId, text));
}
