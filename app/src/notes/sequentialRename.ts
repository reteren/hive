export interface SequentialRenameItem {
  id: string;
  name: string;
}

export interface SequentialRenameSession {
  items: SequentialRenameItem[];
  index: number;
  draft: string;
}

export interface SequentialRenameChange {
  id: string;
  previousName: string;
  nextName: string;
}

/** Snapshot the selected IDs in selection order, omitting missing and duplicate IDs. */
export function createSequentialRename(
  selectedIds: readonly string[],
  namesById: Readonly<Record<string, string>>,
): SequentialRenameSession | null {
  const seen = new Set<string>();
  const items: SequentialRenameItem[] = [];
  for (const id of selectedIds) {
    if (seen.has(id) || typeof namesById[id] !== "string") continue;
    seen.add(id);
    items.push({ id, name: namesById[id] });
  }
  return items.length > 0 ? { items, index: 0, draft: items[0].name } : null;
}

/** Commit the current item and advance, or return the rename change for history. */
export function commitSequentialRename(
  session: SequentialRenameSession,
  nextName: string,
): { session: SequentialRenameSession | null; change: SequentialRenameChange | null } {
  const current = session.items[session.index];
  if (!current) return { session: null, change: null };
  const change = nextName === current.name
    ? null
    : { id: current.id, previousName: current.name, nextName };
  return { session: advanceSequentialRename(session), change };
}

/** Escape skips exactly the current note while preserving already committed renames. */
export function skipSequentialRename(session: SequentialRenameSession): SequentialRenameSession | null {
  return advanceSequentialRename(session);
}

function advanceSequentialRename(session: SequentialRenameSession): SequentialRenameSession | null {
  const index = session.index + 1;
  if (index >= session.items.length) return null;
  return { items: session.items, index, draft: session.items[index].name };
}
