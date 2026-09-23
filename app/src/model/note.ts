/**
 * A plain board note (R1). Geometry is in board units (u); x/y is the top-left corner.
 * The Markdown body lives in `text` and is saved as its own .md file named after `name`.
 */
export interface Note {
  /** Permanent id, independent of the name (ROADMAP "Технические границы" §1). */
  id: string;
  type: "note";
  /** Display name, unique within the project; also the .md file name. */
  name: string;
  /** Markdown body. */
  text: string;
  x: number;
  y: number;
  width: number;
  /** Manual height in u, or null while the note grows with its text. */
  height: number | null;
}

/** New note width from the roadmap examples. */
export const DEFAULT_NOTE_WIDTH = 30;

export function newId(): string {
  return crypto.randomUUID();
}
