import { writable } from "svelte/store";
import type { Point } from "../board/cameraMath";
import type { HistoryCommand } from "../history/history.svelte";

/** Identifies the visual area that will receive a board drag. */
export interface DropTargetMatch {
  targetId: string;
  ownerId: string;
  payload?: unknown;
}

export interface BoardDropTarget {
  ownerId: string;
  accepts(noteIds: readonly string[], worldPoint: Point): DropTargetMatch | null;
  drop(noteIds: readonly string[], match: DropTargetMatch): HistoryCommand | null;
}

export const activeDropTarget = writable<DropTargetMatch | null>(null);

const targets: BoardDropTarget[] = [];
let currentPreview: DropTargetMatch | null = null;

export function registerDropTarget(target: BoardDropTarget): () => void {
  targets.push(target);
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    const index = targets.indexOf(target);
    if (index >= 0) targets.splice(index, 1);
    if (currentPreview?.ownerId === target.ownerId) clearDropTargetPreview();
  };
}

export function previewDropTarget(noteIds: readonly string[], worldPoint: Point): void {
  currentPreview = resolveDropTarget(noteIds, worldPoint)?.match ?? null;
  activeDropTarget.set(currentPreview);
}

/** Returns a reversible command; the SelectionLayer decides whether to run it. */
export function dropOnTarget(noteIds: readonly string[], worldPoint: Point): HistoryCommand | null {
  const resolved = resolveDropTarget(noteIds, worldPoint);
  clearDropTargetPreview();
  return resolved?.target.drop(noteIds, resolved.match) ?? null;
}

export function clearDropTargetPreview(): void {
  currentPreview = null;
  activeDropTarget.set(null);
}

function resolveDropTarget(
  noteIds: readonly string[],
  worldPoint: Point,
): { target: BoardDropTarget; match: DropTargetMatch } | null {
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index];
    const match = target.accepts(noteIds, worldPoint);
    if (match) return { target, match };
  }
  return null;
}
