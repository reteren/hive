import type { Note } from "../model/note";
import { PX_PER_UNIT } from "../board/cameraMath";

/** Rendered height (u) of notes whose height follows their text; kept current by NotesLayer. */
export const measuredHeights: Record<string, number> = $state({});

/** Minimum height used before a note has been measured. */
export const MIN_NOTE_HEIGHT = 6;

/** Preview and CodeMirror body styles both use a 14 px font with a 1.45 line height. */
export const NOTE_LINE_HEIGHT = (14 * 1.45) / PX_PER_UNIT;
export const RESIZE_EXTRA_LINES = 5;

export interface RenderedNoteMetrics {
  /** Natural rendered content height plus fixed note chrome, in board units. */
  contentHeight: number;
  /** Rendered line height in board units. */
  lineHeight: number;
}

/** Maximum manual height: at least 1.5 base heights, with five rendered lines beyond the text. */
export function maximumResizableHeight(
  contentHeight: number,
  lineHeight = NOTE_LINE_HEIGHT,
  baseHeight = MIN_NOTE_HEIGHT,
): number {
  const safeContent = Number.isFinite(contentHeight) ? Math.max(0, contentHeight) : 0;
  const safeLineHeight = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : NOTE_LINE_HEIGHT;
  const textAndChromeLimit = safeContent > 0 ? safeContent + safeLineHeight * RESIZE_EXTRA_LINES : 0;
  return Math.max(baseHeight * 1.5, textAndChromeLimit);
}

/** Read the full natural body height even when a manually-sized note clips its content. */
export function renderedNoteMetrics(noteId: string): RenderedNoteMetrics | null {
  if (typeof document === "undefined") return null;
  const root = [...document.querySelectorAll<HTMLElement>(".note-card[data-note-id]")]
    .find((element) => element.dataset.noteId === noteId);
  const content = root?.querySelector<HTMLElement>(".note-content");
  const body = content?.querySelector<HTMLElement>(".markdown-preview, .cm-scroller, .cm-content")
    ?? content?.querySelector<HTMLElement>(".note-body");
  if (!root || !content || !body) return null;

  const style = getComputedStyle(body);
  const computedLineHeight = Number.parseFloat(style.lineHeight);
  const lineHeightPx = Number.isFinite(computedLineHeight)
    ? computedLineHeight
    : (Number.parseFloat(style.fontSize) || 14) * 1.45;
  const contentStyle = getComputedStyle(content);
  const verticalPadding = (Number.parseFloat(contentStyle.paddingTop) || 0) +
    (Number.parseFloat(contentStyle.paddingBottom) || 0);
  const naturalBodyPx = Math.max(body.scrollHeight, body.offsetHeight);
  const chromePx = Math.max(0, root.offsetHeight - content.offsetHeight);
  return {
    contentHeight: (chromePx + verticalPadding + naturalBodyPx) / PX_PER_UNIT,
    lineHeight: lineHeightPx / PX_PER_UNIT,
  };
}

export function maximumResizableHeightForNote(noteId: string): number {
  const metrics = renderedNoteMetrics(noteId);
  return metrics
    ? maximumResizableHeight(metrics.contentHeight, metrics.lineHeight)
    : MIN_NOTE_HEIGHT * 1.5;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Board-space rectangle of a note, using its manual height or the measured one. */
export function noteBounds(note: Note): Bounds {
  return {
    x: note.x,
    y: note.y,
    width: note.width,
    height: note.height ?? measuredHeights[note.id] ?? MIN_NOTE_HEIGHT,
  };
}
