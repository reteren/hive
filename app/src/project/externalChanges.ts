export type ExternalNoteDecision = "unchanged" | "reload" | "conflict";

export interface ExternalNoteChange {
  externalText: string;
  localText: string;
  savedText: string | undefined;
  isEditing: boolean;
}

/** Decide whether an external body can replace the current local note. */
export function decideExternalNoteChange(change: ExternalNoteChange): ExternalNoteDecision {
  if (change.externalText === change.localText) return "unchanged";
  if (change.isEditing || change.savedText === undefined || change.localText !== change.savedText) {
    return "conflict";
  }
  return "reload";
}
