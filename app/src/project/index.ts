import type { Note } from "../model/note";
import { ME_OBJECT_ID, pairKey, type Link, type LinkAnchor } from "../model/link";
import { isFrameAnchor } from "../links/anchors";
import { noteFileKey, sanitizeNoteName } from "./fileNames";

export interface IndexedNote {
  id: string;
  name: string;
  file: string;
  x: number;
  y: number;
  width: number;
  height: number | null;
  [key: string]: unknown;
}

export interface ProjectIndex {
  version: 1;
  notes: IndexedNote[];
  links?: Link[];
  [key: string]: unknown;
}

/** Parse v1 indexes and migrate the original unversioned/v0 index shape. */
export function parseProjectIndex(contents: string): ProjectIndex {
  return parseProjectIndexWithWarnings(contents).index;
}

export function parseProjectIndexWithWarnings(contents: string): { index: ProjectIndex; warnings: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Project index is not valid JSON: ${errorMessage(error)}`);
  }

  if (!isRecord(parsed)) throw new Error("Project index must be an object.");
  const version = parsed.version;
  if (version !== undefined && version !== 0 && version !== 1) {
    throw new Error(`Unsupported project index version: ${String(version)}.`);
  }
  if (!Array.isArray(parsed.notes)) throw new Error("Project index must contain a notes array.");

  const notes = parsed.notes.map((value, index) => parseNote(value, index));
  validateUniqueNotes(notes);
  const parsedLinks = sanitizeProjectLinks(parsed.links, new Set(notes.map((note) => note.id)));
  return {
    index: { ...parsed, version: 1, notes, links: parsedLinks.links },
    warnings: parsedLinks.warnings,
  };
}

/** Serialize board data while retaining index and per-note fields added by later versions. */
export function serializeProjectIndex(notes: readonly Note[], previous?: ProjectIndex, nextLinks?: readonly Link[]): string {
  const extrasById = new Map(previous?.notes.map((note) => [note.id, note]) ?? []);
  const indexedNotes = notes.map((note) => {
    const previousNote = extrasById.get(note.id);
    return {
      ...previousNote,
      id: note.id,
      name: note.name,
      file: `${sanitizeNoteName(note.name)}.md`,
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
      ...(note.createdAt === undefined ? {} : { createdAt: note.createdAt }),
    };
  });
  validateUniqueNotes(indexedNotes);
  return JSON.stringify({ ...previous, version: 1, notes: indexedNotes, links: [...(nextLinks ?? previous?.links ?? [])] });
}

/** Validate a project index against loaded note bodies and return board-ready notes. */
export function mergeLoadedNotes(index: ProjectIndex, loaded: readonly LoadedProjectNote[]): Note[] {
  const loadedById = new Map(loaded.map((note) => [note.id, note]));
  return index.notes.map((entry) => {
    const note = loadedById.get(entry.id);
    if (!note) throw new Error(`Project did not load note ${entry.id}.`);
    if (note.name !== entry.name || note.file !== entry.file || note.x !== entry.x || note.y !== entry.y
      || note.width !== entry.width || note.height !== entry.height) {
      throw new Error(`Loaded note ${entry.id} does not match board.json.`);
    }
    return {
      id: entry.id,
      type: "note",
      name: entry.name,
      text: note.text,
      x: entry.x,
      y: entry.y,
      width: entry.width,
      height: entry.height,
      ...(typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) && entry.createdAt >= 0
        ? { createdAt: entry.createdAt }
        : {}),
    };
  });
}

export interface LoadedProjectNote {
  id: string;
  name: string;
  file: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number | null;
}

function parseNote(value: unknown, index: number): IndexedNote {
  if (!isRecord(value)) throw new Error(`Project note ${index + 1} must be an object.`);
  const id = value.id;
  const name = value.name;
  if (typeof id !== "string" || id.trim() === "" || id === ME_OBJECT_ID || id.length > 200 || id.includes("/") || id.includes("\\")) {
    throw new Error(`Project note ${index + 1} has an invalid id.`);
  }
  if (typeof name !== "string" || name.trim() === "" || name.length > 500) {
    throw new Error(`Project note ${id} has an invalid name.`);
  }

  const file = typeof value.file === "string" && value.file.length > 0
    ? value.file
    : `${sanitizeNoteName(name)}.md`;
  validateNoteFile(file, id);

  const x = finiteNumber(value.x, `note ${id} x`);
  const y = finiteNumber(value.y, `note ${id} y`);
  const width = finiteNumber(value.width, `note ${id} width`);
  if (width <= 0) throw new Error(`Project note ${id} has an invalid width.`);
  let height: number | null = null;
  if (value.height !== undefined && value.height !== null) {
    height = finiteNumber(value.height, `note ${id} height`);
    if (height <= 0) throw new Error(`Project note ${id} has an invalid height.`);
  }

  return { ...value, id, name, file, x, y, width, height };
}

function validateUniqueNotes(notes: readonly IndexedNote[]): void {
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const note of notes) {
    if (ids.has(note.id)) throw new Error(`Project contains duplicate note id ${note.id}.`);
    ids.add(note.id);
    const key = noteFileKey(note.file.slice(0, -3));
    if (files.has(key)) throw new Error(`Project contains colliding note file ${note.file}.`);
    files.add(key);
  }
}

function sanitizeProjectLinks(value: unknown, noteIds: ReadonlySet<string>): { links: Link[]; warnings: string[] } {
  if (value === undefined) return { links: [], warnings: [] };
  if (!Array.isArray(value)) return { links: [], warnings: ["Invalid links in board.json were discarded."] };

  const links: Link[] = [];
  const ids = new Set<string>();
  const pairs = new Set<string>();
  let dropped = false;
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      dropped = true;
      continue;
    }
    const { id, from, to, kind } = candidate;
    const shape = candidate.shape ?? "straight";
    const fromAnchor = readAnchor(candidate, "fromAnchor");
    const toAnchor = readAnchor(candidate, "toAnchor");
    if (typeof id !== "string" || id.trim() === "" || id.length > 200 ||
      typeof from !== "string" || (from !== ME_OBJECT_ID && !noteIds.has(from)) ||
      typeof to !== "string" || !noteIds.has(to) ||
      (kind !== "strong" && kind !== "weak") ||
      (shape !== "straight" && shape !== "curved" && shape !== "orthogonal" && shape !== "wave" && shape !== "zigzag") ||
      ("fromAnchor" in candidate && !fromAnchor) || ("toAnchor" in candidate && !toAnchor) ||
      from === to || ids.has(id)) {
      dropped = true;
      continue;
    }
    const key = pairKey(from, to);
    if (pairs.has(key)) {
      dropped = true;
      continue;
    }
    ids.add(id);
    pairs.add(key);
    links.push({
      id,
      from,
      to,
      kind,
      shape,
      ...(fromAnchor ? { fromAnchor } : {}),
      ...(toAnchor ? { toAnchor } : {}),
    });
  }

  return {
    links,
    warnings: dropped ? ["Invalid or dangling links in board.json were discarded."] : [],
  };
}

function readAnchor(value: Record<string, unknown>, field: "fromAnchor" | "toAnchor"): LinkAnchor | undefined {
  const candidate = value[field];
  if (!isFrameAnchor(candidate)) return undefined;
  return { x: candidate.x, y: candidate.y };
}

function validateNoteFile(file: string, id: string): void {
  const baseName = file.slice(0, -3);
  if (!file.toLowerCase().endsWith(".md") || baseName.length === 0 || baseName.length > 120
    || file.includes("/") || file.includes("\\") || /[<>:"|?*\u0000-\u001f]/.test(file)
    || /[. ]$/.test(baseName) || /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?$/i.test(baseName)) {
    throw new Error(`Project note ${id} has an unsafe file name.`);
  }
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Project ${label} must be a finite number.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
