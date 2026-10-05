import type { Note } from "../model/note";
import { normalizeHex } from "../color/hex";

/**
 * Node colours. `color` paints the frame and header of a node (and tints its lines, like a beacon's
 * colour); `accentColor` paints the inner body. Both are optional: absent means the theme greys.
 */
export type NoteColorPart = "color" | "accentColor";

/** Theme greys, used as the picker's starting point for an unpainted node. */
export const DEFAULT_NOTE_COLORS: Record<NoteColorPart, string> = { color: "#353535", accentColor: "#282828" };

/** Dark text that replaces the light theme text on a light background. */
const DARK_TEXT = "#1f1f1f";
const DARK_TEXT_DIM = "#4a4a4a";

/** Beacons have their own colour editor; images have no frame to paint. */
export function canPaintNote(note: Note | undefined): note is Note {
  return Boolean(note && note.type !== "beacon" && note.type !== "image");
}

/** WCAG relative luminance of "#rrggbb", 0–1. */
export function relativeLuminance(hex: string): number {
  const normalized = normalizeHex(hex) ?? "#000000";
  const channel = (offset: number): number => {
    const value = parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Whether the light theme text would be hard to read on this background. */
export function needsDarkText(hex: string | undefined): boolean {
  return Boolean(hex && relativeLuminance(hex) > 0.4);
}

/** CSS custom properties a painted node sets on its card; empty for an unpainted one. */
export function noteColorStyle(note: Pick<Note, "color" | "accentColor" | "type">): Record<string, string> {
  if (note.type === "beacon") return {};
  const style: Record<string, string> = {};
  if (note.color) {
    style["--note-frame"] = note.color;
    if (needsDarkText(note.color)) style["--note-header-text"] = DARK_TEXT;
  }
  if (note.accentColor) {
    style["--note-body"] = note.accentColor;
    if (needsDarkText(note.accentColor)) {
      style["--text"] = DARK_TEXT;
      style["--text-dim"] = DARK_TEXT_DIM;
    }
  }
  return style;
}
