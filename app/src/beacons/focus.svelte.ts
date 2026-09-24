import { board } from "../model/board.svelte";
import { ME_OBJECT_ID } from "../model/link";
import { selection } from "../selection/selection.svelte";
import { editing } from "../notes/editing.svelte";
import { links } from "../model/links.svelte";
import { selectLinks, selectedLinkIds } from "../links/selection.svelte";
import { beaconState } from "./beaconState.svelte";
import { beaconDescendants } from "./coverage";

export function isBeacon(id: string): boolean {
  return id === ME_OBJECT_ID || board.notes[id]?.type === "beacon";
}

export function allBeacons(): string[] {
  return [ME_OBJECT_ID, ...board.order.filter((id) => board.notes[id]?.type === "beacon")];
}

export function selectedBeacons(): string[] {
  const selected = selection.ids.filter(isBeacon);
  return selected.length ? selected : selection.ids.length === 0 ? [ME_OBJECT_ID] : [];
}

export function validFocused(): string[] {
  return beaconState.focused.filter(isBeacon);
}

export function visibleInFocus(): Set<string> | null {
  const focused = validFocused();
  if (!focused.length) return null;
  const visible = new Set(focused);
  for (const id of focused) for (const descendant of beaconDescendants(id)) visible.add(descendant);
  return visible;
}

export function isDimmed(objectId: string): boolean {
  const visible = visibleInFocus();
  return visible !== null && !visible.has(objectId);
}

export function setFocused(id: string, enabled: boolean): void {
  if (!isBeacon(id)) return;
  const next = validFocused().filter((focusedId) => focusedId !== id);
  if (enabled) next.push(id);
  beaconState.focused = next;
  releaseDimmedSelection();
}

export function toggleSelectedFocus(): void {
  const selected = selectedBeacons();
  if (!selected.length) return;
  const current = validFocused();
  const remove = selected.every((id) => current.includes(id));
  beaconState.focused = remove
    ? current.filter((id) => !selected.includes(id))
    : [...current, ...selected.filter((id) => !current.includes(id))];
  releaseDimmedSelection();
}

export function clearFocus(): void {
  beaconState.focused = [];
}

export function selectBeaconGroups(): void {
  const selected = selectedBeacons();
  if (!selected.length) return;
  const group = new Set<string>();
  for (const id of selected) {
    group.add(id);
    for (const descendant of beaconDescendants(id)) group.add(descendant);
  }
  selection.ids = [...group];
  selection.primaryId = selected[0] ?? null;
}

function releaseDimmedSelection(): void {
  const visible = visibleInFocus();
  if (!visible) return;
  const ids = selection.ids.filter((id) => visible.has(id));
  if (ids.length !== selection.ids.length) {
    selection.ids = ids;
    if (!selection.primaryId || !ids.includes(selection.primaryId)) selection.primaryId = ids.at(-1) ?? null;
  }
  if (editing.noteId && !visible.has(editing.noteId)) editing.noteId = null;
  const linkIds = selectedLinkIds();
  const keptLinks = linkIds.filter((id) => {
    const link = links.byId[id];
    return link && visible.has(link.from) && visible.has(link.to);
  });
  if (keptLinks.length !== linkIds.length) selectLinks(keptLinks);
}

export function beaconName(id: string): string {
  return id === ME_OBJECT_ID ? "ME" : board.notes[id]?.name ?? "Unknown beacon";
}
