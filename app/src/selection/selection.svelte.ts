import { registerCommand } from "../commands/registry.svelte";
import type { Point } from "../board/cameraMath";
import type { Bounds } from "../notes/layout.svelte";

export interface ContextPickState {
  noteIds: string[];
  x: number;
  y: number;
}

export const selection = $state({
  /** Selection order follows user additions; primaryId owns the resize handles. */
  ids: [] as string[],
  primaryId: null as string | null,
  marquee: null as Bounds | null,
  contextPick: null as ContextPickState | null,
  grabActive: false,
});

export interface SelectionController {
  escape(): void;
  startGrab(): void;
}

let controller: SelectionController | null = null;

export function attachSelectionController(next: SelectionController): () => void {
  controller = next;
  return () => {
    if (controller === next) controller = null;
  };
}

export function selectOnly(id: string): void {
  selection.ids = [id];
  selection.primaryId = id;
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

export function selectMarquee(ids: readonly string[], additive: boolean): void {
  if (!additive) {
    selection.ids = [...ids];
    selection.primaryId = ids.at(-1) ?? null;
    return;
  }

  const merged = [...selection.ids];
  for (const id of ids) {
    if (!merged.includes(id)) merged.push(id);
  }
  selection.ids = merged;
  if (ids.length > 0) selection.primaryId = ids.at(-1) ?? null;
}

export function clearSelection(): void {
  selection.ids = [];
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
  selection.contextPick = {
    noteIds: [...noteIds],
    x: Math.max(8, Math.min(point.x + 8, viewport.width - width - 8)),
    y: Math.max(8, Math.min(point.y + 8, viewport.height - estimatedHeight - 8)),
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
    else clearSelection();
  },
});

registerCommand({
  id: "select.move",
  label: "Move Selection",
  keys: ["KeyG"],
  run: () => controller?.startGrab(),
});
