import { execute } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import { selection } from "../selection/selection.svelte";
import { commandSearchState } from "../commands/commandSearch.svelte";
import { uniqueName } from "./naming";
import {
  commitSequentialRename,
  createSequentialRename,
  skipSequentialRename,
  type SequentialRenameSession,
} from "./sequentialRename";

export const sequentialRenameState = $state({
  session: null as SequentialRenameSession | null,
  returnFocus: null as HTMLElement | null,
});

export function startSequentialRename(): void {
  const active = document.activeElement;
  sequentialRenameState.returnFocus = commandSearchState.open
    ? commandSearchState.returnFocus
    : active instanceof HTMLElement && active !== document.body
      ? active
      : null;
  const namesById = Object.fromEntries(
    Object.values(board.notes).map((note) => [note.id, note.name]),
  );
  sequentialRenameState.session = createSequentialRename(selection.ids, namesById);
}

export function takeSequentialRenameReturnFocus(): HTMLElement | null {
  const returnFocus = sequentialRenameState.returnFocus;
  sequentialRenameState.returnFocus = null;
  return returnFocus;
}

export function commitCurrentRename(): void {
  const session = sequentialRenameState.session;
  const current = session?.items[session.index];
  if (!session || !current) {
    sequentialRenameState.session = null;
    return;
  }

  const note = board.notes[current.id];
  if (!note) {
    sequentialRenameState.session = skipSequentialRename(session);
    return;
  }

  const names = Object.values(board.notes)
    .filter((other) => other.id !== note.id)
    .map((other) => other.name);
  const nextName = uniqueName(session.draft, names);
  const result = commitSequentialRename(session, nextName);

  if (result.change) {
    const { id, previousName, nextName: committedName } = result.change;
    execute({
      label: "Rename",
      target: committedName,
      do: () => updateNote(id, { name: committedName }),
      undo: () => updateNote(id, { name: previousName }),
    });
  }

  sequentialRenameState.session = result.session;
}

export function skipCurrentRename(): void {
  const session = sequentialRenameState.session;
  if (session) sequentialRenameState.session = skipSequentialRename(session);
}
