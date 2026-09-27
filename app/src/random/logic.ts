import type { Link } from "../model/link";
import type { ListItem, RandomPick } from "../model/nodeData";
import type { Note } from "../model/note";
import { eligibleListItems, listItemDisplay } from "../list/logic";

/** The source of a Random Choice is the first strong List → Random link. */
export function linkedListForRandom(
  randomId: string,
  notes: Readonly<Record<string, Note>>,
  links: readonly Link[],
): Note | null {
  const link = links.find((item) => item.kind === "strong" && item.to === randomId && notes[item.from]?.type === "list");
  return link ? notes[link.from] : null;
}

export function choicesForRandom(list: Note, notes: Readonly<Record<string, Note>>): ListItem[] {
  return list.type === "list" ? eligibleListItems(list.listItems ?? [], notes) : [];
}

/** Pure, injectable RNG for an unbiased index when rng is uniform on [0, 1). */
export function chooseRandomItem(items: readonly ListItem[], rng: () => number): ListItem | null {
  if (items.length === 0) return null;
  const value = rng();
  if (!Number.isFinite(value)) return null;
  const index = Math.floor(Math.max(0, Math.min(value, 1 - Number.EPSILON)) * items.length);
  return items[index] ?? null;
}

export function currentRandomPick(
  pick: RandomPick | undefined,
  list: Note | null,
  notes: Readonly<Record<string, Note>>,
): { item: ListItem; label: string; missing: boolean } | null {
  if (!pick || !list || pick.listId !== list.id) return null;
  const item = (list.listItems ?? []).find((row) => row.id === pick.itemId);
  if (!item) return null;
  const display = listItemDisplay(item, notes);
  return { item, ...display };
}
