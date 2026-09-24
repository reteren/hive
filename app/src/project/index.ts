import {
  IMPORTANCE_LEVELS,
  MOOD_KINDS,
  PURPOSE_KINDS,
  type ImportanceLevel,
  type MoodKind,
  type Note,
  type NoteKind,
  type PurposeKind,
  type TaskState,
} from "../model/note";
import { ME_OBJECT_ID, pairKey, type Link, type LinkAnchor } from "../model/link";
import { isFrameAnchor } from "../links/anchors";
import { noteFileKey, sanitizeNoteName } from "./fileNames";
import type { TaskLogEntry } from "../tasks/taskLog.svelte";

export interface IndexedNote {
  id: string;
  name: string;
  file: string;
  x: number;
  y: number;
  width: number;
  height: number | null;
  type: NoteKind;
  task: TaskState | null;
  taskMemory: TaskState | null;
  importance: ImportanceLevel | null;
  purposes: PurposeKind[];
  moods: MoodKind[];
  [key: string]: unknown;
}

export interface ProjectIndex {
  version: 2;
  notes: IndexedNote[];
  links?: Link[];
  /** Completion history stays with the project snapshot and is separate from Undo. */
  taskLog: TaskLogEntry[];
  [key: string]: unknown;
}

/** Parse v1 indexes, including v1 indexes with links, and migrate them to v2. */
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
  if (version !== undefined && version !== 0 && version !== 1 && version !== 2) {
    throw new Error(`Unsupported project index version: ${String(version)}.`);
  }
  if (!Array.isArray(parsed.notes)) throw new Error("Project index must contain a notes array.");

  const noteWarnings: string[] = [];
  const notes = parsed.notes.map((value, index) => {
    const result = parseNote(value, index, version === 2);
    noteWarnings.push(...result.warnings);
    return result.note;
  });
  validateUniqueNotes(notes);
  const parsedLinks = sanitizeProjectLinks(parsed.links, new Set(notes.map((note) => note.id)));
  const parsedTaskLog = sanitizeTaskLog(parsed.taskLog);
  if (version === 2 && parsed.taskLog === undefined) {
    parsedTaskLog.warnings.push("Missing task log in board.json; defaulted to an empty log.");
  }
  return {
    index: { ...parsed, version: 2, notes, links: parsedLinks.links, taskLog: parsedTaskLog.entries },
    warnings: [...noteWarnings, ...parsedLinks.warnings, ...parsedTaskLog.warnings],
  };
}

/** Serialize board data while retaining index and per-note fields added by later versions. */
export function serializeProjectIndex(
  notes: readonly Note[],
  previous?: ProjectIndex,
  nextLinks?: readonly Link[],
  nextTaskLog?: readonly TaskLogEntry[],
): string {
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
      type: note.type,
      task: copyTaskState(note.task),
      taskMemory: copyTaskState(note.taskMemory),
      importance: note.importance ?? null,
      purposes: [...new Set(note.purposes ?? [])],
      moods: [...new Set(note.moods ?? [])],
    };
  });
  validateUniqueNotes(indexedNotes);
  return JSON.stringify({
    ...previous,
    version: 2,
    notes: indexedNotes,
    links: [...(nextLinks ?? previous?.links ?? [])],
    taskLog: [...(nextTaskLog ?? previous?.taskLog ?? [])].map((entry) => ({ ...entry })),
  });
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
      type: entry.type,
      name: entry.name,
      text: note.text,
      x: entry.x,
      y: entry.y,
      width: entry.width,
      height: entry.height,
      task: copyTaskState(entry.task),
      taskMemory: copyTaskState(entry.taskMemory),
      importance: entry.importance,
      purposes: [...entry.purposes],
      ...(entry.moods.length > 0 ? { moods: [...entry.moods] } : {}),
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

function parseNote(value: unknown, index: number, requireV2Fields: boolean): { note: IndexedNote; warnings: string[] } {
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

  const warnings: string[] = [];
  const type = parseNoteKind(value.type);
  if (value.type !== undefined && type === null) warnings.push(`Invalid type for note ${id}; defaulted to note.`);
  else if (requireV2Fields && value.type === undefined) warnings.push(`Missing type for note ${id}; defaulted to note.`);

  const task = parseTaskState(value.task);
  if (value.task !== undefined && value.task !== null && task === null) {
    warnings.push(`Invalid task state for note ${id}; task flag was cleared.`);
  } else if (requireV2Fields && value.task === undefined) warnings.push(`Missing task state for note ${id}; defaulted to no task.`);

  const taskMemory = parseTaskState(value.taskMemory);
  if (value.taskMemory !== undefined && value.taskMemory !== null && taskMemory === null) {
    warnings.push(`Invalid remembered task state for note ${id}; remembered state was cleared.`);
  } else if (requireV2Fields && value.taskMemory === undefined) {
    warnings.push(`Missing remembered task state for note ${id}; defaulted to none.`);
  }

  const importance = parseImportance(value.importance);
  if (value.importance !== undefined && value.importance !== null && importance === null) {
    warnings.push(`Invalid importance for note ${id}; importance was cleared.`);
  } else if (requireV2Fields && value.importance === undefined) warnings.push(`Missing importance for note ${id}; importance was cleared.`);

  const purposes = parsePurposes(value.purposes);
  if (value.purposes !== undefined && !purposes.valid) {
    warnings.push(`Invalid purpose values for note ${id}; unknown values were discarded.`);
  } else if (requireV2Fields && value.purposes === undefined) warnings.push(`Missing purposes for note ${id}; defaulted to none.`);

  const moods = parseMoods(value.moods);
  if (value.moods !== undefined && !moods.valid) {
    warnings.push(`Invalid mood values for note ${id}; unknown values were discarded.`);
  }

  return {
    note: {
      ...value,
      id,
      name,
      file,
      x,
      y,
      width,
      height,
      type: type ?? "note",
      task,
      taskMemory,
      importance,
      purposes: purposes.values,
      moods: moods.values,
    },
    warnings,
  };
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

function parseNoteKind(value: unknown): NoteKind | null {
  return value === "note" || value === "pro" || value === "con" ||
    value === "importance" || value === "purpose" || value === "mood"
    ? value
    : null;
}

function parseTaskState(value: unknown): TaskState | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.done !== "boolean") return null;
  const doneAt = value.doneAt;
  if (value.done) {
    return typeof doneAt === "number" && Number.isFinite(doneAt) && doneAt >= 0
      ? { done: true, doneAt }
      : null;
  }
  return doneAt === null ? { done: false, doneAt: null } : null;
}

function copyTaskState(value: TaskState | null | undefined): TaskState | null {
  if (value === undefined || value === null) return null;
  return { done: value.done, doneAt: value.doneAt };
}

function parseImportance(value: unknown): ImportanceLevel | null {
  return typeof value === "string" && IMPORTANCE_LEVELS.includes(value as ImportanceLevel)
    ? value as ImportanceLevel
    : null;
}

function parsePurposes(value: unknown): { values: PurposeKind[]; valid: boolean } {
  if (value === undefined) return { values: [], valid: true };
  if (!Array.isArray(value)) return { values: [], valid: false };
  const values: PurposeKind[] = [];
  let valid = true;
  for (const item of value) {
    if (typeof item !== "string" || !PURPOSE_KINDS.includes(item as PurposeKind)) {
      valid = false;
      continue;
    }
    const purpose = item as PurposeKind;
    if (!values.includes(purpose)) values.push(purpose);
  }
  return { values, valid };
}

function parseMoods(value: unknown): { values: MoodKind[]; valid: boolean } {
  if (value === undefined) return { values: [], valid: true };
  if (!Array.isArray(value)) return { values: [], valid: false };
  const values: MoodKind[] = [];
  let valid = true;
  for (const item of value) {
    if (typeof item !== "string" || !MOOD_KINDS.includes(item as MoodKind)) {
      valid = false;
      continue;
    }
    const mood = item as MoodKind;
    if (!values.includes(mood)) values.push(mood);
  }
  return { values, valid };
}

function sanitizeTaskLog(value: unknown): { entries: TaskLogEntry[]; warnings: string[] } {
  if (value === undefined) return { entries: [], warnings: [] };
  if (!Array.isArray(value)) {
    return { entries: [], warnings: ["Invalid task log in board.json was discarded."] };
  }
  let dropped = false;
  const entries = value.flatMap((candidate): TaskLogEntry[] => {
    if (!isRecord(candidate) || typeof candidate.noteId !== "string" || !candidate.noteId.trim() ||
      typeof candidate.name !== "string" || typeof candidate.doneAt !== "number" ||
      !Number.isFinite(candidate.doneAt) || candidate.doneAt < 0) {
      dropped = true;
      return [];
    }
    return [{ noteId: candidate.noteId, name: candidate.name, doneAt: candidate.doneAt }];
  });
  return {
    entries,
    warnings: dropped ? ["Invalid task log entries in board.json were discarded."] : [],
  };
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
    const rawShape = candidate.shape;
    const shape: Link["shape"] | null = rawShape === undefined || rawShape === "straight" || rawShape === "curved" || rawShape === "base"
      ? "base"
      : rawShape === "orthogonal" || rawShape === "zigzag" || rawShape === "wave"
        ? rawShape
        : null;
    const fromAnchor = readAnchor(candidate, "fromAnchor");
    const toAnchor = readAnchor(candidate, "toAnchor");
    if (typeof id !== "string" || id.trim() === "" || id.length > 200 ||
      typeof from !== "string" || (from !== ME_OBJECT_ID && !noteIds.has(from)) ||
      typeof to !== "string" || !noteIds.has(to) ||
      (kind !== "strong" && kind !== "weak") ||
      shape === null ||
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
