export const commandSearchState = $state({
  open: false,
  returnFocus: null as HTMLElement | null,
});

export function openCommandSearch(): void {
  if (commandSearchState.open) return;
  const active = document.activeElement;
  commandSearchState.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
  commandSearchState.open = true;
}

/** Hide the palette and return its saved focus target for restoration after the UI flush. */
export function closeCommandSearch(): HTMLElement | null {
  const returnFocus = commandSearchState.returnFocus;
  commandSearchState.returnFocus = null;
  commandSearchState.open = false;
  return returnFocus;
}

export function commandSearchReturnFocus(): HTMLElement | null {
  return commandSearchState.returnFocus;
}
