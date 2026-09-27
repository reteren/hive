import { board } from "../model/board.svelte";
import { linksOf } from "../model/links.svelte";
import { smoothLinesForObjects } from "../links/smoothLines";

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
  label: () => "Smooth lines",
  run: (noteId) => { smoothLinesForObjects([noteId]); },
  visible: (noteId) => linksOf(noteId).length > 0,
  order: 85,
});

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
