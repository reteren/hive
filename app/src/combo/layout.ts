import { DEFAULT_NOTE_WIDTH, NOTE_HEADER_HEIGHT_UNITS, type Note } from "../model/note";
import { PX_PER_UNIT } from "../board/cameraMath";

/**
 * The embedded section occupies the same inner width as a default-width note body.
 * The host's border, frame rails and body padding take 3u from its 30u outer width.
 */
export const COMBO_SECTION_WIDTH_UNITS = DEFAULT_NOTE_WIDTH - 3;
export const COMBO_SECTION_WIDTH_PX = COMBO_SECTION_WIDTH_UNITS * PX_PER_UNIT;
export const EMPTY_NOTE_BODY_MINIMUM_PX = 40;
export const EMPTY_COMBO_BODY_MINIMUM_PX = EMPTY_NOTE_BODY_MINIMUM_PX * 2.5;
const DEFAULT_FRAME_CHROME_PX = 12;
const DEFAULT_BODY_VERTICAL_PADDING_PX = 16;
const DEFAULT_NOTE_BORDER_PX = 2;
const FALLBACK_MESSAGE_SECTION_HEIGHT_PX = 75;
const FALLBACK_TIME_SECTION_HEIGHT_PX = 280;

export interface ComboMinimumHeightMetrics {
  headerHeightPx?: number;
  frameChromeHeightPx?: number;
  bodyPaddingHeightPx?: number;
  borderHeightPx?: number;
  textBodyNaturalHeightPx?: number;
  sectionsNaturalHeightPx?: number;
}

/** A text host must remain wide enough to contain the fixed embedded section. */
export function comboHostMinimumWidth(note: Pick<Note, "type" | "message" | "time">): number | null {
  const isTextHost = note.type === "note" || note.type === "pro" || note.type === "con";
  return isTextHost && (note.message !== undefined || note.time !== undefined)
    ? DEFAULT_NOTE_WIDTH
    : null;
}

export function emptyComboBodyMinimumHeight(
  note: Pick<Note, "type" | "message" | "time">,
): number | null {
  const isTextHost = note.type === "note" || note.type === "pro" || note.type === "con";
  return isTextHost && (note.message !== undefined || note.time !== undefined)
    ? EMPTY_COMBO_BODY_MINIMUM_PX
    : null;
}

/** Minimum host plus embedded-section height in board units, before visual note scale. */
export function comboMinimumHeightUnits(
  note: Pick<Note, "type" | "message" | "time" | "headerHidden">,
  metrics: ComboMinimumHeightMetrics = {},
): number | null {
  const isTextHost = note.type === "note" || note.type === "pro" || note.type === "con";
  if (!isTextHost || note.message === undefined && note.time === undefined) return null;

  const defaultHeaderPx = note.headerHidden ? 0 : note.type === "pro" || note.type === "con"
    ? 24
    : NOTE_HEADER_HEIGHT_UNITS * PX_PER_UNIT;
  const fallbackSectionsPx = (note.message === undefined ? 0 : FALLBACK_MESSAGE_SECTION_HEIGHT_PX) +
    (note.time === undefined ? 0 : FALLBACK_TIME_SECTION_HEIGHT_PX);
  const totalPx = (metrics.headerHeightPx ?? defaultHeaderPx) +
    (metrics.frameChromeHeightPx ?? DEFAULT_FRAME_CHROME_PX) +
    (metrics.bodyPaddingHeightPx ?? DEFAULT_BODY_VERTICAL_PADDING_PX) +
    (metrics.borderHeightPx ?? DEFAULT_NOTE_BORDER_PX) +
    Math.max(EMPTY_COMBO_BODY_MINIMUM_PX, metrics.textBodyNaturalHeightPx ?? 0) +
    (metrics.sectionsNaturalHeightPx ?? fallbackSectionsPx);
  return totalPx / PX_PER_UNIT;
}

/** Read live natural section/body heights when resizing; pure fallback values keep tests deterministic. */
export function comboMinimumHeightForNote(
  noteId: string,
  note: Pick<Note, "type" | "message" | "time" | "headerHidden">,
): number | null {
  const base = comboMinimumHeightUnits(note);
  if (base === null || typeof document === "undefined") return base;
  const root = [...document.querySelectorAll<HTMLElement>(".note-card[data-note-id]")]
    .find((element) => element.dataset.noteId === noteId);
  if (!root) return base;

  const content = root.querySelector<HTMLElement>(".note-content");
  const textBody = content?.querySelector<HTMLElement>(":scope > .note-body");
  const style = content ? getComputedStyle(content) : null;
  const rootStyle = getComputedStyle(root);
  const frameChromeHeightPx = [
    root.querySelector<HTMLElement>(".note-frame-edge-top"),
    root.querySelector<HTMLElement>(".note-frame-edge-bottom"),
  ].reduce((total, edge) => total + (edge?.offsetHeight ?? 0), 0);
  const sectionsNaturalHeightPx = [...root.querySelectorAll<HTMLElement>(".combo-section")]
    .reduce((total, section) => total + section.offsetHeight, 0);
  const header = note.headerHidden ? null : root.querySelector<HTMLElement>(".note-header:not(.hidden-note-header)");
  const textContent = textBody?.querySelector<HTMLElement>(".markdown-preview, .cm-content");
  const textBodyNaturalHeightPx = textContent
    ? Math.max(textContent.offsetHeight, textContent.scrollHeight)
    : 0;
  const bodyPaddingHeightPx = style
    ? cssPixels(style.paddingTop) + cssPixels(style.paddingBottom)
    : undefined;
  const borderHeightPx = cssPixels(rootStyle.borderTopWidth) + cssPixels(rootStyle.borderBottomWidth);

  return comboMinimumHeightUnits(note, {
    ...(header ? { headerHeightPx: header.offsetHeight } : note.headerHidden ? { headerHeightPx: 0 } : {}),
    ...(frameChromeHeightPx > 0 ? { frameChromeHeightPx } : {}),
    ...(bodyPaddingHeightPx === undefined ? {} : { bodyPaddingHeightPx }),
    borderHeightPx,
    textBodyNaturalHeightPx,
    sectionsNaturalHeightPx,
  });
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
