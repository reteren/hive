/**
 * View-only state of Mark as nodes: whether the tag editor is collapsed. Not part of the project
 * and not undoable — it only changes how much of the node is shown (the node height follows it).
 */
const collapsed = $state<Record<string, boolean>>({});

export function isMarkAsEditorCollapsed(noteId: string): boolean {
  return collapsed[noteId] === true;
}

export function toggleMarkAsEditor(noteId: string): void {
  collapsed[noteId] = !collapsed[noteId];
}
