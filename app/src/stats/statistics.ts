import type { Note } from "../model/note";
import type { TierRow } from "../model/nodeData";

const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’\u2010-\u2015-][\p{L}\p{N}\p{M}]+)*/gu;

export interface TextStatistics {
  words: number;
  characters: number;
  lines: number;
  noteCount: number;
}

export interface TierlistStatistics {
  total: number;
  rows: Array<{ id: string; name: string; color: string; count: number }>;
}

/** Keep the Tierlist's row order, including empty rows. Every card counts once. */
export function summarizeTierlist(rows: readonly TierRow[]): TierlistStatistics {
  return {
    total: rows.reduce((count, row) => count + row.cards.length, 0),
    rows: rows.map((row) => ({ id: row.id, name: row.name, color: row.color, count: row.cards.length })),
  };
}

/** Count unique text notes only: note/pro/con, including task-marked notes. */
export function summarizeTextStatistics(
  noteIds: Iterable<string>,
  notes: Readonly<Record<string, Note | undefined>>,
): TextStatistics {
  let words = 0;
  let characters = 0;
  let lines = 0;
  let noteCount = 0;

  for (const noteId of new Set(noteIds)) {
    const note = notes[noteId];
    if (!note || !isTextNote(note)) continue;

    const text = note.text ?? "";
    noteCount += 1;
    words += [...text.matchAll(WORD)].length;
    characters += [...text].length;
    lines += text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
  }

  return { words, characters, lines, noteCount };
}

function isTextNote(note: Note): boolean {
  return note.type === "note" || note.type === "pro" || note.type === "con";
}
