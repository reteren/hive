/**
 * R5 data contracts for nodes that show and calculate (Goal, Progress, Calculator, Tierlist,
 * Statistics). Only types and tolerant parsers live here; behaviour lives in each node's module.
 */

/** What a Progress / Statistics node counts (user decision 26.09: chosen from a list in the node). */
export type NodeScope =
  | { kind: "auto" }
  | { kind: "board" }
  | { kind: "zone"; id: string }
  | { kind: "beacon"; id: string };

/** A card in a Tierlist row: free text, or a live read-only preview of a board node (H28/H29). */
export type TierCard =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "note"; noteId: string };

export interface TierRow {
  id: string;
  name: string;
  /** Hex "#rrggbb". */
  color: string;
  cards: TierCard[];
  /** Persisted hint dismissal for this tierlist; duplicated across rows so row edits keep it. */
  hintsDismissed?: boolean;
}

/** One line of the calculator history; the result is always recomputed from the expression. */
export interface CalcEntry {
  id: string;
  expression: string;
}

/** A bank line: label + amount taken from the bank; `sourceNoteId` is the linked node (H27). */
export interface BankRow {
  id: string;
  label: string;
  amount: number;
  sourceNoteId: string | null;
}

/**
 * Shared content of every calculator node with the same name (H31 mirroring, case-insensitive).
 * Stored once per name in board.json `calculators`, keyed by calculatorKey(name).
 */
export interface CalculatorData {
  entries: CalcEntry[];
  bank: { name: string; initial: number } | null;
  rows: BankRow[];
}

export function emptyCalculatorData(): CalculatorData {
  return { entries: [], bank: null, rows: [] };
}

/** Mirroring key: calculators whose names match case-insensitively share one CalculatorData. */
export function calculatorKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

const HEX = /^#[0-9a-f]{6}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function parseScope(value: unknown): NodeScope | null {
  if (!isRecord(value)) return null;
  if (value.kind === "auto") return { kind: "auto" };
  if (value.kind === "board") return { kind: "board" };
  if ((value.kind === "zone" || value.kind === "beacon") && nonEmptyString(value.id)) return { kind: value.kind, id: value.id };
  return null;
}

export function parseTiers(value: unknown): TierRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: TierRow[] = [];
  for (const row of value) {
    if (!isRecord(row) || !nonEmptyString(row.id) || typeof row.name !== "string") continue;
    const cards: TierCard[] = [];
    for (const card of Array.isArray(row.cards) ? row.cards : []) {
      if (!isRecord(card) || !nonEmptyString(card.id)) continue;
      if (card.kind === "text" && typeof card.text === "string") cards.push({ id: card.id, kind: "text", text: card.text });
      else if (card.kind === "note" && nonEmptyString(card.noteId)) cards.push({ id: card.id, kind: "note", noteId: card.noteId });
    }
    rows.push({
      id: row.id,
      name: row.name,
      color: typeof row.color === "string" && HEX.test(row.color) ? row.color : "#808080",
      cards,
      ...(row.hintsDismissed === true ? { hintsDismissed: true } : {}),
    });
  }
  return rows;
}

export function parseCalculatorData(value: unknown): CalculatorData | null {
  if (!isRecord(value)) return null;
  const entries: CalcEntry[] = (Array.isArray(value.entries) ? value.entries : []).flatMap((entry) =>
    isRecord(entry) && nonEmptyString(entry.id) && typeof entry.expression === "string"
      ? [{ id: entry.id, expression: entry.expression }]
      : []);
  const bank = isRecord(value.bank) && typeof value.bank.name === "string" && Number.isFinite(value.bank.initial)
    ? { name: value.bank.name, initial: value.bank.initial as number }
    : null;
  const rows: BankRow[] = (Array.isArray(value.rows) ? value.rows : []).flatMap((row) =>
    isRecord(row) && nonEmptyString(row.id) && typeof row.label === "string" && Number.isFinite(row.amount)
      ? [{ id: row.id, label: row.label, amount: row.amount as number, sourceNoteId: nonEmptyString(row.sourceNoteId) ? row.sourceNoteId : null }]
      : []);
  return { entries, bank, rows };
}
