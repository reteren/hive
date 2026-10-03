import type { Note, NoteKind } from "../model/note";

export const TEXT_SCROLL_LINE_THRESHOLD = 15;

export function isTextNoteKind(kind: NoteKind): boolean {
  return kind === "note" || kind === "pro" || kind === "con";
}

/** Estimate rendered lines at the current width, including wraps in long Markdown lines. */
export function visualTextLineCount(text: string, width: number): number {
  const charactersPerLine = Math.max(8, Math.floor((width * 10 - 30) / 8));
  return text.split(/\r\n|\r|\n/).reduce((count, line) =>
    count + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
}

export function canScrollTextNote(note: Pick<Note, "type" | "height" | "text" | "width">): boolean {
  return isTextNoteKind(note.type) && note.height !== null &&
    visualTextLineCount(note.text, note.width) > TEXT_SCROLL_LINE_THRESHOLD;
}

/** Short notes must still fit all their text when the user resizes them vertically. */
export function minimumManualTextHeight(
  note: Pick<Note, "type" | "text" | "width">,
  baseHeight: number,
  naturalHeight: number | null,
): number {
  if (!isTextNoteKind(note.type) || visualTextLineCount(note.text, note.width) > TEXT_SCROLL_LINE_THRESHOLD) return baseHeight;
  return Math.max(baseHeight, naturalHeight ?? 0);
}

/** Let a wheel event bubble to the board once the inner text reaches an edge. */
export function wheelScrollsText(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  deltaY: number,
): boolean {
  if (scrollHeight <= clientHeight + 1 || deltaY === 0) return false;
  return deltaY > 0 ? scrollTop + clientHeight < scrollHeight - 1 : scrollTop > 1;
}
