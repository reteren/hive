import type { Point } from "../board/cameraMath";
import { board, updateNote } from "../model/board.svelte";
import { execute } from "../history/history.svelte";
import { clampImageOpacity, normalizeImageOpacity } from "./imageLogic";

export interface ImageOpacityPopoverState {
  noteId: string;
  x: number;
  y: number;
  zoomAtOpen: number;
  before: number;
  value: number;
}

export const imageOpacityPopover = $state({ current: null as ImageOpacityPopoverState | null });

export function openImageOpacityPopover(noteId: string, anchor: Point, zoomAtOpen: number): void {
  closeImageOpacityPopover();
  const note = board.notes[noteId];
  if (note?.type !== "image") return;
  const opacity = normalizeImageOpacity(note.opacity) ?? 1;
  imageOpacityPopover.current = {
    noteId,
    x: anchor.x,
    y: anchor.y,
    zoomAtOpen,
    before: opacity,
    value: opacity,
  };
}

/** Update the rendered picture during a drag without adding history entries. */
export function previewImageOpacity(value: number): void {
  const current = imageOpacityPopover.current;
  if (!current || board.notes[current.noteId]?.type !== "image") return;
  const opacity = clampImageOpacity(value);
  current.value = opacity;
  updateNote(current.noteId, { opacity: opacity < 1 ? opacity : undefined });
}

/** Commit the complete drag as one Undo step. */
export function commitImageOpacity(value: number): void {
  const current = imageOpacityPopover.current;
  if (!current) return;
  const opacity = clampImageOpacity(value);
  previewImageOpacity(opacity);
  imageOpacityPopover.current = null;

  const note = board.notes[current.noteId];
  if (!note || note.type !== "image" || opacity === current.before) return;
  const before = current.before < 1 ? current.before : undefined;
  const after = opacity < 1 ? opacity : undefined;
  execute({
    label: "Change image opacity",
    target: note.name,
    do: () => updateNote(current.noteId, { opacity: after }),
    undo: () => updateNote(current.noteId, { opacity: before }),
  });
}

/** Cancel an unfinished drag when the popover is dismissed. */
export function closeImageOpacityPopover(): void {
  const current = imageOpacityPopover.current;
  imageOpacityPopover.current = null;
  if (!current) return;
  const note = board.notes[current.noteId];
  if (note?.type !== "image") return;
  const opacity = normalizeImageOpacity(note.opacity) ?? 1;
  if (opacity !== current.before) {
    updateNote(current.noteId, { opacity: current.before < 1 ? current.before : undefined });
  }
}
