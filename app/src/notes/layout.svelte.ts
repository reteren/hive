import type { Note } from "../model/note";

/** Rendered height (u) of notes whose height follows their text; kept current by NotesLayer. */
export const measuredHeights: Record<string, number> = $state({});

/** Minimum height used before a note has been measured. */
export const MIN_NOTE_HEIGHT = 6;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Board-space rectangle of a note, using its manual height or the measured one. */
export function noteBounds(note: Note): Bounds {
  return {
    x: note.x,
    y: note.y,
    width: note.width,
    height: note.height ?? measuredHeights[note.id] ?? MIN_NOTE_HEIGHT,
  };
}
