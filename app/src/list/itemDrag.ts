import { get, writable } from "svelte/store";
import type { Point } from "../board/cameraMath";

export type ContentSource =
  | { kind: "list"; noteId: string; itemId: string }
  | { kind: "tierlist"; noteId: string; rowId: string; cardId: string };
export type ContentTarget =
  | { kind: "list"; noteId: string; index: number }
  | { kind: "tierlist"; noteId: string; rowId: string; index: number };

export interface ContentDragPreview {
  source: ContentSource;
  target: ContentTarget | null;
  /** Height of the dragged row/card at zoom 1, for the receiving List's open slot. */
  height: number;
}

export const contentDragPreview = writable<ContentDragPreview | null>(null);
const targets: Array<(point: Point, source: ContentSource) => ContentTarget | null> = [];

export function registerContentDropTarget(resolve: (point: Point, source: ContentSource) => ContentTarget | null): () => void {
  targets.push(resolve);
  return () => {
    const index = targets.indexOf(resolve);
    if (index >= 0) targets.splice(index, 1);
  };
}

export function resolveContentDropTarget(point: Point, source: ContentSource): ContentTarget | null {
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index](point, source);
    if (target) return target;
  }
  return null;
}

export function beginContentDrag(source: ContentSource, height: number, target: ContentTarget | null = null): void {
  contentDragPreview.set({ source, target, height: Math.max(26, height) });
}

export function previewContentDrop(point: Point): ContentTarget | null {
  const preview = get(contentDragPreview);
  if (!preview) return null;
  const target = resolveContentDropTarget(point, preview.source);
  contentDragPreview.set({ ...preview, target });
  return target;
}

export function clearContentDrag(): void {
  contentDragPreview.set(null);
}
