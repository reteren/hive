export type NotePressRegion = "header" | "frame" | "body" | "resize-handle" | "outside";
export type NotePressIntent = "move-candidate" | "text-interaction" | "resize" | "ignore";

/** Decide whether a press may become a note move without cancelling its initial click. */
export function notePressIntent(
  region: NotePressRegion,
  noteId: string | null,
  editingNoteId: string | null,
): NotePressIntent {
  if (region === "outside" || noteId === null) return "ignore";
  if (region === "resize-handle") return "resize";
  if (region === "body" && editingNoteId === noteId) return "text-interaction";
  return "move-candidate";
}

/** A move candidate remains a normal click until the screen-space drag threshold is crossed. */
export function noteMoveStarts(intent: NotePressIntent, thresholdCrossed: boolean): boolean {
  return intent === "move-candidate" && thresholdCrossed;
}

/** Alt alone selects a note directly; Ctrl/Shift combinations keep their existing pointer behavior. */
export function shouldSelectNoteOnAltPress(
  noteId: string | null | undefined,
  altKey: boolean,
  ctrlKey: boolean,
  shiftKey: boolean,
  dimmed: boolean,
): boolean {
  return Boolean(noteId) && altKey && !ctrlKey && !shiftKey && !dimmed;
}

/** Suppress pointer-generated activation after Alt selection without eating keyboard clicks. */
export function shouldSuppressAltNodeActivationClick(suppressUntil: number, now: number, clickDetail: number): boolean {
  return clickDetail > 0 && suppressUntil > now;
}

/** A Ctrl-click on an already selected header toggles only if the gesture stays a click. */
export function shouldToggleSelectedHeaderAfterGesture(dragStarted: boolean, cancelled: boolean): boolean {
  return !dragStarted && !cancelled;
}
