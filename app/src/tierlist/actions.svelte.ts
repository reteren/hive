import { execute, type HistoryCommand } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import { newId } from "../model/note";
import type { TierCard, TierRow } from "../model/nodeData";
import {
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
  const defaultColor = "#545b68";
  changeTierlist(noteId, "Add tier row", appendTierRow(rows, "New tier", defaultColor));
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
