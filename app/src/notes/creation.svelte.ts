export const creationMenu = $state({
  open: false,
  pinned: false,
});

export function closeCreationMenu(): void {
  creationMenu.open = false;
  creationMenu.pinned = false;
}
