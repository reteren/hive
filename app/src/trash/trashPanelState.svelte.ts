export const trashPanel = $state({ open: false });

export function toggleTrashPanel(): void {
  trashPanel.open = !trashPanel.open;
}

export function closeTrashPanel(): void {
  trashPanel.open = false;
}
