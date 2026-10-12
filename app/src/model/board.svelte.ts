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

/**
 * Mutation listeners (spatial index, autosave dirty tracking). `ids` lists the notes that changed;
 * null means "the whole board may have changed" (replaceBoard). Listeners run synchronously and
 * must stay cheap: record what changed, do the work later.
 */
export type BoardMutationListener = (ids: readonly string[] | null) => void;
const mutationListeners = new Set<BoardMutationListener>();

export function onBoardMutation(listener: BoardMutationListener): () => void {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
}

/** Tell listeners about notes changed outside these helpers (direct writes to a note proxy). */
export function notifyBoardMutation(ids: readonly string[] | null): void {
  for (const listener of mutationListeners) listener(ids);
}

export function addNote(note: Note, index = board.order.length): void {
  board.notes[note.id] = note;
  board.order.splice(index, 0, note.id);
  notifyBoardMutation([note.id]);
}

export function removeNote(id: string): Note | undefined {
  const note = board.notes[id];
  if (!note) return undefined;
  delete board.notes[id];
  const index = board.order.indexOf(id);
  if (index !== -1) board.order.splice(index, 1);
  notifyBoardMutation([id]);
  return note;
}

export function updateNote(id: string, patch: Partial<Omit<Note, "id" | "type">>): void {
  const note = board.notes[id];
  if (!note) return;
  Object.assign(note, patch);
  notifyBoardMutation([id]);
}

export function orderIndex(id: string): number {
  return board.order.indexOf(id);
}

/** Replace the whole board, e.g. after opening a project. */
export function replaceBoard(notes: Note[]): void {
  board.notes = Object.fromEntries(notes.map((note) => [note.id, note]));
  board.order = notes.map((note) => note.id);
  notifyBoardMutation(null);
}
