const scrollByNoteId = new Map<string, number>();

/** Remember a PDF's scroll offset for the lifetime of this app session. */
export function rememberPdfScroll(noteId: string, scrollTop: number): void {
  if (!noteId || !Number.isFinite(scrollTop)) return;
  scrollByNoteId.set(noteId, Math.max(0, scrollTop));
}

export function rememberedPdfScroll(noteId: string): number {
  return scrollByNoteId.get(noteId) ?? 0;
}

export function clampPdfScroll(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const offset = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const maximum = Math.max(0, scrollHeight - clientHeight);
  return Math.min(offset, maximum);
}
