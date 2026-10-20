import type { HistoryCommand } from "../history/historyStack";
import type { NodeScope } from "../model/nodeData";
import type { Note } from "../model/note";
import { sameScope } from "./scopeLogic";
import { t } from "../i18n/i18n.svelte";

/** Construct the single Undo step for an explicit ScopePicker choice. */
export function createScopeChangeCommand(
  note: Pick<Note, "id" | "name" | "scope">,
  nextScope: NodeScope,
  setScope: (noteId: string, scope: NodeScope | undefined) => void,
): HistoryCommand | null {
  const previousScope = note.scope;
  if (sameScope(previousScope, nextScope)) return null;

  return {
    label: t("Change scope"),
    target: note.name,
    do: () => setScope(note.id, nextScope),
    undo: () => setScope(note.id, previousScope),
  };
}
