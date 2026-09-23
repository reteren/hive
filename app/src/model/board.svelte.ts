import type { Note } from "./note";

/**
 * The open board. These helpers are raw mutations: user-facing changes go through
 * history commands (src/history) so that they can be undone.
 */
export const board = $state({
  notes: {} as Record<string, Note>,
  /** Paint order, bottom to top. */
  order: [] as string[],
});

export function addNote(note: Note, index = board.order.length): void {
  board.notes[note.id] = note;
  board.order.splice(index, 0, note.id);
}

export function removeNote(id: string): Note | undefined {
  const note = board.notes[id];
  if (!note) return undefined;
  delete board.notes[id];
  const index = board.order.indexOf(id);
  if (index !== -1) board.order.splice(index, 1);
  return note;
}

export function updateNote(id: string, patch: Partial<Omit<Note, "id" | "type">>): void {
  const note = board.notes[id];
  if (note) Object.assign(note, patch);
}

export function orderIndex(id: string): number {
  return board.order.indexOf(id);
}

/** Replace the whole board, e.g. after opening a project. */
export function replaceBoard(notes: Note[]): void {
  board.notes = Object.fromEntries(notes.map((note) => [note.id, note]));
  board.order = notes.map((note) => note.id);
}
