import { execute, type HistoryCommand } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import { newId } from "../model/note";
import type { ListItem } from "../model/nodeData";
import { zones } from "../model/zones.svelte";
import { copyListItems, insertListItem, removeListItem as withoutItem, reorderListItem as reordered } from "./logic";

export function itemsForList(listId: string): ListItem[] {
  const note = board.notes[listId];
  return note?.type === "list" ? copyListItems(note.listItems ?? []) : [];
}

export function createListChangeCommand(listId: string, label: string, nextItems: readonly ListItem[]): HistoryCommand | null {
  const list = board.notes[listId];
  if (list?.type !== "list") return null;
  const before = itemsForList(listId);
  const after = copyListItems(nextItems);
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  return {
    label,
    target: list.name,
    do: () => updateNote(listId, { listItems: copyListItems(after) }),
    undo: () => updateNote(listId, { listItems: copyListItems(before) }),
  };
}

export function addListTargetCommand(listId: string, targetId: string, index?: number): HistoryCommand | null {
  const list = board.notes[listId];
  const target = board.notes[targetId] ?? zones.byId[targetId];
  if (list?.type !== "list" || !target || listId === targetId) return null;
  const item: ListItem = { id: newId(), targetId, label: target.name };
  return createListChangeCommand(listId, "Add List link", insertListItem(itemsForList(listId), item, index));
}

export function addListTarget(listId: string, targetId: string): boolean {
  const command = addListTargetCommand(listId, targetId);
  if (!command) return false;
  execute(command);
  return true;
}

export function addListText(listId: string, label: string): boolean {
  const clean = label.trim();
  if (!clean) return false;
  const item: ListItem = { id: newId(), targetId: null, label: clean };
  const command = createListChangeCommand(listId, "Add List text", insertListItem(itemsForList(listId), item));
  if (!command) return false;
  execute(command);
  return true;
}

export function removeListRow(listId: string, itemId: string): boolean {
  const command = createListChangeCommand(listId, "Remove List row", withoutItem(itemsForList(listId), itemId));
  if (!command) return false;
  execute(command);
  return true;
}

export function reorderListRow(listId: string, itemId: string, targetIndex: number): boolean {
  const command = createListChangeCommand(listId, "Reorder List rows", reordered(itemsForList(listId), itemId, targetIndex));
  if (!command) return false;
  execute(command);
  return true;
}
