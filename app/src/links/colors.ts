import { board } from "../model/board.svelte";
import type { Note } from "../model/note";

export const DEFAULT_LINE_COLOR = "#a9a294";

/** Resolve the color of a board endpoint, keeping link rendering ready for note colors. */
export function objectColor(id: string): string {
  const note = board.notes[id] as (Note & { color?: unknown }) | undefined;
  const color = note?.color;
  return typeof color === "string" && /^#[\da-f]{3,8}$/i.test(color) ? color : DEFAULT_LINE_COLOR;
}
