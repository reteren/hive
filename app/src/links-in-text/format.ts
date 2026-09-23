import type { Point } from "../board/cameraMath";

export type TextLinkTarget =
  | { kind: "external"; url: string }
  | { kind: "point"; point: Point }
  | { kind: "note"; noteId: string };

const coordinatePattern = /^(-?(?:\d+(?:\.\d*)?|\.\d+)),(-?(?:\d+(?:\.\d*)?|\.\d+))$/u;

/** Parse only supported external URLs and hive addresses from note text. */
export function parseTextLink(value: string): TextLinkTarget | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    return url.hostname ? { kind: "external", url: url.href } : null;
  }

  if (url.protocol !== "hive:" || url.username || url.password || url.port || url.search || url.hash) {
    return null;
  }

  if (url.hostname.toLowerCase() === "point") {
    const match = coordinatePattern.exec(url.pathname.slice(1));
    if (!match) return null;
    const point = { x: Number(match[1]), y: Number(match[2]) };
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? { kind: "point", point } : null;
  }

  if (url.hostname.toLowerCase() === "note") {
    let noteId: string;
    try {
      noteId = decodeURIComponent(url.pathname.slice(1));
    } catch {
      return null;
    }
    return noteId ? { kind: "note", noteId } : null;
  }

  return null;
}

/** Format cursor coordinates as `hive://point/x,y` with at most 3 fractional digits. */
export function formatPointAddress(point: Point): string {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError("Point coordinates must be finite.");
  }
  return `hive://point/${formatCoordinate(point.x)},${formatCoordinate(point.y)}`;
}

export function formatNoteAddress(noteId: string): string {
  if (!noteId.trim()) throw new RangeError("A note id is required.");
  return `hive://note/${encodeURIComponent(noteId)}`;
}

export function formatNoteMarkdownLink(name: string, noteId: string): string {
  const label = name.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
  return `[${label}](${formatNoteAddress(noteId)})`;
}

function formatCoordinate(value: number): string {
  const rounded = Number(value.toFixed(3));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
