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

export function registerNoteMenuItem(item: NoteMenuItem): void {
  items.set(item.id, item);
}

export function noteMenuItems(noteId: string): NoteMenuItem[] {
  return [...items.values()]
    .filter((item) => item.visible?.(noteId) ?? true)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}
