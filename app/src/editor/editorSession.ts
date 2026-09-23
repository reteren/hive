import type { EditorView } from "@codemirror/view";
import { editing } from "../notes/editing.svelte";

export interface ScreenPoint {
  x: number;
  y: number;
}

let pendingClick: { noteId: string; point: ScreenPoint } | null = null;
let activeEditor: { noteId: string; view: EditorView } | null = null;
const destroyedEditors = new WeakSet<EditorView>();

export function startNoteEditing(noteId: string, point: ScreenPoint): void {
  if (editing.noteId === noteId) {
    pendingClick = null;
    return;
  }

  pendingClick = { noteId, point };
  editing.noteId = noteId;
}

export function consumePendingClick(noteId: string): ScreenPoint | null {
  if (pendingClick?.noteId !== noteId) return null;
  const point = pendingClick.point;
  pendingClick = null;
  return point;
}

export function attachEditor(noteId: string, view: EditorView): void {
  if (activeEditor && activeEditor.view !== view) destroyEditor(activeEditor.view);
  activeEditor = { noteId, view };
}

export function detachEditor(view: EditorView): void {
  if (activeEditor?.view === view) activeEditor = null;
  destroyEditor(view);
}

export function editorForNote(noteId: string): EditorView | null {
  return activeEditor?.noteId === noteId ? activeEditor.view : null;
}

export function exitNoteEditing(view: EditorView): void {
  const board = view.dom.closest<HTMLElement>(".board");
  editing.noteId = null;
  board?.focus({ preventScroll: true });
}

function destroyEditor(view: EditorView): void {
  if (destroyedEditors.has(view)) return;
  destroyedEditors.add(view);
  view.destroy();
}
