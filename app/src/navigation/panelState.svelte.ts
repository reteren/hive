export const objectsPanel = $state({
  open: false,
  pinned: false,
  query: "",
  pinnedSearchIds: null as string[] | null,
  sort: "name" as "name" | "recent",
});

export function toggleObjectsPanel(): void {
  objectsPanel.open = !objectsPanel.open;
}

export function closeObjectsPanel(): void {
  objectsPanel.open = false;
}

/** Remove a project-specific pinned search while preserving the panel's visibility and sort. */
export function resetObjectsPanelSearch(): void {
  objectsPanel.pinned = false;
  objectsPanel.query = "";
  objectsPanel.pinnedSearchIds = null;
}
