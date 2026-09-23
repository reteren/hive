import { commandSearchReturnFocus, commandSearchState } from "./commandSearch.svelte";

export const keymapPanelState = $state({
  open: false,
  returnFocus: null as HTMLElement | null,
});

export function openKeymapPanel(): void {
  if (keymapPanelState.open) return;
  const active = document.activeElement;
  const savedTarget = commandSearchState.open
    ? commandSearchReturnFocus()
    : active instanceof HTMLElement && active !== document.body
      ? active
      : null;
  keymapPanelState.returnFocus = savedTarget;
  keymapPanelState.open = true;
}

export function closeKeymapPanel(): HTMLElement | null {
  const returnFocus = keymapPanelState.returnFocus;
  keymapPanelState.returnFocus = null;
  keymapPanelState.open = false;
  return returnFocus;
}
