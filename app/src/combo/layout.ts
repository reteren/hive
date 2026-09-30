import { DEFAULT_NOTE_WIDTH, type Note } from "../model/note";
import { PX_PER_UNIT } from "../board/cameraMath";

/**
 * The embedded section occupies the same inner width as a default-width note body.
 * The host's border, frame rails and body padding take 3u from its 30u outer width.
 */
export const COMBO_SECTION_WIDTH_UNITS = DEFAULT_NOTE_WIDTH - 3;
export const COMBO_SECTION_WIDTH_PX = COMBO_SECTION_WIDTH_UNITS * PX_PER_UNIT;

/** A text host must remain wide enough to contain the fixed embedded section. */
export function comboHostMinimumWidth(note: Pick<Note, "type" | "message" | "time">): number | null {
  const isTextHost = note.type === "note" || note.type === "pro" || note.type === "con";
  return isTextHost && (note.message !== undefined || note.time !== undefined)
    ? DEFAULT_NOTE_WIDTH
    : null;
}
