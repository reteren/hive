import { tick } from "svelte";
import { closeCommandSearch, commandSearchState } from "../../commands/commandSearch.svelte";
import { closeUndoLog } from "../../history/history.svelte";
import { closeSearch, searchState } from "../../search/search.svelte";
import { closeTasksPanel } from "../../tasks/tasksPanelState.svelte";
import { closeTrashPanel } from "../../trash/trashPanelState.svelte";
import { closeObjectsPanel } from "../../navigation/panelState.svelte";

export type PanelPopupId = "undo-log" | "tasks" | "trash" | "objects";

export const panelPopupState = $state({
  active: null as PanelPopupId | null,
  returnFocus: null as HTMLElement | null,
});

const dockPanelClosers: Record<PanelPopupId, () => void> = {
  "undo-log": closeUndoLog,
  tasks: closeTasksPanel,
  trash: closeTrashPanel,
  objects: closeObjectsPanel,
};

export function togglePanelPopup(id: PanelPopupId): void {
  if (panelPopupState.active === id) {
    closePanelPopup();
    return;
  }

  if (panelPopupState.active === null) {
    const active = typeof document === "undefined" ? null : document.activeElement;
    panelPopupState.returnFocus = typeof HTMLElement !== "undefined" && active instanceof HTMLElement && active !== document.body
      ? active
      : null;
  }

  closeSearch();
  closeCommandSearch();
  dockPanelClosers[id]();
  panelPopupState.active = id;
}

export function closePanelPopup(restoreFocus = true): void {
  const target = panelPopupState.returnFocus;
  panelPopupState.active = null;
  panelPopupState.returnFocus = null;
  if (!restoreFocus) return;

  void tick().then(() => {
    if (target?.isConnected) {
      target.focus();
      return;
    }
    if (typeof document !== "undefined") document.querySelector<HTMLElement>(".board")?.focus();
  });
}

export function hasFloatingPopupOpen(): boolean {
  return panelPopupState.active !== null || searchState.open || commandSearchState.open;
}
