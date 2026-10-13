import {
  DEFAULT_CREATE_MENU_PREFERENCES,
  isStarrable,
  normalizeCreateMenuPreferences,
  withRecentCreateItem,
  type CreateItemId,
  type CreateMenuPreferences,
} from "./createMenuCatalog";

/** Starred and recently created items of the Q menu; saved with the view settings (per profile). */
export const createMenuPreferences: CreateMenuPreferences = $state({
  starred: [...DEFAULT_CREATE_MENU_PREFERENCES.starred],
  recent: [...DEFAULT_CREATE_MENU_PREFERENCES.recent],
});

export function setCreateMenuPreferences(value: unknown): void {
  const next = normalizeCreateMenuPreferences(value);
  createMenuPreferences.starred = next.starred;
  createMenuPreferences.recent = next.recent;
}

export function createMenuPreferencesSnapshot(): CreateMenuPreferences {
  return { starred: [...createMenuPreferences.starred], recent: [...createMenuPreferences.recent] };
}

export function isStarredCreateItem(id: CreateItemId): boolean {
  return createMenuPreferences.starred.includes(id);
}

/** Star puts the item next to Note at the top of the menu, outside the categories. */
export function toggleStarredCreateItem(id: CreateItemId): void {
  if (!isStarrable(id)) return;
  createMenuPreferences.starred = isStarredCreateItem(id)
    ? createMenuPreferences.starred.filter((entry) => entry !== id)
    : [...createMenuPreferences.starred, id];
}

export function recordCreatedItem(id: CreateItemId): void {
  createMenuPreferences.recent = withRecentCreateItem(createMenuPreferences.recent, id);
}
