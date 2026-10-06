import type { NoteKind } from "../model/note";
import {
  clearMinimumTextWidth,
  growWidthToTextMinimum,
  maximumNoteWidthForKind,
  minimumWidthForText,
} from "../notes/layout.svelte";

interface NoteLineWidthCache {
  font: string;
  lines: Map<string, number>;
}

const MAX_CACHED_LINES_PER_NOTE = 256;
const MAX_CACHED_NOTES = 512;
const lineWidthsByNote = new Map<string, NoteLineWidthCache>();
let measureContext: CanvasRenderingContext2D | null | undefined;

/** Cache natural line widths per note and actual rendered font. */
export function widestNaturalLineWidth(
  noteId: string,
  text: string,
  font: string,
  measureLine: (line: string) => number,
): number {
  let cache = lineWidthsByNote.get(noteId);
  if (!cache || cache.font !== font) {
    if (!cache) {
      while (lineWidthsByNote.size >= MAX_CACHED_NOTES) {
        const oldestNoteId = lineWidthsByNote.keys().next().value;
        if (oldestNoteId === undefined) break;
        lineWidthsByNote.delete(oldestNoteId);
      }
    } else {
      lineWidthsByNote.delete(noteId);
    }
    cache = { font, lines: new Map() };
    lineWidthsByNote.set(noteId, cache);
  } else {
    lineWidthsByNote.delete(noteId);
    lineWidthsByNote.set(noteId, cache);
  }

  let widest = 0;
  for (const line of text.split(/\r\n|\r|\n/u)) {
    let width = cache.lines.get(line);
    if (width === undefined) {
      width = measureLine(line);
      if (!Number.isFinite(width)) width = 0;
      cache.lines.set(line, Math.max(0, width));
      if (cache.lines.size > MAX_CACHED_LINES_PER_NOTE) {
        const oldest = cache.lines.keys().next().value;
        if (oldest !== undefined) cache.lines.delete(oldest);
      }
    }
    widest = Math.max(widest, width);
  }
  return widest;
}

/** Board units of slack when deciding whether the first line still fits on one row. */
const FIRST_LINE_FIT_TOLERANCE = 0.5;

/** Board units added to the measured first line when the node grows with it (anti wrap flicker). */
const FIRST_LINE_SLACK = 1.5;

/**
 * Text-driven width growth (debug 28 #5): only the first line sets the width, and only while that
 * line still fits on one row — i.e. while it is being typed into a node that follows it. Once the
 * first line wraps (an existing note with a long first paragraph, or a manually narrowed node) the
 * width never changes from typing.
 */
export function nextTextWidthAfterEdit(
  currentWidth: number,
  textMinimum: number,
  maxWidth: number,
  widthLocked: boolean,
  previousTextMinimum: number | null = null,
): number {
  if (widthLocked) return currentWidth;
  if (previousTextMinimum === null || previousTextMinimum > currentWidth + FIRST_LINE_FIT_TOLERANCE) return currentWidth;
  // Canvas measurement and the DOM line differ by a fraction of a pixel (kerning, spellcheck spans
  // re-rendered after every keystroke). A node sized exactly to the line then wraps its last word on
  // and off with each character — leave a little room so the first line always fits.
  return growWidthToTextMinimum(currentWidth, textMinimum + FIRST_LINE_SLACK, maxWidth);
}

/** Measure using the note's current font, then cache the board-space minimum for resize gestures. */
export function measureAndCacheTextMinimumWidth(
  noteId: string,
  text: string,
  source: HTMLElement,
  kind: NoteKind,
): number | null {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return null;
  const root = source.matches(".note-card") ? source : source.closest<HTMLElement>(".note-card");
  const content = root?.querySelector<HTMLElement>(".note-content");
  const textElement = source.matches(".cm-content, .markdown-preview")
    ? source
    : root?.querySelector<HTMLElement>(".cm-content, .markdown-preview");
  if (!root || !content || !textElement) return null;

  const style = getComputedStyle(textElement);
  const context = getMeasureContext();
  if (!context) return null;
  const requestedFont = style.font || "";
  const fallbackFont = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const previousFont = context.font;
  context.font = requestedFont;
  if (!requestedFont || context.font === previousFont && requestedFont !== previousFont) context.font = fallbackFont;
  const font = context.font;
  // Debug 28 #5 (user correction): only the FIRST line sets the node's width while typing;
  // later lines wrap. Manual resizing stays free.
  const firstLine = text.split(/\r\n|\r|\n/u, 1)[0] ?? "";
  const widestLine = widestNaturalLineWidth(noteId, firstLine, font, (line) => context.measureText(line).width);

  const contentStyle = getComputedStyle(content);
  const padding = (Number.parseFloat(contentStyle.paddingLeft) || 0) +
    (Number.parseFloat(contentStyle.paddingRight) || 0);
  const horizontalChrome = Math.max(0, root.offsetWidth - content.offsetWidth) + padding;
  const minimumWidth = minimumWidthForText(
    widestLine,
    horizontalChrome,
    maximumNoteWidthForKind(kind),
  );
  // The first line no longer constrains manual resizing (debug 28 #5): the user resizes freely.
  return minimumWidth;
}

export function clearTextFitWidthCache(noteId: string): void {
  lineWidthsByNote.delete(noteId);
  clearMinimumTextWidth(noteId);
}

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    measureContext = document.createElement("canvas").getContext("2d");
  }
  return measureContext;
}
