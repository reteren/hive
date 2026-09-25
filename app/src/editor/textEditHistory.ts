import { ChangeSet, EditorSelection, type Text } from "@codemirror/state";
import {
  applyTextEditEffects,
  mergeTextEditEffects,
  type TextEditEffect,
} from "../transfer/textEditHooks";

export type TextEditKind = "typing" | "backspace" | "forward-delete" | "atomic";

export interface TextEditRecord {
  noteId: string;
  target: string;
  before: Text;
  after: Text;
  forward: ChangeSet;
  inverse: ChangeSet;
  selectionBefore: EditorSelection;
  selectionAfter: EditorSelection;
  kind: TextEditKind;
  at: number;
  group: number;
  /** Width changes caused by text fitting travel with the same text Undo/Redo step. */
  widthBefore?: number;
  widthAfter?: number;
  /** Changes to dependent nodes that share this edit's Undo/Redo boundary. */
  transferEffects?: TextEditEffect[];
}

const MERGE_WINDOW_MS = 1000;

export function textEditKind(userEvent: string | undefined): TextEditKind {
  if (userEvent?.startsWith("input.type")) return "typing";
  if (userEvent === "delete.backward") return "backspace";
  if (userEvent === "delete.forward") return "forward-delete";
  return "atomic";
}

export function createTextEditRecord(input: Omit<TextEditRecord, "inverse">): TextEditRecord {
  return { ...input, inverse: input.forward.invert(input.before) };
}

/** Replay a source edit and its dependent node changes as one Undo/Redo transition. */
export function replayTextEditRecord(
  edit: TextEditRecord,
  direction: "undo" | "redo",
  applySourceText: (text: string) => void,
): void {
  applySourceText((direction === "redo" ? edit.after : edit.before).toString());
  applyTextEditEffects(edit.transferEffects ?? [], direction);
}

export function mergeTextEditRecords(
  previous: TextEditRecord,
  next: TextEditRecord,
): TextEditRecord | null {
  if (!canMergeTextEditRecords(previous, next)) return null;

  const transferEffects = mergeTextEditEffects(previous.transferEffects ?? [], next.transferEffects ?? []);
  if (!transferEffects) return null;

  const forward = previous.forward.compose(next.forward);
  return {
    ...previous,
    after: next.after,
    forward,
    inverse: forward.invert(previous.before),
    selectionAfter: next.selectionAfter,
    at: next.at,
    widthBefore: previous.widthBefore ?? next.widthBefore,
    widthAfter: next.widthAfter ?? previous.widthAfter,
    transferEffects,
  };
}

export function canMergeTextEditRecords(previous: TextEditRecord, next: TextEditRecord): boolean {
  if (previous.noteId !== next.noteId || previous.group !== next.group) return false;
  if (previous.kind !== next.kind || (next.kind !== "typing" && next.kind !== "backspace")) return false;
  if (next.at < previous.at || next.at - previous.at > MERGE_WINDOW_MS) return false;
  return previous.selectionAfter.eq(next.selectionBefore);
}
