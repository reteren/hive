import type { Point } from "../board/cameraMath";
import type { Link, LinkAnchor } from "../model/link";
import { isFrameAnchor } from "../links/anchors";
import { newId } from "../model/note";
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
import { uniqueName } from "../notes/naming";

export const HIVE_CLIPBOARD_MARKER = "hive/nodes";
export const HIVE_CLIPBOARD_VERSION = 2;
export const HIVE_CLIPBOARD_MIME = "application/x-hive-nodes+json";
export const HIVE_CLIPBOARD_WEB_MIME = `web ${HIVE_CLIPBOARD_MIME}`;
export const FALLBACK_PASTE_OFFSET: Point = { x: 2, y: 2 };
const AUTO_NOTE_HEIGHT_UNITS = 6;

export interface ClipboardNode {
  sourceId: string;
  type: NoteKind;
  name: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number | null;
  createdAt?: number;
  task: TaskState | null;
  taskMemory: TaskState | null;
  importance: ImportanceLevel | null;
  purposes: PurposeKind[];
  moods: MoodKind[];
}

export interface ClipboardLink {
  from: string;
  to: string;
  kind: Link["kind"];
  shape: Link["shape"];
  fromAnchor?: LinkAnchor;
  toAnchor?: LinkAnchor;
}

type ClipboardLinkInput = Omit<ClipboardLink, "shape"> & {
  shape: Link["shape"] | "straight" | "curved";
};

export interface HiveClipboardPayload {
  marker: typeof HIVE_CLIPBOARD_MARKER;
  version: typeof HIVE_CLIPBOARD_VERSION;
  nodes: ClipboardNode[];
  /** Only links whose two endpoints are included in nodes are copied. */
  links: ClipboardLink[];
}

export interface NoteGeometry {
  x: number;
  y: number;
  width: number;
  height: number | null;
}

export function serializeNotes(notes: readonly Note[], links: readonly ClipboardLink[] = []): string {
  const noteIds = new Set(notes.map((note) => note.id));
  const payload: HiveClipboardPayload = {
    marker: HIVE_CLIPBOARD_MARKER,
    version: HIVE_CLIPBOARD_VERSION,
    nodes: notes.map(({
      id, type, name, text, x, y, width, height, createdAt, task, taskMemory, importance, purposes, moods,
    }) => ({
      sourceId: id,
      type,
      name,
      text,
      x,
      y,
      width,
      height,
      createdAt,
      task: task ? { ...task } : null,
      taskMemory: taskMemory ? { ...taskMemory } : null,
      importance: importance ?? null,
      purposes: [...new Set(purposes ?? [])],
      moods: [...new Set(moods ?? [])],
    })),
    links: links.flatMap((link) => noteIds.has(link.from) && noteIds.has(link.to)
      ? [{
          from: link.from,
          to: link.to,
          kind: link.kind,
          shape: link.shape,
          ...(link.fromAnchor ? { fromAnchor: { ...link.fromAnchor } } : {}),
          ...(link.toAnchor ? { toAnchor: { ...link.toAnchor } } : {}),
        }]
      : []),
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

  if (!isRecord(value) || value.marker !== HIVE_CLIPBOARD_MARKER ||
    (value.version !== 1 && value.version !== HIVE_CLIPBOARD_VERSION)) {
    return null;
  }
  if (!Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > 10_000) return null;
  if (!Array.isArray(value.links) || value.links.length > 10_000) return null;

  const ids = new Set<string>();
  const nodes: ClipboardNode[] = [];
  for (const candidate of value.nodes) {
    const node = parseClipboardNode(candidate);
    if (!node || ids.has(node.sourceId)) return null;
    ids.add(node.sourceId);
    nodes.push(node);
  }

  const links: ClipboardLink[] = [];
  const pairs = new Set<string>();
  for (const candidate of value.links) {
    if (!isClipboardLink(candidate) || !ids.has(candidate.from) || !ids.has(candidate.to)) return null;
    const pair = candidate.from < candidate.to
      ? `${candidate.from}|${candidate.to}`
      : `${candidate.to}|${candidate.from}`;
    if (candidate.from === candidate.to || pairs.has(pair)) return null;
    pairs.add(pair);
    links.push({
      from: candidate.from,
      to: candidate.to,
      kind: candidate.kind,
      shape: normalizeClipboardLineShape(candidate.shape),
      ...(candidate.fromAnchor ? { fromAnchor: candidate.fromAnchor } : {}),
      ...(candidate.toAnchor ? { toAnchor: candidate.toAnchor } : {}),
    });
  }

  return {
    marker: HIVE_CLIPBOARD_MARKER,
    version: HIVE_CLIPBOARD_VERSION,
    nodes,
    links,
  };
}

/** Completion and remembered state belong to the source note; pasted copies start clean. */
export function taskFieldsForPaste(note: Pick<Note, "task" | "taskMemory">): Pick<Note, "task" | "taskMemory"> {
  const task = note.task;
  return {
    task: task ? (task.done ? { done: false, doneAt: null } : { ...task }) : null,
    taskMemory: null,
  };
}

/** Clone only fully internal links, remapping both endpoints to copied note ids. */
export function remapClipboardLinks(
  links: readonly ClipboardLink[],
  idMap: ReadonlyMap<string, string>,
  createId: () => string = newId,
): Link[] {
  return links.flatMap((link) => {
    const from = idMap.get(link.from);
    const to = idMap.get(link.to);
    if (!from || !to || from === to) return [];
    return [{
      id: createId(),
      from,
      to,
      kind: link.kind,
      shape: link.shape,
      ...(link.fromAnchor ? { fromAnchor: { ...link.fromAnchor } } : {}),
      ...(link.toAnchor ? { toAnchor: { ...link.toAnchor } } : {}),
    }];
  });
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

function parseClipboardNode(value: unknown): ClipboardNode | null {
  if (!isRecord(value) || typeof value.sourceId !== "string" || value.sourceId.trim().length === 0 ||
    (value.type !== "note" && value.type !== "pro" && value.type !== "con" &&
      value.type !== "importance" && value.type !== "purpose" && value.type !== "mood") ||
    typeof value.name !== "string" || typeof value.text !== "string" ||
    !finite(value.x) || !finite(value.y) || !finite(value.width) || value.width <= 0 ||
    !(value.height === null || (finite(value.height) && value.height > 0)) ||
    (value.createdAt !== undefined && (!finite(value.createdAt) || value.createdAt < 0))) return null;

  const task = parseTaskState(value.task);
  if (value.task !== undefined && value.task !== null && !task) return null;
  const taskMemory = parseTaskState(value.taskMemory);
  if (value.taskMemory !== undefined && value.taskMemory !== null && !taskMemory) return null;
  const importance = parseImportance(value.importance);
  if (value.importance !== undefined && value.importance !== null && !importance) return null;
  const purposes = parsePurposes(value.purposes);
  if (!purposes) return null;
  const moods = parseMoods(value.moods);
  if (!moods) return null;

  return {
    sourceId: value.sourceId,
    type: value.type,
    name: value.name,
    text: value.text,
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    ...(value.createdAt === undefined ? {} : { createdAt: value.createdAt }),
    task,
    taskMemory,
    importance,
    purposes,
    moods,
  };
}

function parseTaskState(value: unknown): TaskState | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.done !== "boolean") return null;
  if (value.done) {
    return finite(value.doneAt) && value.doneAt >= 0 ? { done: true, doneAt: value.doneAt } : null;
  }
  return value.doneAt === null ? { done: false, doneAt: null } : null;
}

function parseImportance(value: unknown): ImportanceLevel | null {
  return typeof value === "string" && IMPORTANCE_LEVELS.includes(value as ImportanceLevel)
    ? value as ImportanceLevel
    : null;
}

function parsePurposes(value: unknown): PurposeKind[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const purposes: PurposeKind[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || !PURPOSE_KINDS.includes(candidate as PurposeKind)) return null;
    const purpose = candidate as PurposeKind;
    if (!purposes.includes(purpose)) purposes.push(purpose);
  }
  return purposes;
}

function isClipboardLink(value: unknown): value is ClipboardLinkInput {
  return isRecord(value) && typeof value.from === "string" && value.from.length > 0 &&
    typeof value.to === "string" && value.to.length > 0 &&
    (value.kind === "strong" || value.kind === "weak") &&
    (value.shape === "base" || value.shape === "straight" || value.shape === "curved" ||
      value.shape === "orthogonal" || value.shape === "wave" || value.shape === "zigzag") &&
    (!Object.hasOwn(value, "fromAnchor") || isFrameAnchor(value.fromAnchor)) &&
    (!Object.hasOwn(value, "toAnchor") || isFrameAnchor(value.toAnchor));
}

function parseMoods(value: unknown): MoodKind[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const moods: MoodKind[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || !MOOD_KINDS.includes(candidate as MoodKind)) return null;
    const mood = candidate as MoodKind;
    if (!moods.includes(mood)) moods.push(mood);
  }
  return moods;
}

function normalizeClipboardLineShape(shape: unknown): Link["shape"] {
  if (shape === "straight" || shape === "curved") return "base";
  return shape as Link["shape"];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
