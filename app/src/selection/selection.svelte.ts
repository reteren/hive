import { registerCommand } from "../commands/registry.svelte";
import { execute } from "../history/history.svelte";
import { screenToWorld, type Point } from "../board/cameraMath";
import { camera } from "../board/camera.svelte";
import { fitBoardPopupAnchor } from "../ui/boardAnchor";
import type { Bounds } from "../notes/layout.svelte";

/** A reversible snapshot of the board selection, including registered selection domains. */
export interface SelectionSnapshot {
  ids: string[];
  zoneIds: string[];
  primaryId: string | null;
  /** Optional state owned by independent selection stores, such as selected links. */
  extensions?: Record<string, unknown>;
}

export interface SelectionSnapshotExtension {
  capture(): unknown;
  apply(snapshot: unknown): void;
  empty?(): unknown;
  equals?(first: unknown, second: unknown): boolean;
}

export interface ContextPickState {
  noteIds: string[];
  /** World-space popup corner, captured when the overlapping-note picker opens. */
  x: number;
  y: number;
  zoomAtOpen: number;
}

export const selection = $state({
  /** Note and beacon ids only; other commands rely on this distinction. */
  ids: [] as string[],
  /** Zone selection remains separate from note and beacon selection. */
  zoneIds: [] as string[],
  /** Selection order follows user additions; primaryId owns note resize handles. */
  primaryId: null as string | null,
  marquee: null as Bounds | null,
  contextPick: null as ContextPickState | null,
  grabActive: false,
});

export interface SelectionController {
  escape(): void;
  startGrab(): void;
  startScale(): void;
}

export type SelectionInteractionSource = "click" | "marquee" | "editing" | "move";

export type SelectionInteractionListener = (
  noteIds: readonly string[],
  source: SelectionInteractionSource,
) => void;

let controller: SelectionController | null = null;
const selectionExtensions = new Map<string, SelectionSnapshotExtension>();
const selectionInteractionListeners = new Set<SelectionInteractionListener>();

/** Subscribe to explicit note interactions without treating programmatic selection as user input. */
export function registerSelectionInteractionListener(listener: SelectionInteractionListener): () => void {
  selectionInteractionListeners.add(listener);
  return () => selectionInteractionListeners.delete(listener);
}

export function notifySelectionInteraction(
  noteIds: readonly string[],
  source: SelectionInteractionSource,
): void {
  const uniqueIds = [...new Set(noteIds)];
  if (uniqueIds.length === 0) return;
  for (const listener of selectionInteractionListeners) listener(uniqueIds, source);
}

/** Add another selection domain to snapshots without coupling its store to this module. */
export function registerSelectionSnapshotExtension(
  key: string,
  extension: SelectionSnapshotExtension,
): () => void {
  selectionExtensions.set(key, extension);
  return () => {
    if (selectionExtensions.get(key) === extension) selectionExtensions.delete(key);
  };
}

/** Capture selection for commands that must restore it as part of their own Undo step. */
export function captureSelectionSnapshot(): SelectionSnapshot {
  const extensions: Record<string, unknown> = {};
  for (const [key, extension] of selectionExtensions) {
    extensions[key] = cloneValue(extension.capture());
  }
  return {
    ids: [...selection.ids],
    zoneIds: [...selection.zoneIds],
    primaryId: selection.primaryId,
    extensions,
  };
}

/** Restore a snapshot raw, for use inside another command's do/undo. */
export function restoreSelectionSnapshot(snapshot: SelectionSnapshot): void {
  applySelectionSnapshot(snapshot);
}

/** Return a selection snapshot with every registered secondary selection cleared. */
export function clearSelectionSnapshotExtensions(snapshot: SelectionSnapshot): SelectionSnapshot {
  const extensions = { ...snapshot.extensions };
  for (const [key, extension] of selectionExtensions) {
    if (extension.empty) extensions[key] = cloneValue(extension.empty());
  }
  return { ...snapshot, extensions };
}

/** Derive the next snapshot from the current one, then record it as a single Select step. */
export function changeSelectionUndoable(
  update: (next: SelectionSnapshot) => void,
  label?: string,
  clearOtherDomains = false,
): boolean {
  const next = captureSelectionSnapshot();
  update(next);
  return setSelectionUndoable(clearOtherDomains ? clearSelectionSnapshotExtensions(next) : next, label);
}

/** Clear note, zone, and registered link selections as one user-visible action. */
export function clearSelectionUndoable(): boolean {
  selection.marquee = null;
  selection.contextPick = null;
  return changeSelectionUndoable((next) => {
    next.ids = [];
    next.zoneIds = [];
    next.primaryId = null;
  }, undefined, true);
}

/** Record one user-facing selection change; unchanged snapshots do not consume history. */
export function setSelectionUndoable(next: SelectionSnapshot, label?: string): boolean {
  const before = captureSelectionSnapshot();
  const after = cloneSelectionSnapshot(next, before);
  if (sameSelectionSnapshot(before, after)) return false;

  execute({
    label: label ?? defaultSelectionLabel(before, after),
    do: () => applySelectionSnapshot(after),
    undo: () => applySelectionSnapshot(before),
  });
  return true;
}

function cloneSelectionSnapshot(snapshot: SelectionSnapshot, current: SelectionSnapshot): SelectionSnapshot {
  const extensions = { ...current.extensions };
  for (const [key, value] of Object.entries(snapshot.extensions ?? {})) {
    extensions[key] = cloneValue(value);
  }
  return {
    ids: [...snapshot.ids],
    zoneIds: [...snapshot.zoneIds],
    primaryId: snapshot.primaryId,
    extensions,
  };
}

function applySelectionSnapshot(snapshot: SelectionSnapshot): void {
  selection.ids = [...snapshot.ids];
  selection.zoneIds = [...snapshot.zoneIds];
  selection.primaryId = snapshot.primaryId;
  for (const [key, extension] of selectionExtensions) {
    if (Object.prototype.hasOwnProperty.call(snapshot.extensions ?? {}, key)) {
      extension.apply(cloneValue(snapshot.extensions?.[key]));
    }
  }
}

function sameSelectionSnapshot(first: SelectionSnapshot, second: SelectionSnapshot): boolean {
  if (!sameStrings(first.ids, second.ids) ||
    !sameStrings(first.zoneIds, second.zoneIds) ||
    first.primaryId !== second.primaryId) return false;

  const keys = new Set([...Object.keys(first.extensions ?? {}), ...Object.keys(second.extensions ?? {})]);
  for (const key of keys) {
    const extension = selectionExtensions.get(key);
    const firstValue = first.extensions?.[key];
    const secondValue = second.extensions?.[key];
    const equal = extension?.equals
      ? extension.equals(firstValue, secondValue)
      : sameValue(firstValue, secondValue);
    if (!equal) return false;
  }
  return true;
}

function defaultSelectionLabel(before: SelectionSnapshot, after: SelectionSnapshot): string {
  const count = after.ids.length + after.zoneIds.length + selectedExtensionCount(after);
  const previousCount = before.ids.length + before.zoneIds.length + selectedExtensionCount(before);
  if (count === 0 && previousCount > 0) return "Deselect";
  return `Select ${count} ${count === 1 ? "object" : "objects"}`;
}

function selectedExtensionCount(snapshot: SelectionSnapshot): number {
  let count = 0;
  for (const key of selectionExtensions.keys()) {
    const value = snapshot.extensions?.[key];
    if (Array.isArray(value)) count += value.length;
    else if (value && typeof value === "object" && "ids" in value && Array.isArray(value.ids)) {
      count += value.ids.length;
    } else if (value !== undefined && value !== null) count += 1;
  }
  return count;
}

function sameStrings(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function sameValue(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (Array.isArray(first) && Array.isArray(second)) {
    return first.length === second.length && first.every((value, index) => sameValue(value, second[index]));
  }
  if (!first || !second || typeof first !== "object" || typeof second !== "object") return false;
  const firstEntries = Object.entries(first);
  const secondRecord = second as Record<string, unknown>;
  return firstEntries.length === Object.keys(secondRecord).length &&
    firstEntries.every(([key, value]) => Object.prototype.hasOwnProperty.call(secondRecord, key) && sameValue(value, secondRecord[key]));
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
  }
  return value;
}

export function attachSelectionController(next: SelectionController): () => void {
  controller = next;
  return () => {
    if (controller === next) controller = null;
  };
}

export function selectOnly(id: string): void {
  selection.ids = [id];
  selection.zoneIds = [];
  selection.primaryId = id;
}

export function selectZonesOnly(ids: readonly string[]): void {
  selection.ids = [];
  selection.primaryId = null;
  selection.zoneIds = [...new Set(ids)];
}

export function toggleZoneSelected(id: string): boolean {
  if (selection.zoneIds.includes(id)) {
    selection.zoneIds = selection.zoneIds.filter((selectedId) => selectedId !== id);
    return false;
  }
  selection.zoneIds = [...selection.zoneIds, id];
  return true;
}

export function clearZoneSelection(): void {
  selection.zoneIds = [];
}

/** Select an id without changing other members; clicking it also makes it primary. */
export function includeSelected(id: string): void {
  if (!selection.ids.includes(id)) selection.ids = [...selection.ids, id];
  selection.primaryId = id;
}

export function setPrimary(id: string): void {
  if (selection.ids.includes(id)) selection.primaryId = id;
}

export function toggleSelected(id: string): boolean {
  if (selection.ids.includes(id)) {
    selection.ids = selection.ids.filter((selectedId) => selectedId !== id);
    if (selection.primaryId === id) selection.primaryId = selection.ids.at(-1) ?? null;
    return false;
  }

  includeSelected(id);
  return true;
}

export function selectMarquee(ids: readonly string[], additive: boolean, zoneIds: readonly string[] = []): void {
  if (!additive) {
    selection.ids = [...ids];
    selection.zoneIds = [...zoneIds];
    selection.primaryId = ids.at(-1) ?? null;
    return;
  }

  const merged = [...selection.ids];
  for (const id of ids) {
    if (!merged.includes(id)) merged.push(id);
  }
  selection.ids = merged;
  selection.zoneIds = [...new Set([...selection.zoneIds, ...zoneIds])];
  if (ids.length > 0) selection.primaryId = ids.at(-1) ?? null;
}

export function clearSelection(): void {
  selection.ids = [];
  selection.zoneIds = [];
  selection.primaryId = null;
  selection.marquee = null;
  selection.contextPick = null;
}

export function setMarquee(marquee: Bounds | null): void {
  selection.marquee = marquee;
}

export function setContextPick(noteIds: readonly string[], point: Point, viewport: { width: number; height: number }): void {
  const width = 184;
  const estimatedHeight = Math.min(240, noteIds.length * 30 + 12);
  const zoomAtOpen = camera.zoom;
  const anchor = fitBoardPopupAnchor(camera, viewport, screenToWorld(camera, viewport, point), { width, height: estimatedHeight });
  selection.contextPick = {
    noteIds: [...noteIds],
    x: anchor.x,
    y: anchor.y,
    zoomAtOpen,
  };
}

export function closeContextPick(): void {
  selection.contextPick = null;
}

registerCommand({
  id: "select.clear",
  label: "Clear Selection",
  keys: ["Escape"],
  run: () => {
    if (controller) controller.escape();
    else clearSelectionUndoable();
  },
});

registerCommand({
  id: "select.move",
  label: "Move Selection",
  keys: ["KeyG"],
  run: () => controller?.startGrab(),
});

registerCommand({
  id: "select.scale",
  label: "Scale Selection",
  keys: ["KeyS"],
  run: () => controller?.startScale(),
});
