import type { ListItem } from "../model/nodeData";
import type { Note } from "../model/note";
import type { Zone } from "../model/zone";

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

export function listItemDisplay(item: ListItem, notes: Readonly<Record<string, Note>>, zones: Readonly<Record<string, Zone>> = {}): { label: string; missing: boolean } {
  if (item.targetId === null) return { label: item.label, missing: false };
  const target = notes[item.targetId] ?? zones[item.targetId];
  return target ? { label: target.name, missing: false } : { label: item.label, missing: true };
}

/** Missing targets cannot be chosen; plain text rows and live targets can. */
export function eligibleListItems(items: readonly ListItem[], notes: Readonly<Record<string, Note>>): ListItem[] {
  return items.filter((item) => item.targetId === null
    ? item.label.trim().length > 0
    : Boolean(notes[item.targetId]));
}

/** Insertion slot amongst the remaining rows; the dragged source is already excluded. */
export function listInsertionIndexAt(y: number, heights: readonly number[], gap = 2, openSlot?: { index: number; height: number }): number {
  if (openSlot) {
    const slotTop = heights.slice(0, openSlot.index).reduce((sum, height) => sum + Math.max(0, height) + gap, 0);
    if (y >= slotTop && y <= slotTop + openSlot.height + gap) return openSlot.index;
    if (y > slotTop) y -= openSlot.height + gap;
  }
  let top = 0;
  for (let index = 0; index < heights.length; index += 1) {
    const height = Math.max(0, heights[index]);
    if (y < top + height / 2) return index;
    top += height + gap;
  }
  return heights.length;
}
