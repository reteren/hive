export const selectedLink = $state({ id: null as string | null, ids: [] as string[] });
let lastManagedPrimary: string | null = null;

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
