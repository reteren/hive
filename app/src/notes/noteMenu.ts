import { board, updateNote } from "../model/board.svelte";
import { NOTE_HEADER_HEIGHT_UNITS } from "../model/note";
import { linksOf } from "../model/links.svelte";
import { execute } from "../history/history.svelte";
import { toggleSmoothLinesForNote } from "../links/smoothLines";

/**
 * Items of the note right-click menu. Features register their entries here instead of editing
 * the menu component (R3: Task, Add Importance, Add Purpose, …).
 */
export interface NoteMenuItem {
  id: string;
  /** Label shown in the menu; may depend on the note (e.g. "Mark as task" / "Unmark task"). */
  label: (noteId: string) => string;
  run: (noteId: string) => void;
  /** Hide the item for notes it doesn't apply to. */
  visible?: (noteId: string) => boolean;
  /** Lower comes first. */
  order?: number;
}

const items = new Map<string, NoteMenuItem>();

registerNoteMenuItem({
  id: "links.smoothLines",
  label: (noteId) => board.notes[noteId]?.smoothLines ? "Remove smooth" : "Smooth lines",
  run: toggleSmoothLinesForNote,
  visible: (noteId) => board.notes[noteId]?.type !== "beacon" &&
    (board.notes[noteId]?.smoothLines === true || linksOf(noteId).length > 0),
  order: 85,
});

registerNoteMenuItem({
  id: "notes.toggleHeader",
  label: (noteId) => board.notes[noteId]?.headerHidden ? "Show header" : "Hide header",
  run: toggleNoteHeader,
  visible: (noteId) => Boolean(board.notes[noteId] && board.notes[noteId].type !== "beacon"),
  order: 90,
});

function toggleNoteHeader(noteId: string): void {
  const note = board.notes[noteId];
  if (!note || note.type === "beacon") return;

  const beforeHeaderHidden = note.headerHidden;
  const beforeHeight = note.height;
  const headerHidden = note.headerHidden !== true;
  const height = beforeHeight === null
    ? null
    : Math.max(0.1, beforeHeight + (headerHidden ? -NOTE_HEADER_HEIGHT_UNITS : NOTE_HEADER_HEIGHT_UNITS));
  const patch = { headerHidden, height };
  execute({
    label: headerHidden ? "Hide header" : "Show header",
    target: note.name,
    do: () => updateNote(noteId, patch),
    undo: () => updateNote(noteId, { headerHidden: beforeHeaderHidden, height: beforeHeight }),
  });
}

export function registerNoteMenuItem(item: NoteMenuItem): void {
  items.set(item.id, item);
}

export function noteMenuItems(noteId: string): NoteMenuItem[] {
  const beacon = board.notes[noteId]?.type === "beacon";
  return [...items.values()]
    .filter((item) => !(beacon && /^tasks?\./i.test(item.id)))
    .filter((item) => item.visible?.(noteId) ?? true)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}
