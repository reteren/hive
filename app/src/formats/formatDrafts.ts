import type { MediaRef } from "../attachments/types";

const drafts = new Map<string, string>();

function key(noteId: string, media: Pick<MediaRef, "file">, projectPath: string): string {
  return `${projectPath}\u0000${noteId}\u0000${media.file}`;
}

/** Drafts intentionally live for the app session and survive editor/body unmounts. */
export function formatDraft(noteId: string, media: Pick<MediaRef, "file">, projectPath: string): string | undefined {
  return drafts.get(key(noteId, media, projectPath));
}

export function setFormatDraft(noteId: string, media: Pick<MediaRef, "file">, projectPath: string, text: string): void {
  drafts.set(key(noteId, media, projectPath), text);
}

export function clearFormatDraft(noteId: string, media: Pick<MediaRef, "file">, projectPath: string): void {
  drafts.delete(key(noteId, media, projectPath));
}

/** Test seam for isolated sessions; production code leaves drafts intact across deselection. */
export function clearAllFormatDrafts(): void {
  drafts.clear();
}
