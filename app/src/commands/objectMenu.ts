import { runCommand } from "./registry.svelte";
import { clearSelectedLink } from "../links/selection.svelte";
import { board } from "../model/board.svelte";
import { selection, clearSelection, selectOnly, selectZonesOnly } from "../selection/selection.svelte";
import type { Point } from "../board/cameraMath";
import { tool } from "../tools/tool.svelte";
import { activateZoneResizeFromMenu, requestZoneMove, setZoneToolMode } from "../zones/zoneMode.svelte";
import { zones } from "../model/zones.svelte";

/** Preserve a current multi-selection; otherwise make the menu target the only selection. */
export function selectNoteForMenuAction(noteId: string): boolean {
  if (!board.notes[noteId]) return false;
  if (!selection.ids.includes(noteId)) {
    clearSelection();
    clearSelectedLink();
    selectOnly(noteId);
  }
  return true;
}

/** Preserve a current multi-selection; otherwise make the menu zone the only selection. */
export function selectZoneForMenuAction(zoneId: string): boolean {
  if (!zones.byId[zoneId]) return false;
  if (!selection.zoneIds.includes(zoneId)) {
    clearSelection();
    clearSelectedLink();
    selectZonesOnly([zoneId]);
  }
  return true;
}

export function runNoteMenuCommand(noteId: string, commandId: string): void {
  if (!selectNoteForMenuAction(noteId)) return;
  runCommand(commandId);
}

export function runZoneMenuAction(
  zoneId: string,
  action: "scale" | "grab",
  startWorld?: Point,
): void {
  if (!selectZoneForMenuAction(zoneId)) return;

  if (action === "scale") {
    activateZoneResizeFromMenu(zoneId);
  } else if (action === "grab") {
    if (!startWorld) return;
    tool.active = "zone";
    setZoneToolMode("move");
    requestZoneMove({ zoneId, startWorld });
  }
}
