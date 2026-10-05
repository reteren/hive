import type { Point } from "../board/cameraMath";
import { camera } from "../board/camera.svelte";
import { board, updateNote } from "../model/board.svelte";
import { execute } from "../history/history.svelte";
import { selection } from "../selection/selection.svelte";
import { normalizeHex } from "../color/hex";
import { linkContext, showLinkStatus } from "../links-in-text/contextMenu.svelte";
import { registerCommand } from "../commands/registry.svelte";
import { registerNoteMenuItem } from "./noteMenu";
import { canPaintNote, DEFAULT_NOTE_COLORS, type NoteColorPart } from "./noteColorLogic";

export { canPaintNote, DEFAULT_NOTE_COLORS, needsDarkText, noteColorStyle, relativeLuminance, type NoteColorPart } from "./noteColorLogic";

/** The right-clicked node, or every paintable selected node when it is part of the selection. */
export function noteColorTargets(noteId: string): string[] {
  const ids = selection.ids.includes(noteId) ? selection.ids : [noteId];
  return ids.filter((id) => canPaintNote(board.notes[id]));
}

/** Paint (or with null, unpaint) one part of several nodes as a single Undo step. */
export function paintNotes(ids: readonly string[], part: NoteColorPart, value: string | null): boolean {
  const next = value === null ? undefined : normalizeHex(value) ?? undefined;
  if (value !== null && !next) return false;
  const targets = ids.filter((id) => canPaintNote(board.notes[id]) && board.notes[id]![part] !== next);
  if (targets.length === 0) return false;
  const before = new Map(targets.map((id) => [id, board.notes[id]![part]]));
  const first = board.notes[targets[0]!]!;
  execute({
    label: value === null ? "Reset node colour" : part === "color" ? "Node colour" : "Node accent colour",
    target: targets.length === 1 ? first.name : `${targets.length} nodes`,
    do: () => { for (const id of targets) updateNote(id, { [part]: next }); },
    undo: () => { for (const [id, color] of before) updateNote(id, { [part]: color }); },
  });
  return true;
}

export interface NoteColorPopoverState {
  ids: string[];
  part: NoteColorPart;
  /** World point the popover is pinned to. */
  x: number;
  y: number;
  zoomAtOpen: number;
  /** Colours before the popover opened, restored on Cancel and used as the Undo base. */
  before: Record<string, string | undefined>;
  /** Last previewed colour, or null when nothing was picked yet. */
  value: string | null;
}

export const noteColorPopover = $state({ current: null as NoteColorPopoverState | null });

export function openNoteColorPopover(noteId: string, part: NoteColorPart, anchor: Point, zoomAtOpen: number): void {
  closeNoteColorPopover(true);
  const ids = noteColorTargets(noteId);
  if (ids.length === 0) return;
  noteColorPopover.current = {
    ids,
    part,
    x: anchor.x,
    y: anchor.y,
    zoomAtOpen,
    before: Object.fromEntries(ids.map((id) => [id, board.notes[id]?.[part]])),
    value: null,
  };
}

/** The colour the picker starts from: the node's own colour, or the theme grey. */
export function noteColorPopoverStart(state: NoteColorPopoverState): string {
  const first = state.ids[0];
  return (first ? state.before[first] : undefined) ?? DEFAULT_NOTE_COLORS[state.part];
}

/** Show a colour live while the picker is dragged, without Undo entries. */
export function previewNoteColor(color: string): void {
  const current = noteColorPopover.current;
  const next = normalizeHex(color);
  if (!current || !next) return;
  current.value = next;
  for (const id of current.ids) {
    if (canPaintNote(board.notes[id])) updateNote(id, { [current.part]: next });
  }
}

function restoreBefore(state: NoteColorPopoverState): void {
  for (const id of state.ids) {
    if (board.notes[id]) updateNote(id, { [state.part]: state.before[id] });
  }
}

/** keep: land the previewed colour in history as one step; otherwise put the old colours back. */
export function closeNoteColorPopover(keep: boolean): void {
  const current = noteColorPopover.current;
  noteColorPopover.current = null;
  if (!current) return;
  restoreBefore(current);
  if (keep && current.value) paintNotes(current.ids, current.part, current.value);
}

/** Return the part to the theme grey for every target, as one Undo step. */
export function resetNoteColorPopover(): void {
  const current = noteColorPopover.current;
  noteColorPopover.current = null;
  if (!current) return;
  restoreBefore(current);
  paintNotes(current.ids, current.part, null);
}

function openFromMenu(noteId: string, part: NoteColorPart): void {
  const menu = linkContext.menu;
  const note = board.notes[noteId];
  if (!note) return;
  const anchor = menu?.kind === "note" && menu.noteId === noteId ? { x: menu.x, y: menu.y } : { x: note.x, y: note.y };
  openNoteColorPopover(noteId, part, anchor, camera.zoom);
}

function openForSelection(part: NoteColorPart): void {
  const id = selection.ids.find((candidate) => canPaintNote(board.notes[candidate]));
  const note = id ? board.notes[id] : undefined;
  if (!id || !note) {
    showLinkStatus("Select a node first.");
    return;
  }
  openNoteColorPopover(id, part, { x: note.x, y: note.y }, camera.zoom);
}

registerNoteMenuItem({
  id: "notes.color",
  label: () => "Change color",
  order: 21,
  visible: (noteId) => canPaintNote(board.notes[noteId]),
  run: (noteId) => openFromMenu(noteId, "color"),
});

registerNoteMenuItem({
  id: "notes.accentColor",
  label: () => "Change accent color",
  order: 22,
  visible: (noteId) => canPaintNote(board.notes[noteId]),
  run: (noteId) => openFromMenu(noteId, "accentColor"),
});

registerCommand({
  id: "notes.color",
  label: "Change node color",
  keys: [],
  run: () => openForSelection("color"),
});

registerCommand({
  id: "notes.accentColor",
  label: "Change node accent color",
  keys: [],
  run: () => openForSelection("accentColor"),
});
