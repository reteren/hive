import {
  captureSelectionSnapshot,
  registerSelectionSnapshotExtension,
  setSelectionUndoable,
  type SelectionSnapshot,
} from "../selection/selection.svelte";

export const selectedLink = $state({ id: null as string | null, ids: [] as string[] });
let lastManagedPrimary: string | null = null;

interface LinkSelectionSnapshot {
  id: string | null;
  ids: string[];
}

const LINK_SELECTION_EXTENSION = "links";
registerSelectionSnapshotExtension(LINK_SELECTION_EXTENSION, {
  capture: (): LinkSelectionSnapshot => ({ id: selectedLinkIds().at(-1) ?? null, ids: selectedLinkIds() }),
  empty: (): LinkSelectionSnapshot => ({ id: null, ids: [] }),
  apply: (value) => {
    const snapshot = value as LinkSelectionSnapshot;
    const ids = [...new Set(snapshot?.ids ?? [])];
    const id = snapshot?.id && ids.includes(snapshot.id) ? snapshot.id : ids.at(-1) ?? null;
    selectedLink.ids = ids;
    selectedLink.id = id;
    lastManagedPrimary = id;
  },
  equals: (first, second) => {
    const left = first as LinkSelectionSnapshot | undefined;
    const right = second as LinkSelectionSnapshot | undefined;
    return left?.id === right?.id &&
      (left?.ids ?? []).length === (right?.ids ?? []).length &&
      (left?.ids ?? []).every((id, index) => id === right?.ids?.[index]);
  },
});

/** Change line selection as one step with note and zone deselection when requested. */
export function setLinkSelectionUndoable(ids: readonly string[], clearObjects = false): boolean {
  const current = captureSelectionSnapshot();
  const unique = [...new Set(ids)];
  const extensions = {
    ...current.extensions,
    [LINK_SELECTION_EXTENSION]: { id: unique.at(-1) ?? null, ids: unique },
  };
  const next: SelectionSnapshot = {
    ...current,
    ...(clearObjects ? { ids: [], zoneIds: [], primaryId: null } : {}),
    extensions,
  };
  return setSelectionUndoable(next);
}

export function selectLinkUndoable(id: string, additive = false, clearObjects = false): boolean {
  const current = selectedLinkIds();
  const next = additive
    ? current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]
    : [id];
  return setLinkSelectionUndoable(next, clearObjects);
}

export function selectLinksUndoable(ids: readonly string[], additive = false, clearObjects = false): boolean {
  const unique = [...new Set(ids)];
  const next = additive ? [...new Set([...selectedLinkIds(), ...unique])] : unique;
  return setLinkSelectionUndoable(next, clearObjects);
}

export function clearLinkSelectionUndoable(clearObjects = false): boolean {
  return setLinkSelectionUndoable([], clearObjects);
}

export function selectLink(id: string): void {
  selectedLink.id = id;
  selectedLink.ids = [id];
  lastManagedPrimary = id;
}

export function selectLinks(ids: readonly string[], additive = false): void {
  const unique = [...new Set(ids)];
  const next = additive ? [...new Set([...selectedLinkIds(), ...unique])] : unique;
  selectedLink.ids = next;
  selectedLink.id = next.at(-1) ?? null;
  lastManagedPrimary = selectedLink.id;
}

export function toggleLinkSelection(id: string): void {
  const ids = selectedLinkIds();
  selectLinks(ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id]);
}

/** Current selection, with compatibility for older call sites that set `id` directly. */
export function selectedLinkIds(): string[] {
  if (selectedLink.id !== lastManagedPrimary) {
    selectedLink.ids = selectedLink.id === null ? [] : [selectedLink.id];
    lastManagedPrimary = selectedLink.id;
  }
  if (selectedLink.id === null) return [];
  return [...selectedLink.ids];
}

export function clearSelectedLink(): void {
  selectedLink.id = null;
  selectedLink.ids = [];
  lastManagedPrimary = null;
}
