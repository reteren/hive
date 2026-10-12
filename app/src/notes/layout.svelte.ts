import { DEFAULT_NOTE_WIDTH, NOTE_HEADER_HEIGHT_UNITS, R5_BASE_WIDTHS, normalizeNoteScale, type Note, type NoteKind } from "../model/note";
import { PX_PER_UNIT } from "../board/cameraMath";
import { widthWithListStatistics } from "../stats/listStatsLayout";

/** Rendered height (u) of notes whose height follows their text; kept current by NotesLayer. */
export const measuredHeights: Record<string, number> = $state({});

/** Minimum height used before a note has been measured. */
export const MIN_NOTE_HEIGHT = 6;
export const MIN_NOTE_WIDTH = 12;
export const FIT_WIDTH_MAX_MULTIPLIER = 2.5;

const minimumTextWidths = new Map<string, number>();

export function maximumNoteWidthForKind(kind: NoteKind | undefined): number {
  if (!kind) return Number.POSITIVE_INFINITY;
  const baseWidth = kind === "format" ? DEFAULT_NOTE_WIDTH : kind in R5_BASE_WIDTHS
    ? R5_BASE_WIDTHS[kind as keyof typeof R5_BASE_WIDTHS]
    : kind === "pro" || kind === "con" ? 18 : DEFAULT_NOTE_WIDTH;
  return baseWidth * FIT_WIDTH_MAX_MULTIPLIER;
}

/** Minimum board width needed to keep the widest natural text line unwrapped. */
export function minimumWidthForText(
  widestLinePx: number,
  horizontalChromePx: number,
  maxWidth: number,
  pxPerUnit = PX_PER_UNIT,
): number {
  const safeLine = Number.isFinite(widestLinePx) ? Math.max(0, widestLinePx) : 0;
  const safeChrome = Number.isFinite(horizontalChromePx) ? Math.max(0, horizontalChromePx) : 0;
  const safeScale = Number.isFinite(pxPerUnit) && pxPerUnit > 0 ? pxPerUnit : PX_PER_UNIT;
  const safeMax = Number.isFinite(maxWidth) ? Math.max(MIN_NOTE_WIDTH, maxWidth) : Number.POSITIVE_INFINITY;
  return Math.min(safeMax, Math.max(MIN_NOTE_WIDTH, (safeLine + safeChrome) / safeScale));
}

/** Grow only as needed; deleting text never reduces the current width. */
export function growWidthToTextMinimum(currentWidth: number, textMinimum: number, maxWidth: number): number {
  const safeCurrent = Number.isFinite(currentWidth) ? Math.max(MIN_NOTE_WIDTH, currentWidth) : MIN_NOTE_WIDTH;
  const safeMaximum = Number.isFinite(maxWidth) ? Math.max(MIN_NOTE_WIDTH, maxWidth) : safeCurrent;
  const clampedMinimum = Math.min(safeMaximum, Number.isFinite(textMinimum) ? Math.max(MIN_NOTE_WIDTH, textMinimum) : MIN_NOTE_WIDTH);
  return Math.max(safeCurrent, clampedMinimum);
}

export function cacheMinimumTextWidth(noteId: string, width: number): void {
  if (Number.isFinite(width)) minimumTextWidths.set(noteId, Math.max(MIN_NOTE_WIDTH, width));
}

export function minimumTextWidthForNote(noteId: string, maxWidth: number): number {
  const cached = minimumTextWidths.get(noteId) ?? MIN_NOTE_WIDTH;
  const safeMaximum = Number.isFinite(maxWidth) ? Math.max(MIN_NOTE_WIDTH, maxWidth) : cached;
  return Math.max(MIN_NOTE_WIDTH, Math.min(safeMaximum, cached));
}

export function clearMinimumTextWidth(noteId: string): void {
  minimumTextWidths.delete(noteId);
}

/** Preview and CodeMirror body styles both use a 14 px font with a 1.45 line height. */
export const NOTE_LINE_HEIGHT = (14 * 1.45) / PX_PER_UNIT;
export const RESIZE_EXTRA_LINES = 5;

export interface RenderedNoteMetrics {
  /** Natural rendered content height plus fixed note chrome, in board units. */
  contentHeight: number;
  /** Rendered line height in board units. */
  lineHeight: number;
}

const RENDERED_NOTE_BODY_SELECTOR = ".markdown-preview, .cm-scroller, .cm-content, .note-body, .calculator-body";

/** Find the natural content surface used to size notes, including custom calculator bodies. */
export function renderedNoteBodyElement(content: Pick<HTMLElement, "querySelector">): HTMLElement | null {
  return content.querySelector<HTMLElement>(RENDERED_NOTE_BODY_SELECTOR);
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
  const body = content ? renderedNoteBodyElement(content) : null;
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
  const scale = normalizeNoteScale(note.scale);
  return {
    x: note.x,
    y: note.y,
    width: widthWithListStatistics(note) * scale,
    height: (note.height ?? measuredHeights[note.id] ?? estimatedNoteHeight(note)) * scale,
  };
}

/** Average glyph width of the 14 px body font, for estimating wraps before a note was ever drawn. */
const ESTIMATED_CHAR_PX = 7.2;
const BODY_CHROME_UNITS = 1.8;

/**
 * Height of an auto-height note that has never been on screen (culled since the project opened):
 * header + wrapped text lines. Replaced by the measured height as soon as the note is drawn.
 */
const estimateCache = new Map<string, { text: string; width: number; flags: number; height: number }>();

export function estimatedNoteHeight(note: Pick<Note, "type" | "text" | "width" | "headerHidden" | "textHidden"> & { id?: string }): number {
  if (note.type !== "note" && note.type !== "pro" && note.type !== "con") return MIN_NOTE_HEIGHT;
  const flags = (note.headerHidden ? 1 : 0) | (note.textHidden ? 2 : 0);
  const cached = note.id ? estimateCache.get(note.id) : undefined;
  if (cached && cached.text === note.text && cached.width === note.width && cached.flags === flags) return cached.height;
  const height = computeEstimatedHeight(note);
  if (note.id) {
    if (estimateCache.size > 50_000) estimateCache.clear();
    estimateCache.set(note.id, { text: note.text, width: note.width, flags, height });
  }
  return height;
}

function computeEstimatedHeight(note: Pick<Note, "text" | "width" | "headerHidden" | "textHidden">): number {
  const header = note.headerHidden ? 0 : NOTE_HEADER_HEIGHT_UNITS;
  if (note.textHidden) return Math.max(NOTE_HEADER_HEIGHT_UNITS, header);
  const charsPerLine = Math.max(8, Math.floor((note.width * PX_PER_UNIT - 16) / ESTIMATED_CHAR_PX));
  let lines = 0;
  for (const paragraph of note.text.split("\n")) lines += Math.max(1, Math.ceil(paragraph.length / charsPerLine));
  return Math.max(MIN_NOTE_HEIGHT, header + BODY_CHROME_UNITS + lines * NOTE_LINE_HEIGHT);
}
