import type { Point } from "../board/cameraMath";
import { camera } from "../board/camera.svelte";
import { board, updateNote } from "../model/board.svelte";
import type { NoteGlow } from "../model/note";
import { execute } from "../history/history.svelte";
import { selection } from "../selection/selection.svelte";
import { normalizeHex } from "../color/hex";
import { linkContext } from "../links-in-text/contextMenu.svelte";
import { registerNoteMenuItem } from "./noteMenu";
import {
  copyNoteGlow,
  defaultNoteGlow,
  mainNoteColor,
  MAX_GLOW_OPACITY,
  MAX_GLOW_SIZE,
  MIN_GLOW_OPACITY,
  MIN_GLOW_SIZE,
  parseNoteGlow,
} from "./noteGlowLogic";

export interface NoteGlowPopoverState {
  ids: string[];
  x: number;
  y: number;
  zoomAtOpen: number;
  before: Record<string, NoteGlow | undefined>;
  color: string;
  opacity: number;
  size: number;
  /** Per-node colours are populated by Color as main and retained while opacity/size changes. */
  colorsById: Record<string, string> | null;
}

export const noteGlowPopover = $state({ current: null as NoteGlowPopoverState | null });

/** The context node, or all existing selected nodes when it belongs to the selection. */
export function noteGlowTargets(noteId: string): string[] {
  const ids = selection.ids.includes(noteId) ? selection.ids : [noteId];
  return [...new Set(ids)].filter((id) => Boolean(board.notes[id] && board.notes[id]?.type !== "beacon"));
}

/** Apply a set of per-node glow values as one history command. */
export function setNoteGlows(values: ReadonlyMap<string, NoteGlow | undefined>): boolean {
  const changes = [...values.entries()].flatMap(([id, rawGlow]) => {
    const note = board.notes[id];
    const glow = rawGlow === undefined ? undefined : parseNoteGlow(rawGlow);
    if (!note || rawGlow !== undefined && !glow || sameGlow(note.glow, glow)) return [];
    return [{ id, before: copyNoteGlow(note.glow), after: copyNoteGlow(glow) }];
  });
  if (changes.length === 0) return false;
  const first = board.notes[changes[0]!.id]!;
  const target = changes.length === 1 ? first.name : `${changes.length} nodes`;
  execute({
    label: changes.some((change) => change.after) ? "Node glow" : "Remove node glow",
    target,
    do: () => { for (const change of changes) updateNote(change.id, { glow: copyNoteGlow(change.after) }); },
    undo: () => { for (const change of changes) updateNote(change.id, { glow: copyNoteGlow(change.before) }); },
  });
  return true;
}

export function addOrEditNoteGlow(noteId: string, anchor: Point, zoomAtOpen: number): void {
  closeNoteGlowPopover(true);
  const ids = noteGlowTargets(noteId);
  const first = ids[0] ? board.notes[ids[0]] : undefined;
  if (!first) return;
  const menu = linkContext.menu;
  const position = menu?.kind === "note" && menu.noteId === noteId ? { x: menu.x, y: menu.y } : anchor;
  const before = Object.fromEntries(ids.map((id) => [id, copyNoteGlow(board.notes[id]?.glow)]));
  const start = before[first.id] ?? defaultNoteGlow(first);
  noteGlowPopover.current = {
    ids,
    x: position.x,
    y: position.y,
    zoomAtOpen,
    before,
    color: start.color,
    opacity: start.opacity,
    size: start.size,
    colorsById: null,
  };
  previewCurrentGlow();
}

export function previewNoteGlowColor(color: string): void {
  const current = noteGlowPopover.current;
  const next = normalizeHex(color);
  if (!current || !next) return;
  current.color = next;
  current.colorsById = null;
  previewCurrentGlow();
}

export function previewNoteGlowOpacity(value: number): void {
  const current = noteGlowPopover.current;
  if (!current || !Number.isFinite(value)) return;
  current.opacity = Math.min(MAX_GLOW_OPACITY, Math.max(MIN_GLOW_OPACITY, value));
  previewCurrentGlow();
}

export function previewNoteGlowSize(value: number): void {
  const current = noteGlowPopover.current;
  if (!current || !Number.isFinite(value)) return;
  current.size = Math.min(MAX_GLOW_SIZE, Math.max(MIN_GLOW_SIZE, value));
  previewCurrentGlow();
}

export function setGlowColorAsMain(): void {
  const current = noteGlowPopover.current;
  if (!current) return;
  const colorsById: Record<string, string> = {};
  for (const id of current.ids) {
    const note = board.notes[id];
    if (note) colorsById[id] = mainNoteColor(note);
  }
  const firstColor = current.ids[0] ? colorsById[current.ids[0]] : undefined;
  if (!firstColor) return;
  current.colorsById = colorsById;
  current.color = firstColor;
  previewCurrentGlow();
}

/** keep commits every live change as one Undo step; false restores the pre-open values. */
export function closeNoteGlowPopover(keep: boolean): void {
  const current = noteGlowPopover.current;
  noteGlowPopover.current = null;
  if (!current) return;
  restoreBefore(current);
  if (!keep) return;
  setNoteGlows(new Map(current.ids.map((id) => [id, previewGlowFor(current, id)])));
}

function previewCurrentGlow(): void {
  const current = noteGlowPopover.current;
  if (!current) return;
  for (const id of current.ids) {
    if (board.notes[id]) updateNote(id, { glow: previewGlowFor(current, id) });
  }
}

function previewGlowFor(state: NoteGlowPopoverState, id: string): NoteGlow {
  return {
    color: state.colorsById?.[id] ?? state.color,
    opacity: state.opacity,
    size: state.size,
  };
}

function restoreBefore(state: NoteGlowPopoverState): void {
  for (const id of state.ids) {
    if (board.notes[id]) updateNote(id, { glow: copyNoteGlow(state.before[id]) });
  }
}

function removeNoteGlow(noteId: string): void {
  const ids = noteGlowTargets(noteId);
  setNoteGlows(new Map(ids.map((id) => [id, undefined])));
}

function sameGlow(first: NoteGlow | undefined, second: NoteGlow | undefined): boolean {
  return first === undefined && second === undefined || Boolean(first && second &&
    first.color === second.color && first.opacity === second.opacity && first.size === second.size);
}

registerNoteMenuItem({
  id: "notes.glow.edit",
  label: (noteId) => board.notes[noteId]?.glow ? "Edit glow" : "Add glow",
  run: (noteId) => {
    const note = board.notes[noteId];
    if (note) addOrEditNoteGlow(noteId, { x: note.x, y: note.y }, camera.zoom);
  },
  visible: (noteId) => Boolean(board.notes[noteId] && board.notes[noteId]?.type !== "beacon"),
  order: 23,
});

registerNoteMenuItem({
  id: "notes.glow.remove",
  label: () => "Remove glow",
  run: removeNoteGlow,
  visible: (noteId) => Boolean(board.notes[noteId]?.type !== "beacon" && board.notes[noteId]?.glow),
  order: 24,
});
