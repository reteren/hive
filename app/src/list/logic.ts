import type { ListItem } from "../model/nodeData";
import type { Note } from "../model/note";

export function copyListItems(items: readonly ListItem[]): ListItem[] {
  return items.map((item) => ({ ...item }));
}

export function insertListItem(items: readonly ListItem[], item: ListItem, index = items.length): ListItem[] {
  const next = copyListItems(items);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, { ...item });
  return next;
}

export function removeListItem(items: readonly ListItem[], itemId: string): ListItem[] {
  return copyListItems(items.filter((item) => item.id !== itemId));
}

/** targetIndex is an insertion slot in the original list, before removing the dragged row. */
export function reorderListItem(items: readonly ListItem[], itemId: string, targetIndex: number): ListItem[] {
  const from = items.findIndex((item) => item.id === itemId);
  if (from < 0) return copyListItems(items);
  const next = copyListItems(items);
  const [item] = next.splice(from, 1);
  const slot = Math.max(0, Math.min(targetIndex, items.length));
  next.splice(Math.max(0, Math.min(slot > from ? slot - 1 : slot, next.length)), 0, item);
  return next;
}

export function listItemDisplay(item: ListItem, notes: Readonly<Record<string, Note>>): { label: string; missing: boolean } {
  if (item.targetId === null) return { label: item.label, missing: false };
  const target = notes[item.targetId];
  return target ? { label: target.name, missing: false } : { label: item.label, missing: true };
}

/** Missing targets cannot be chosen; plain text rows and live targets can. */
export function eligibleListItems(items: readonly ListItem[], notes: Readonly<Record<string, Note>>): ListItem[] {
  return items.filter((item) => item.targetId === null
    ? item.label.trim().length > 0
    : Boolean(notes[item.targetId]));
}
