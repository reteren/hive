import type { Point } from "../board/cameraMath";
import type { Note } from "../model/note";
import { uniqueName } from "../notes/naming";

export const HIVE_CLIPBOARD_MARKER = "hive/nodes";
export const HIVE_CLIPBOARD_VERSION = 1;
export const HIVE_CLIPBOARD_MIME = "application/x-hive-nodes+json";
export const HIVE_CLIPBOARD_WEB_MIME = `web ${HIVE_CLIPBOARD_MIME}`;
export const FALLBACK_PASTE_OFFSET: Point = { x: 2, y: 2 };
const AUTO_NOTE_HEIGHT_UNITS = 6;

export interface ClipboardNode {
  sourceId: string;
  type: "note";
  name: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number | null;
}

export interface HiveClipboardPayload {
  marker: typeof HIVE_CLIPBOARD_MARKER;
  version: typeof HIVE_CLIPBOARD_VERSION;
  nodes: ClipboardNode[];
  /** Reserved for R2; R1 has no links to copy. */
  links: [];
}

export interface NoteGeometry {
  x: number;
  y: number;
  width: number;
  height: number | null;
}

export function serializeNotes(notes: readonly Note[]): string {
  const payload: HiveClipboardPayload = {
    marker: HIVE_CLIPBOARD_MARKER,
    version: HIVE_CLIPBOARD_VERSION,
    nodes: notes.map(({ id, type, name, text, x, y, width, height }) => ({
      sourceId: id,
      type,
      name,
      text,
      x,
      y,
      width,
      height,
    })),
    links: [],
  };
  return JSON.stringify(payload);
}

/** Return null for malformed, unsupported, or unsafe clipboard data. */
export function parseNotesPayload(serialized: string): HiveClipboardPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (!isRecord(value) || value.marker !== HIVE_CLIPBOARD_MARKER || value.version !== HIVE_CLIPBOARD_VERSION) {
    return null;
  }
  if (!Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > 10_000) return null;
  if (!Array.isArray(value.links) || value.links.length !== 0) return null;

  const ids = new Set<string>();
  const nodes: ClipboardNode[] = [];
  for (const candidate of value.nodes) {
    if (!isClipboardNode(candidate)) return null;
    if (ids.has(candidate.sourceId)) return null;
    ids.add(candidate.sourceId);
    nodes.push({
      sourceId: candidate.sourceId,
      type: "note",
      name: candidate.name,
      text: candidate.text,
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
    });
  }

  return {
    marker: HIVE_CLIPBOARD_MARKER,
    version: HIVE_CLIPBOARD_VERSION,
    nodes,
    links: [],
  };
}

export function notesAsPlainText(notes: readonly Pick<Note, "name" | "text">[]): string {
  return notes.map((note) => note.text ? `${note.name}\n${note.text}` : note.name).join("\n\n");
}

export function uniqueCopyNames(sourceNames: readonly string[], existingNames: readonly string[]): string[] {
  const occupied = [...existingNames];
  return sourceNames.map((name) => {
    const copyName = uniqueName(name, occupied);
    occupied.push(copyName);
    return copyName;
  });
}

/** Center the copied group under the pointer, or offset it when no board pointer exists. */
export function placeNotes<T extends NoteGeometry>(
  notes: readonly T[],
  destination: Point | null,
  fallbackOffset: Point = FALLBACK_PASTE_OFFSET,
): T[] {
  if (notes.length === 0) return [];

  let deltaX = fallbackOffset.x;
  let deltaY = fallbackOffset.y;
  if (destination) {
    const minX = Math.min(...notes.map((note) => note.x));
    const minY = Math.min(...notes.map((note) => note.y));
    const maxX = Math.max(...notes.map((note) => note.x + note.width));
    const maxY = Math.max(...notes.map((note) => note.y + (note.height ?? AUTO_NOTE_HEIGHT_UNITS)));
    deltaX = destination.x - (minX + maxX) / 2;
    deltaY = destination.y - (minY + maxY) / 2;
  }

  return notes.map((note) => ({ ...note, x: note.x + deltaX, y: note.y + deltaY }));
}

function isClipboardNode(value: unknown): value is ClipboardNode {
  if (!isRecord(value)) return false;
  return (
    typeof value.sourceId === "string" && value.sourceId.trim().length > 0 &&
    value.type === "note" &&
    typeof value.name === "string" &&
    typeof value.text === "string" &&
    finite(value.x) && finite(value.y) && finite(value.width) && value.width > 0 &&
    (value.height === null || (finite(value.height) && value.height > 0))
  );
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
