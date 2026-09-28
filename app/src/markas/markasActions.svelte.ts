import { execute } from "../history/history.svelte";
import { updateNote, board } from "../model/board.svelte";
import { newId } from "../model/note";
import type { CustomMark } from "../model/nodeData";
import {
  createMarkAsPatchCommand,
  mergeCustomMarks,
  validateCustomMark,
} from "./markasLogic";

export type SaveCustomMarkResult = { ok: true } | { ok: false; error: string };

export function saveMarkAsTag(
  noteId: string,
  existingId: string | null,
  text: string,
  color: string,
): SaveCustomMarkResult {
  const note = board.notes[noteId];
  if (note?.type !== "markas") return { ok: false, error: "Mark as node is unavailable." };
  const validated = validateCustomMark(text, color);
  if (!validated.ok) return validated;

  const existingIndex = existingId ? (note.customMarks ?? []).findIndex((mark) => mark.id === existingId) : -1;
  if (existingId && existingIndex < 0) return { ok: false, error: "That tag is no longer available." };

  const nextMark: CustomMark = {
    id: existingIndex >= 0 ? existingId! : newId(),
    ...validated.value,
  };
  const next = [...(note.customMarks ?? [])];
  if (existingIndex >= 0) next[existingIndex] = nextMark;
  else next.push(nextMark);

  const deduped = mergeCustomMarks([], next);
  const command = createMarkAsPatchCommand(
    note,
    { customMarks: deduped },
    writeMarkAsPatch,
    existingIndex >= 0 ? "Edit Mark as tag" : "Add Mark as tag",
  );
  if (command) execute(command);
  return { ok: true };
}

export function removeMarkAsTag(noteId: string, markId: string): void {
  const note = board.notes[noteId];
  if (note?.type !== "markas") return;
  const marks = note.customMarks ?? [];
  if (!marks.some((mark) => mark.id === markId)) return;
  const remaining = marks.filter((mark) => mark.id !== markId);
  const command = createMarkAsPatchCommand(
    note,
    { customMarks: remaining },
    writeMarkAsPatch,
    "Remove Mark as tag",
  );
  if (command) execute(command);
}

export function setCustomMarkFrame(noteId: string, enabled: boolean): void {
  const note = board.notes[noteId];
  if (!note) return;
  const command = createMarkAsPatchCommand(
    note,
    { customMarkFrame: enabled },
    writeMarkAsPatch,
    enabled ? "Enable Mark as frame" : "Disable Mark as frame",
  );
  if (command) execute(command);
}

function writeMarkAsPatch(noteId: string, patch: { customMarks?: CustomMark[]; customMarkFrame?: boolean }): void {
  const note = board.notes[noteId];
  if (!note) return;
  if ("customMarks" in patch) {
    if (patch.customMarks === undefined) delete note.customMarks;
    else updateNote(noteId, { customMarks: patch.customMarks.map((mark) => ({ ...mark })) });
  }
  if ("customMarkFrame" in patch) {
    if (patch.customMarkFrame === undefined) delete note.customMarkFrame;
    else updateNote(noteId, { customMarkFrame: patch.customMarkFrame });
  }
}
