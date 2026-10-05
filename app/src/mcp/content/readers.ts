import type { Note, NoteKind } from "../../model/note";
import type { ImagePayload } from "./imagePayload";

export type { ImagePayload } from "./imagePayload";

/** Options of the `nodes.content` bridge method (docs/handoff/d35_content.md). */
export interface ContentOptions {
  /** Longest side of returned images in px (256..2048). */
  maxImagePx: number;
  /** Inclusive 1-based PDF page range. */
  pdfPages: { from: number; to: number };
  maxTextChars: number;
}

/** Returns the kind-specific fields merged into the node's content (header fields are added by the caller). */
export type ContentReader = (note: Note, options: ContentOptions) => Promise<Record<string, unknown>>;

const readers = new Map<NoteKind, ContentReader>();

export function registerContentReader(kind: NoteKind, reader: ContentReader): void {
  if (readers.has(kind)) throw new Error(`Content reader for ${kind} is registered twice.`);
  readers.set(kind, reader);
}

export function contentReaderFor(kind: NoteKind): ContentReader | undefined {
  return readers.get(kind);
}
