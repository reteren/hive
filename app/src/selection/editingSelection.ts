export interface SelectionSnapshot {
  ids: readonly string[];
  primaryId: string | null;
}

export interface EditingSelectionSnapshot {
  ids: string[];
  primaryId: string;
}

/** Keep an existing selection intact when its note enters text editing. */
export function selectionForEditing(
  current: SelectionSnapshot,
  noteId: string,
): EditingSelectionSnapshot {
  return {
    ids: current.ids.includes(noteId) ? [...current.ids] : [noteId],
    primaryId: noteId,
  };
}
