import { defaultMessageData, parseMessageData } from "../messages/data";
import type { MessageNodeData } from "../time/types";
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
  NOTE_HEADER_HEIGHT_UNITS,
  R5_BASE_WIDTHS,
  isValidNoteScale,
  normalizeNoteScale,
} from "../model/note";
import { ME_OBJECT_ID, pairKey, type Link, type LinkAnchor } from "../model/link";
import { isFrameAnchor, parseSmoothLineAnchorSnapshot } from "../links/anchors";
import type { Zone } from "../model/zone";
import type { Point } from "../board/cameraMath";
import { beaconPaletteColor, normalizeBeaconColor } from "../beacons/beaconPalette";
import { calculatorNoteFileName, noteFileKey, noteMarkdownFileName, sanitizeNoteName } from "./fileNames";
import type { TaskLogEntry } from "../tasks/taskLog.svelte";
import { calculatorKey, parseCalculatorData, parseScope, parseTiers, type CalculatorData, type NodeScope, type TierRow, parseListItems, parseRandomPick, parseSource, parseCustomMarks, type CustomMark, type ListItem, type RandomPick, type SourceData } from "../model/nodeData";
import type { ArchiveEntry, TrashEntry } from "../model/retention.svelte";
import { copyArchiveEntry, sanitizeArchiveEntries } from "../archive/serialization";
import { copyTrashEntry } from "../trash/trash";
import { sanitizeTrashEntries } from "../trash/serialization";
import type { TimeNodeData, TimeSchedule, TimeRuntime, CountMode, ProjectTimeCounters } from "../time/types";
import { copyStopwatchData, parseStopwatchData } from "../time/data";

export interface IndexedNote {
  id: string;
  name: string;
  file: string;
  x: number;
  y: number;
  width: number;
  height: number | null;
  scale?: number;
  type: NoteKind;
  task: TaskState | null;
  taskMemory: TaskState | null;
  time?: TimeNodeData;
  message?: MessageNodeData;
  importance: ImportanceLevel | null;
  purposes: PurposeKind[];
  moods: MoodKind[];
  color?: string | null;
  zoneId?: string | null;
  scope?: NodeScope;
  tiers?: TierRow[];
  listItems?: ListItem[];
  source?: SourceData;
  inboxGroup?: string;
  randomPick?: RandomPick;
  customMarks?: CustomMark[];
  customMarkFrame?: boolean;
  listStats?: boolean;
  headerHidden?: boolean;
  smoothLines?: boolean;
  smoothLineAnchors?: NonNullable<Note["smoothLineAnchors"]>;
  [key: string]: unknown;
}

export interface ProjectIndex {
  version: 3;
  /** Project epoch used by Stopwatch. Older indexes migrate from the oldest note creation time. */
  createdAt: number;
  /** Runtime-only counters accumulated while this project is open. */
  projectCounters: ProjectTimeCounters;
  notes: IndexedNote[];
  links?: Link[];
  zones: Zone[];
  /** Ordered board marks are view state; beacon focus is intentionally transient. */
  beaconMarks: string[];
  /** Completion history stays with the project snapshot and is separate from Undo. */
  taskLog: TaskLogEntry[];
  /** R5.6 shared calculator contents keyed by calculatorKey(name); optional for older boards. */
  calculators?: Record<string, CalculatorData>;
  /** Archived notes retain their Markdown bodies and original links in board.json. */
  archive: ArchiveEntry[];
  /** Soft-deleted objects retain their contents until the user restores or purges them. */
  trash: TrashEntry[];
  [key: string]: unknown;
}

/** Parse v1/v2 indexes and migrate their project data to v3. */
export function parseProjectIndex(contents: string): ProjectIndex {
  return parseProjectIndexWithWarnings(contents).index;
}

export function parseProjectIndexWithWarnings(contents: string, now = Date.now()): { index: ProjectIndex; warnings: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Project index is not valid JSON: ${errorMessage(error)}`);
  }

  if (!isRecord(parsed)) throw new Error("Project index must be an object.");
  const version = parsed.version;
  if (version !== undefined && version !== 0 && version !== 1 && version !== 2 && version !== 3) {
    throw new Error(`Unsupported project index version: ${String(version)}.`);
  }
  if (!Array.isArray(parsed.notes)) throw new Error("Project index must contain a notes array.");

  const zonesResult = sanitizeZones(parsed.zones, version === 3);
  const noteWarnings: string[] = [];
  const notes = parsed.notes.map((value, index) => {
    const result = parseNote(value, index, version === 2 || version === 3, version === 3,
      new Set(zonesResult.zones.map((zone) => zone.id)));
    noteWarnings.push(...result.warnings);
    return result.note;
  });
  validateUniqueNotes(notes);
  const noteIds = new Set(notes.map((note) => note.id));
  const uniqueZones = zonesResult.zones.filter((zone) => !noteIds.has(zone.id));
  if (uniqueZones.length !== zonesResult.zones.length) zonesResult.warnings.push("Zones with ids colliding with notes were discarded.");
  const validZoneIds = new Set(uniqueZones.map((zone) => zone.id));
  for (const note of notes) {
    if (note.zoneId && !validZoneIds.has(note.zoneId)) {
      noteWarnings.push(`Invalid zone membership for note ${note.id}; membership was cleared.`);
      note.zoneId = null;
    }
  }
  const parsedLinks = sanitizeProjectLinks(parsed.links, noteIds);
  const parsedTaskLog = sanitizeTaskLog(parsed.taskLog);
  const parsedCalculators = sanitizeCalculators(parsed.calculators);
  const parsedArchive = sanitizeArchiveEntries(parsed.archive);
  const parsedTrash = sanitizeTrashEntries(parsed.trash);
  const noteCreationTimes = notes.flatMap((note) => typeof note.createdAt === "number" && finiteNonnegative(note.createdAt)
    ? [note.createdAt]
    : []);
  const createdAt = finiteNonnegative(parsed.createdAt)
    ? parsed.createdAt
    : noteCreationTimes.length > 0 ? noteCreationTimes.reduce((earliest, candidate) => Math.min(earliest, candidate)) : now;
  const projectCounters = sanitizeProjectCounters(parsed.projectCounters);
  if ((version === 2 || version === 3) && parsed.taskLog === undefined) {
    parsedTaskLog.warnings.push("Missing task log in board.json; defaulted to an empty log.");
  }
  const marks = sanitizeBeaconMarks(parsed.beaconMarks, notes);
  if (version === 3 && parsed.beaconMarks === undefined) marks.warnings.push("Missing beacon marks in board.json; defaulted to none.");
  return {
    index: {
      ...parsed,
      version: 3,
      createdAt,
      projectCounters: projectCounters.value,
      notes,
      links: parsedLinks.links,
      zones: uniqueZones,
      beaconMarks: marks.values,
      taskLog: parsedTaskLog.entries,
      calculators: parsedCalculators.values,
      archive: parsedArchive.entries,
      trash: parsedTrash.entries,
    },
    warnings: [
      ...noteWarnings,
      ...zonesResult.warnings,
      ...parsedLinks.warnings,
      ...parsedTaskLog.warnings,
      ...marks.warnings,
      ...parsedCalculators.warnings,
      ...parsedArchive.warnings,
      ...parsedTrash.warnings,
      ...(parsed.createdAt !== undefined && !finiteNonnegative(parsed.createdAt)
        ? ["Invalid project creation time in board.json; it was restored from note dates."]
        : []),
      ...(projectCounters.invalid ? ["Invalid project stopwatch counters in board.json were reset to zero."] : []),
    ],
  };
}

/** Serialize board data while retaining index and per-note fields added by later versions. */
export function serializeProjectIndex(
  notes: readonly Note[],
  previous?: ProjectIndex,
  nextLinks?: readonly Link[],
  nextTaskLog?: readonly TaskLogEntry[],
  nextZones?: readonly Zone[],
  nextBeaconMarks?: readonly string[],
  nextCalculators?: Record<string, CalculatorData>,
  nextArchive?: readonly ArchiveEntry[],
  nextTrash?: readonly TrashEntry[],
  nextProjectMetadata?: { createdAt: number; projectCounters: ProjectTimeCounters },
): string {
  const extrasById = new Map(previous?.notes.map((note) => [note.id, note]) ?? []);
  const serializedZones = (nextZones ?? previous?.zones ?? []).map(copyZone);
  const validZoneIds = new Set(serializedZones.map((zone) => zone.id));
  const filesById = projectNoteFiles(notes);
  const indexedNotes = notes.map((note) => {
    const previousNote = extrasById.get(note.id);
    return {
      ...previousNote,
      id: note.id,
      name: note.name,
      file: filesById.get(note.id) ?? noteMarkdownFileName(note),
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
      scale: normalizeNoteScale(note.scale) > 1 ? normalizeNoteScale(note.scale) : undefined,
      ...(note.createdAt === undefined ? {} : { createdAt: note.createdAt }),
      type: note.type,
      task: copyTaskState(note.task),
      taskMemory: copyTaskState(note.taskMemory),
      time: note.type === "time" ? copyTimeData(note.time) : undefined,
      message: note.type === "message" ? { ...(note.message ?? defaultMessageData()) } : undefined,
      importance: note.importance ?? null,
      purposes: [...new Set(note.purposes ?? [])],
      moods: [...new Set(note.moods ?? [])],
      color: note.type === "beacon" ? normalizeBeaconColor(note.color ?? "") ?? beaconPaletteColor(0) : note.color ?? null,
      zoneId: note.zoneId && validZoneIds.has(note.zoneId) ? note.zoneId : null,
      ...(note.scope ? { scope: note.scope } : {}),
      ...(note.tiers ? { tiers: note.tiers } : {}),
      ...(note.listItems ? { listItems: note.listItems } : {}),
      ...(note.source ? { source: note.source } : {}),
      ...(note.inboxGroup ? { inboxGroup: note.inboxGroup } : {}),
      ...(note.randomPick ? { randomPick: note.randomPick } : {}),
      ...(note.customMarks?.length ? { customMarks: note.customMarks } : {}),
      ...(note.customMarkFrame ? { customMarkFrame: true } : {}),
      ...(note.listStats ? { listStats: true } : {}),
      headerHidden: note.headerHidden === true ? true : undefined,
      smoothLines: note.smoothLines === true ? true : undefined,
      smoothLineAnchors: note.smoothLines === true ? copySmoothLineAnchorSnapshot(note.smoothLineAnchors) : undefined,
    };
  });
  validateUniqueNotes(indexedNotes);
  const serializedTrash = (nextTrash ?? previous?.trash ?? []).map(copyTrashEntry);
  const calculatorData = Object.assign(
    Object.create(null) as Record<string, CalculatorData>,
    ...serializedTrash.map((entry) => entry.calculators ?? {}),
    nextCalculators ?? previous?.calculators ?? {},
  );
  return JSON.stringify({
    ...previous,
    version: 3,
    createdAt: nextProjectMetadata?.createdAt ?? previous?.createdAt ?? fallbackProjectCreatedAt(notes),
    projectCounters: { ...(nextProjectMetadata?.projectCounters ?? previous?.projectCounters ?? { appMs: 0, activeMs: 0 }) },
    notes: indexedNotes,
    links: [...(nextLinks ?? previous?.links ?? [])],
    taskLog: [...(nextTaskLog ?? previous?.taskLog ?? [])].map((entry) => ({ ...entry })),
    zones: serializedZones,
    beaconMarks: sanitizeBeaconMarks(nextBeaconMarks ?? previous?.beaconMarks ?? [], indexedNotes).values,
    calculators: serializeCalculators(calculatorData, [
      ...notes,
      ...serializedTrash.flatMap((entry) => entry.notes),
    ]),
    archive: (nextArchive ?? previous?.archive ?? []).map(copyArchiveEntry),
    trash: serializedTrash,
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
    const fixedDimensions = fixedNodeDimensions(entry.type, entry.headerHidden === true);
    return {
      id: entry.id,
      type: entry.type,
      name: entry.name,
      text: entry.type === "calculator" ? "" : note.text,
      x: entry.x,
      y: entry.y,
      width: fixedDimensions?.width ?? entry.width,
      // Standalone Mood/Purpose nodes always size to their chips (auto height).
      height: fixedDimensions ? fixedDimensions.height : entry.type === "mood" || entry.type === "purpose" ? null : entry.height,
      ...(entry.scale === undefined ? {} : { scale: entry.scale }),
      task: copyTaskState(entry.task),
      taskMemory: copyTaskState(entry.taskMemory),
      ...(entry.time ? { time: copyTimeData(entry.time)! } : {}),
      ...(entry.type === "message" ? { message: { ...(entry.message ?? defaultMessageData()) } } : {}),
      importance: entry.importance,
      purposes: [...entry.purposes],
      ...(entry.moods.length > 0 ? { moods: [...entry.moods] } : {}),
      ...(entry.color ? { color: entry.color } : {}),
      ...(entry.zoneId ? { zoneId: entry.zoneId } : {}),
      ...(entry.scope ? { scope: entry.scope } : {}),
      ...(entry.tiers ? { tiers: entry.tiers } : {}),
      ...(entry.listItems ? { listItems: entry.listItems } : {}),
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.inboxGroup ? { inboxGroup: entry.inboxGroup } : {}),
      ...(entry.randomPick ? { randomPick: entry.randomPick } : {}),
      ...(entry.customMarks?.length ? { customMarks: entry.customMarks } : {}),
      ...(entry.customMarkFrame ? { customMarkFrame: true } : {}),
      ...(entry.listStats ? { listStats: true } : {}),
      ...(entry.headerHidden ? { headerHidden: true } : {}),
      ...(entry.smoothLines ? { smoothLines: true } : {}),
      ...(entry.smoothLines && entry.smoothLineAnchors
        ? { smoothLineAnchors: copySmoothLineAnchorSnapshot(entry.smoothLineAnchors) }
        : {}),
      ...(typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) && entry.createdAt >= 0
        ? { createdAt: entry.createdAt }
        : {}),
    };
  });
}

function fixedNodeDimensions(type: NoteKind, headerHidden = false): { width: number; height: number | null } | null {
  switch (type) {
    case "time": return { width: R5_BASE_WIDTHS.time, height: null };
    case "message": return { width: R5_BASE_WIDTHS.message, height: null };
    case "goal": return { width: R5_BASE_WIDTHS.goal, height: null };
    case "progress": return { width: R5_BASE_WIDTHS.progress, height: null };
    case "stats": return { width: R5_BASE_WIDTHS.stats, height: null };
    case "trash": return { width: R5_BASE_WIDTHS.trash, height: 40 - (headerHidden ? NOTE_HEADER_HEIGHT_UNITS : 0) };
    case "archive": return { width: R5_BASE_WIDTHS.archive, height: 40 - (headerHidden ? NOTE_HEADER_HEIGHT_UNITS : 0) };
    case "source": return { width: R5_BASE_WIDTHS.source, height: null };
    case "markas": return { width: R5_BASE_WIDTHS.markas, height: null };
    default: return null;
  }
}

function sanitizeCalculators(value: unknown): { values: Record<string, CalculatorData>; warnings: string[] } {
  if (value === undefined) return { values: {}, warnings: [] };
  if (!isRecord(value)) {
    return { values: {}, warnings: ["Invalid calculator data in board.json; calculator history was cleared."] };
  }

  const values = Object.create(null) as Record<string, CalculatorData>;
  let invalid = false;
  for (const [rawKey, rawData] of Object.entries(value)) {
    const key = calculatorKey(rawKey);
    const data = parseCalculatorData(rawData);
    if (!key || !data || Object.prototype.hasOwnProperty.call(values, key)) {
      invalid = true;
      continue;
    }
    values[key] = data;
  }
  return {
    values: Object.fromEntries(Object.entries(values)),
    warnings: invalid ? ["Invalid calculator data in board.json; invalid entries were discarded."] : [],
  };
}

/** Prefer named Markdown files for text nodes and reserve collision-free id-based paths for calculators. */
export function projectNoteFiles(notes: readonly Note[]): Map<string, string> {
  const files = new Map<string, string>();
  const occupied = new Set<string>();
  for (const note of notes) {
    if (note.type === "calculator") continue;
    const file = noteMarkdownFileName(note);
    files.set(note.id, file);
    occupied.add(noteFileKey(file.slice(0, -3)));
  }

  for (const note of notes) {
    if (note.type !== "calculator") continue;
    const base = calculatorNoteFileName(note.id).slice(0, -3);
    let file = `${base}.md`;
    let suffix = 2;
    while (occupied.has(noteFileKey(file.slice(0, -3)))) {
      file = `${sanitizeNoteName(`${base} ${suffix}`)}.md`;
      suffix += 1;
    }
    occupied.add(noteFileKey(file.slice(0, -3)));
    files.set(note.id, file);
  }
  return files;
}

/** Serialize canonical calculator keys and discard data with no matching calculator node. */
function serializeCalculators(
  value: Record<string, CalculatorData>,
  notes: readonly Note[],
): Record<string, CalculatorData> {
  const usedKeys = new Set(notes
    .filter((note) => note.type === "calculator")
    .map((note) => calculatorKey(note.name))
    .filter(Boolean));
  const values = Object.create(null) as Record<string, CalculatorData>;
  for (const [rawKey, rawData] of Object.entries(value)) {
    const key = calculatorKey(rawKey);
    const data = parseCalculatorData(rawData);
    if (!key || !usedKeys.has(key) || !data || Object.prototype.hasOwnProperty.call(values, key)) continue;
    values[key] = data;
  }
  return Object.fromEntries(Object.entries(values));
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

function parseNote(value: unknown, index: number, requireV2Fields: boolean, requireV3Fields: boolean,
  validZoneIds: ReadonlySet<string>): { note: IndexedNote; warnings: string[] } {
  if (!isRecord(value)) throw new Error(`Project note ${index + 1} must be an object.`);
  const id = value.id;
  const name = value.name;
  if (typeof id !== "string" || id.trim() === "" || id === ME_OBJECT_ID || id.length > 200 || id.includes("/") || id.includes("\\")) {
    throw new Error(`Project note ${index + 1} has an invalid id.`);
  }
  if (typeof name !== "string" || name.trim() === "" || name.length > 500) {
    throw new Error(`Project note ${id} has an invalid name.`);
  }

  const type = parseNoteKind(value.type);
  const file = typeof value.file === "string" && value.file.length > 0
    ? value.file
    : type === "calculator"
      ? calculatorNoteFileName(id)
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
  const scale = value.scale === undefined ? undefined : isValidNoteScale(value.scale) ? value.scale : null;
  if (scale === null) warnings.push(`Invalid scale for note ${id}; defaulted to 1.`);
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

  const color = typeof value.color === "string" ? normalizeBeaconColor(value.color) : null;
  if (value.color !== undefined && color === null && (value.color !== null || type === "beacon")) {
    warnings.push(`Invalid beacon colour for note ${id}; default colour was used.`);
  } else if (requireV3Fields && type === "beacon" && value.color === undefined) {
    warnings.push(`Missing beacon colour for note ${id}; default colour was used.`);
  }

  const message = type === "message" ? parseMessageData(value.message) ?? defaultMessageData() : undefined;
  const time = parseTimeData(value.time);
  if (value.time !== undefined && !time) warnings.push(`Invalid reminder schedule for note ${id}; reminder data was cleared.`);
  const smoothLines = value.smoothLines === true;
  const smoothLineAnchors = smoothLines && value.smoothLineAnchors !== undefined
    ? parseSmoothLineAnchorSnapshot(value.smoothLineAnchors)
    : undefined;
  if (smoothLines && value.smoothLineAnchors !== undefined && !smoothLineAnchors) {
    warnings.push(`Invalid smooth line anchors for note ${id}; anchors will be recalculated.`);
  }
  const zoneId = value.zoneId === undefined || value.zoneId === null ? null
    : typeof value.zoneId === "string" && validZoneIds.has(value.zoneId) ? value.zoneId : null;
  if (value.zoneId !== undefined && value.zoneId !== null && zoneId === null) {
    warnings.push(`Invalid zone membership for note ${id}; membership was cleared.`);
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
      scale: scale !== null && scale !== undefined && scale > 1 ? scale : undefined,
      type: type ?? "note",
      task,
      taskMemory,
      time: time ?? undefined,
      message,
      importance,
      purposes: purposes.values,
      moods: moods.values,
      color: type === "beacon" ? color ?? beaconPaletteColor(0) : color,
      zoneId,
      scope: parseScope(value.scope) ?? undefined,
      tiers: parseTiers(value.tiers) ?? undefined,
      listItems: parseListItems(value.listItems) ?? undefined,
      source: parseSource(value.source) ?? undefined,
      inboxGroup: typeof value.inboxGroup === "string" && value.inboxGroup ? value.inboxGroup : undefined,
      randomPick: parseRandomPick(value.randomPick) ?? undefined,
      customMarks: parseCustomMarks(value.customMarks) ?? undefined,
      customMarkFrame: value.customMarkFrame === true ? true : undefined,
      listStats: value.listStats === true ? true : undefined,
      smoothLines: smoothLines ? true : undefined,
      smoothLineAnchors: smoothLineAnchors ?? undefined,
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
    value === "importance" || value === "purpose" || value === "mood" || value === "beacon" ||
    value === "goal" || value === "progress" || value === "calculator" || value === "tierlist" || value === "stats" ||
    value === "archive" || value === "trash" ||
    value === "inbox" || value === "list" || value === "source" || value === "glossary" || value === "map" || value === "random" || value === "markas" || value === "time" || value === "message"
    ? value
    : null;
}

const DEFAULT_ZONE_COLOR = "#608ac1";
const MAX_ZONES = 10_000;
const MAX_ZONE_CONTOURS = 100;
const MAX_ZONE_POINTS = 512;

function sanitizeZones(value: unknown, requireV3Field: boolean): { zones: Zone[]; warnings: string[] } {
  if (value === undefined) {
    return {
      zones: [],
      warnings: requireV3Field ? ["Missing zones in board.json; defaulted to none."] : [],
    };
  }
  if (!Array.isArray(value)) return { zones: [], warnings: ["Invalid zones in board.json were discarded."] };
  if (value.length > MAX_ZONES) return { zones: [], warnings: ["Too many zones in board.json; all zones were discarded."] };

  const zones: Zone[] = [];
  const ids = new Set<string>();
  let dropped = false;
  let invalidColour = false;
  let invalidMetadata = false;
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      dropped = true;
      continue;
    }
    const { id, name } = candidate;
    if (typeof id !== "string" || !id.trim() || id.length > 200 || id === ME_OBJECT_ID ||
      id.includes("/") || id.includes("\\") || ids.has(id) ||
      typeof name !== "string" || !name.trim() || name.length > 500) {
      dropped = true;
      continue;
    }
    const parts = parsePolygons(candidate.parts);
    const holes = parsePolygons(candidate.holes, true);
    if (!parts || !holes) {
      dropped = true;
      continue;
    }

    let color = typeof candidate.color === "string" ? normalizeBeaconColor(candidate.color) : null;
    if (color === null) {
      color = DEFAULT_ZONE_COLOR;
      invalidColour = true;
    }
    let createdAt: number | undefined;
    if (candidate.createdAt !== undefined) {
      if (finiteNonnegative(candidate.createdAt)) createdAt = candidate.createdAt;
      else invalidMetadata = true;
    }
    const zoneExtras = { ...candidate };
    delete zoneExtras.createdAt;
    const zone = {
      ...zoneExtras,
      id,
      name,
      color,
      parts,
      holes,
      ...(createdAt === undefined ? {} : { createdAt }),
    } as Zone;
    zones.push(zone);
    ids.add(id);
  }
  const warnings: string[] = [];
  if (dropped) warnings.push("Invalid zones or polygons in board.json were discarded.");
  if (invalidColour) warnings.push("Invalid zone colours were replaced with the default colour.");
  if (invalidMetadata) warnings.push("Invalid zone creation times were cleared.");
  return { zones, warnings };
}

function parsePolygons(value: unknown, allowEmpty = false): Point[][] | null {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > MAX_ZONE_CONTOURS) return null;
  const polygons: Point[][] = [];
  for (const candidate of value) {
    if (!Array.isArray(candidate) || candidate.length < 4 || candidate.length > MAX_ZONE_POINTS) return null;
    const points: Point[] = [];
    for (const point of candidate) {
      if (!isRecord(point) || !finite(point.x) || !finite(point.y)) return null;
      points.push({ x: point.x, y: point.y });
    }
    if (!isValidPolygon(points)) return null;
    polygons.push(points);
  }
  return polygons;
}

function isValidPolygon(points: readonly Point[]): boolean {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current.x === next.x && current.y === next.y) return false;
    if (current.x !== next.x && current.y !== next.y) return false;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  if (Math.abs(twiceArea) < 1e-8) return false;
  for (let first = 0; first < points.length; first += 1) {
    const a = points[first];
    const b = points[(first + 1) % points.length];
    for (let second = first + 1; second < points.length; second += 1) {
      if (second === first || second === first + 1 || (first === 0 && second === points.length - 1)) continue;
      const c = points[second];
      const d = points[(second + 1) % points.length];
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = crossProduct(a, b, c);
  const abD = crossProduct(a, b, d);
  const cdA = crossProduct(c, d, a);
  const cdB = crossProduct(c, d, b);
  const epsilon = 1e-8;
  const sign = (value: number): -1 | 0 | 1 => value > epsilon ? 1 : value < -epsilon ? -1 : 0;
  const firstC = sign(abC);
  const firstD = sign(abD);
  const secondA = sign(cdA);
  const secondB = sign(cdB);
  if (firstC !== firstD && secondA !== secondB && firstC !== 0 && firstD !== 0 && secondA !== 0 && secondB !== 0) return true;
  return (firstC === 0 && pointOnSegment(a, b, c)) || (firstD === 0 && pointOnSegment(a, b, d)) ||
    (secondA === 0 && pointOnSegment(c, d, a)) || (secondB === 0 && pointOnSegment(c, d, b));
}

function pointOnSegment(a: Point, b: Point, point: Point): boolean {
  const epsilon = 1e-8;
  return point.x >= Math.min(a.x, b.x) - epsilon && point.x <= Math.max(a.x, b.x) + epsilon &&
    point.y >= Math.min(a.y, b.y) - epsilon && point.y <= Math.max(a.y, b.y) + epsilon;
}

function crossProduct(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function sanitizeBeaconMarks(value: unknown, notes: readonly IndexedNote[]): { values: string[]; warnings: string[] } {
  if (value === undefined) return { values: [], warnings: [] };
  if (!Array.isArray(value)) return { values: [], warnings: ["Invalid beacon marks were discarded."] };
  const validIds = new Set(notes.filter((note) => note.type === "beacon").map((note) => note.id));
  validIds.add(ME_OBJECT_ID);
  const values: string[] = [];
  let invalid = false;
  for (const candidate of value) {
    if (typeof candidate !== "string" || !validIds.has(candidate) || values.includes(candidate)) {
      invalid = true;
      continue;
    }
    values.push(candidate);
  }
  return { values, warnings: invalid ? ["Invalid beacon marks were discarded."] : [] };
}

function copyZone(zone: Zone): Zone {
  return {
    ...zone,
    parts: zone.parts.map((part) => part.map((point) => ({ ...point }))),
    holes: zone.holes.map((hole) => hole.map((point) => ({ ...point }))),
  };
}

function copySmoothLineAnchorSnapshot(snapshot: Note["smoothLineAnchors"]): Note["smoothLineAnchors"] {
  if (!snapshot) return undefined;
  return Object.fromEntries(Object.entries(snapshot).map(([linkId, anchor]) => [linkId, anchor ? { ...anchor } : null]));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteNonnegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}

function sanitizeProjectCounters(value: unknown): { value: ProjectTimeCounters; invalid: boolean } {
  if (value === undefined) return { value: { appMs: 0, activeMs: 0 }, invalid: false };
  if (!isRecord(value)) return { value: { appMs: 0, activeMs: 0 }, invalid: true };
  const validApp = finiteNonnegative(value.appMs);
  const validActive = finiteNonnegative(value.activeMs);
  return {
    value: { appMs: validApp ? value.appMs as number : 0, activeMs: validActive ? value.activeMs as number : 0 },
    invalid: !validApp || !validActive,
  };
}

function fallbackProjectCreatedAt(notes: readonly Note[]): number {
  let earliest: number | undefined;
  for (const note of notes) {
    if (!finiteNonnegative(note.createdAt)) continue;
    earliest = earliest === undefined ? note.createdAt : Math.min(earliest, note.createdAt);
  }
  return earliest ?? Date.now();
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

function copyTimeData(value: TimeNodeData | undefined): TimeNodeData | undefined {
  if (!value) return undefined;
  return {
    schedule: { ...value.schedule },
    enabled: value.enabled,
    ...(value.taskMode ? { taskMode: value.taskMode } : {}),
    ...(value.view ? { view: value.view } : {}),
    ...(value.stopwatch ? { stopwatch: copyStopwatchData(value.stopwatch)! } : {}),
    ...(value.runtime ? { runtime: { ...value.runtime } } : {}),
  };
}

function parseTimeData(value: unknown): TimeNodeData | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.enabled !== "boolean" || !isRecord(value.schedule)) return null;
  const raw = value.schedule;
  let schedule: TimeSchedule;
  if (raw.kind === "at") {
    const date = raw.date === undefined ? null : raw.date;
    if (typeof raw.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time) ||
      !(date === null || typeof date === "string" && isValidDate(date))) return null;
    schedule = { kind: "at", date, time: raw.time };
  } else if (raw.kind === "interval") {
    if (typeof raw.minutes !== "number" || !Number.isFinite(raw.minutes) || raw.minutes < 1 ||
      !isCountMode(raw.mode) || typeof raw.repeat !== "boolean") return null;
    schedule = { kind: "interval", minutes: raw.minutes, mode: raw.mode, repeat: raw.repeat };
  } else return null;

  let runtime: TimeRuntime | undefined;
  if (value.runtime !== undefined) {
    if (!isRecord(value.runtime)) return null;
    const candidate = value.runtime;
    if (candidate.lastFiredKey !== undefined && typeof candidate.lastFiredKey !== "string" ||
      candidate.intervalStartedAt !== undefined && !finiteNonnegative(candidate.intervalStartedAt) ||
      candidate.countedMs !== undefined && !finiteNonnegative(candidate.countedMs) ||
      candidate.lastCheckedAt !== undefined && !finiteNonnegative(candidate.lastCheckedAt)) return null;
    runtime = {
      ...(typeof candidate.lastFiredKey === "string" ? { lastFiredKey: candidate.lastFiredKey } : {}),
      ...(typeof candidate.intervalStartedAt === "number" ? { intervalStartedAt: candidate.intervalStartedAt } : {}),
      ...(typeof candidate.countedMs === "number" ? { countedMs: candidate.countedMs } : {}),
      ...(typeof candidate.lastCheckedAt === "number" ? { lastCheckedAt: candidate.lastCheckedAt } : {}),
    };
  }
  const view = value.view === undefined || value.view === "time" ? value.view : value.view === "stopwatch" ? value.view : null;
  const stopwatch = parseStopwatchData(value.stopwatch);
  if (view === null || stopwatch === null) return null;
  return {
    schedule,
    enabled: value.enabled,
    ...(value.taskMode === "stop" || value.taskMode === "restart" ? { taskMode: value.taskMode } : {}),
    ...(view ? { view } : {}),
    ...(stopwatch ? { stopwatch } : {}),
    ...(runtime ? { runtime } : {}),
  };
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isCountMode(value: unknown): value is CountMode {
  return value === "calendar" || value === "app" || value === "active";
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
      ...(typeof candidate.transferDeclined === "boolean" ? { transferDeclined: candidate.transferDeclined } : {}),
      ...(typeof candidate.transferOriginalText === "string" ? { transferOriginalText: candidate.transferOriginalText } : {}),
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
