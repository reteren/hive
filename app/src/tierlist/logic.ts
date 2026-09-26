import { newId, type Note } from "../model/note";
import type { TierCard, TierRow } from "../model/nodeData";

export const DEFAULT_TIERS = [
  { name: "S", color: "#FF4B5C" },
  { name: "A", color: "#FFB347" },
  { name: "B", color: "#FFE66D" },
  { name: "C", color: "#C3FF68" },
  { name: "D", color: "#7DFFB3" },
  { name: "E", color: "#5CD8FF" },
  { name: "F", color: "#9F8BFF" },
] as const;

export const DEFAULT_NEW_TIER_COLOR = "#545b68";

export type TierRowDeleteChoice = "move-below" | "delete-cards" | "cancel";

export type TierCardPreview =
  | { kind: "text"; text: string }
  | { kind: "note"; name: string; lines: string[]; missing: false }
  | { kind: "note"; name: "content missing"; lines: []; missing: true };

export function createDefaultTierRows(idFactory: () => string = newId): TierRow[] {
  return DEFAULT_TIERS.map(({ name, color }) => ({ id: idFactory(), name, color, cards: [] }));
}

export function defaultTierRowsForNote(noteId: string): TierRow[] {
  let index = 0;
  return createDefaultTierRows(() => `${noteId}:default-tier:${index++}`);
}

export function effectiveTierRows(note: Pick<Note, "id" | "tiers">): TierRow[] {
  return note.tiers === undefined ? defaultTierRowsForNote(note.id) : copyTierRows(note.tiers);
}

export function copyTierRows(rows: readonly TierRow[]): TierRow[] {
  return rows.map((row) => ({
    ...row,
    cards: row.cards.map((card) => ({ ...card })),
  }));
}

export function renameTierRow(rows: readonly TierRow[], rowId: string, name: string): TierRow[] {
  return rows.map((row) => row.id === rowId ? { ...row, name } : row);
}

export function recolorTierRow(rows: readonly TierRow[], rowId: string, color: string): TierRow[] {
  return rows.map((row) => row.id === rowId ? { ...row, color } : row);
}

export function areTierHintsDismissed(rows: readonly TierRow[]): boolean {
  return rows.some((row) => row.hintsDismissed === true);
}

export function markTierHintsDismissed(rows: readonly TierRow[]): TierRow[] {
  return rows.map((row) => ({ ...row, hintsDismissed: true, cards: row.cards.map((card) => ({ ...card })) }));
}

export function tierLabelTextColor(color: string): "#202126" | "#f6f4f1" {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return "#f6f4f1";
  const channels = [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance >= 0.179 ? "#202126" : "#f6f4f1";
}

/** Move the dragged row before the target row, or to the end when targetIndex is the length. */
export function reorderTierRow(rows: readonly TierRow[], rowId: string, targetIndex: number): TierRow[] {
  const sourceIndex = rows.findIndex((row) => row.id === rowId);
  if (sourceIndex < 0) return copyTierRows(rows);

  const next = copyTierRows(rows);
  const [row] = next.splice(sourceIndex, 1);
  const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  next.splice(Math.max(0, Math.min(next.length, adjustedTarget)), 0, row);
  return next;
}

export function appendTierRow(rows: readonly TierRow[], name: string, color: string, id = newId()): TierRow[] {
  return [
    ...copyTierRows(rows),
    { id, name, color, cards: [], ...(areTierHintsDismissed(rows) ? { hintsDismissed: true } : {}) },
  ];
}

/** A cancelled/invalid removal returns null; callers should record only non-null results. */
export function deleteTierRow(
  rows: readonly TierRow[],
  rowId: string,
  choice: TierRowDeleteChoice,
): TierRow[] | null {
  if (choice === "cancel") return null;
  const index = rows.findIndex((row) => row.id === rowId);
  if (index < 0) return null;

  const next = copyTierRows(rows);
  const [removed] = next.splice(index, 1);
  if (choice === "move-below") {
    const below = next[index];
    if (!below) return null;
    below.cards = [...removed.cards, ...below.cards];
  }
  return next;
}

export function addTierCard(rows: readonly TierRow[], rowId: string, card: TierCard, index?: number): TierRow[] {
  return rows.map((row) => {
    if (row.id !== rowId) return { ...row, cards: row.cards.map((cardItem) => ({ ...cardItem })) };
    const cards = row.cards.map((cardItem) => ({ ...cardItem }));
    const insertionIndex = Math.max(0, Math.min(cards.length, index ?? cards.length));
    cards.splice(insertionIndex, 0, { ...card });
    return { ...row, cards };
  });
}

export function deleteTierCard(rows: readonly TierRow[], rowId: string, cardId: string): TierRow[] {
  return rows.map((row) => row.id === rowId
    ? { ...row, cards: row.cards.filter((card) => card.id !== cardId) }
    : { ...row, cards: row.cards.map((card) => ({ ...card })) });
}

/** Move an existing card across rows or within its row without duplicating it. */
export function moveTierCard(
  rows: readonly TierRow[],
  sourceRowId: string,
  cardId: string,
  targetRowId: string,
  targetIndex?: number,
): TierRow[] {
  const source = rows.find((row) => row.id === sourceRowId);
  const target = rows.find((row) => row.id === targetRowId);
  const sourceIndex = source?.cards.findIndex((card) => card.id === cardId) ?? -1;
  if (!source || !target || sourceIndex < 0) return copyTierRows(rows);

  const next = copyTierRows(rows);
  const nextSource = next.find((row) => row.id === sourceRowId)!;
  const [card] = nextSource.cards.splice(sourceIndex, 1);
  const nextTarget = next.find((row) => row.id === targetRowId)!;
  const adjustedIndex = sourceRowId === targetRowId && sourceIndex < (targetIndex ?? nextTarget.cards.length)
    ? (targetIndex ?? nextTarget.cards.length) - 1
    : targetIndex ?? nextTarget.cards.length;
  nextTarget.cards.splice(Math.max(0, Math.min(nextTarget.cards.length, adjustedIndex)), 0, card);
  return next;
}

export function updateTierCardText(rows: readonly TierRow[], rowId: string, cardId: string, text: string): TierRow[] {
  return rows.map((row) => ({
    ...row,
    cards: row.cards.map((card) => row.id === rowId && card.id === cardId && card.kind === "text"
      ? { ...card, text }
      : { ...card }),
  }));
}

export function tierCardPreview(card: TierCard, notes: Readonly<Record<string, Note>>): TierCardPreview {
  if (card.kind === "text") return { kind: "text", text: card.text };
  const source = notes[card.noteId];
  if (!source) return { kind: "note", name: "content missing", lines: [], missing: true };
  const lines = source.text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 3);
  return { kind: "note", name: source.name, lines, missing: false };
}

export function tierRowsEqual(first: readonly TierRow[], second: readonly TierRow[]): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

export function nextTierlistNoteName(existingNames: readonly string[]): string {
  const occupied = new Set(existingNames.map((name) => name.toLocaleLowerCase()));
  for (let index = 1; index < Number.MAX_SAFE_INTEGER; index += 1) {
    const candidate = `Tierlist note #${index}`;
    if (!occupied.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new Error("Could not find a free Tierlist note number.");
}
