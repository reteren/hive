import { defaultMessageData, parseMessageData } from "../messages/data";
import { isFrameAnchor, parseSmoothLineAnchorSnapshot } from "../links/anchors";
import { ME_OBJECT_ID, pairKey, type Link } from "../model/link";
import { calculatorKey, parseCalculatorData, parseScope, parseTiers, type CalculatorData, parseListItems, parseRandomPick, parseSource, parseCustomMarks } from "../model/nodeData";
import { IMPORTANCE_LEVELS, isValidNoteScale, MOOD_KINDS, PURPOSE_KINDS, type Note, type NoteKind, type TaskState } from "../model/note";
import type { TrashEntry } from "../model/retention.svelte";
import type { Zone } from "../model/zone";
import type { CountMode, TimeNodeData, TimeRuntime, TimeSchedule } from "../time/types";
import { parseCalendarRule, parseStopwatchData } from "../time/data";
import { copyTimeForHost, parseEmbedSections } from "../combo/data";
import { normalizeImageOpacity, parseImageRef } from "../images/imageLogic";
import { normalizePdfZoom, parseMediaRef } from "../formats/formatLogic";
import { copyAudioRecordings, parseAudioRecordings } from "../audio/recordingData";
import { parseYouTubeRef } from "../youtube/logic";
import { copyTrashEntry } from "./trash";
import { parseNoteGlow } from "../notes/noteGlowLogic";

const NOTE_KINDS = new Set<NoteKind>([
  "note", "pro", "con", "importance", "purpose", "mood", "beacon",
  "goal", "progress", "calculator", "tierlist", "stats", "archive", "trash",
  "inbox", "list", "source", "glossary", "map", "random", "markas", "time", "message", "calendar", "image", "pdf", "format", "audio", "video", "youtube",
]);
const LINK_SHAPES = new Set<Link["shape"]>(["base", "orthogonal", "zigzag", "wave"]);
const MAX_ENTRIES = 10_000;

/** Tolerantly load saved trash; malformed entries are omitted with a visible warning. */
export function sanitizeTrashEntries(value: unknown): { entries: TrashEntry[]; warnings: string[] } {
  if (value === undefined) return { entries: [], warnings: [] };
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) {
    return { entries: [], warnings: ["Invalid or oversized trash in board.json; no entries were loaded."] };
  }

  const entries: TrashEntry[] = [];
  const entryIds = new Set<string>();
  const noteIds = new Set<string>();
  const zoneIds = new Set<string>();
  let invalid = false;
  for (const candidate of value) {
    if (!isRecord(candidate) || !validId(candidate.id) || entryIds.has(candidate.id) ||
      !finite(candidate.deletedAt) || candidate.deletedAt < 0 ||
      !Array.isArray(candidate.notes) || !Array.isArray(candidate.zones) || !Array.isArray(candidate.links)) {
      invalid = true;
      continue;
    }

    const notes = candidate.notes.map(parseTrashNote);
    const zones = candidate.zones.map(parseTrashZone);
    if (notes.some((note) => note === null) || zones.some((zone) => zone === null)) {
      invalid = true;
      continue;
    }
    const safeNotes = notes as Note[];
    const safeZones = zones as Zone[];
    if (safeNotes.length === 0 && safeZones.length === 0 ||
      safeNotes.some((note) => noteIds.has(note.id)) || safeZones.some((zone) => zoneIds.has(zone.id)) ||
      safeNotes.some((note) => safeZones.some((zone) => zone.id === note.id))) {
      invalid = true;
      continue;
    }

    const links: Link[] = [];
    const linkIds = new Set<string>();
    const pairs = new Set<string>();
    for (const rawLink of candidate.links) {
      const link = parseTrashLink(rawLink);
      if (!link || linkIds.has(link.id) || pairs.has(pairKey(link.from, link.to))) {
        invalid = true;
        continue;
      }
      links.push(link);
      linkIds.add(link.id);
      pairs.add(pairKey(link.from, link.to));
    }

    const calculators: Record<string, CalculatorData> = Object.create(null) as Record<string, CalculatorData>;
    if (candidate.calculators !== undefined) {
      if (!isRecord(candidate.calculators)) {
        invalid = true;
      } else {
        const calculatorNames = new Set(safeNotes
          .filter((note) => note.type === "calculator")
          .map((note) => calculatorKey(note.name)));
        for (const [rawKey, rawData] of Object.entries(candidate.calculators)) {
          const key = calculatorKey(rawKey);
          const data = parseCalculatorData(rawData);
          if (!key || !data || !calculatorNames.has(key)) {
            invalid = true;
            continue;
          }
          calculators[key] = data;
        }
      }
    }

    entries.push({
      id: candidate.id,
      deletedAt: candidate.deletedAt,
      notes: safeNotes,
      zones: safeZones,
      links,
      ...(Object.keys(calculators).length > 0 ? { calculators } : {}),
    });
    entryIds.add(candidate.id);
    safeNotes.forEach((note) => noteIds.add(note.id));
    safeZones.forEach((zone) => zoneIds.add(zone.id));
  }
  return {
    entries: entries.map(copyTrashEntry),
    warnings: invalid ? ["Invalid trash data in board.json was skipped; check the project backup before saving."] : [],
  };
}

function parseTrashNote(value: unknown): Note | null {
  if (!isRecord(value) || !validId(value.id) || value.id === ME_OBJECT_ID ||
    typeof value.name !== "string" || !value.name.trim() || value.name.length > 500 ||
    typeof value.text !== "string" || !NOTE_KINDS.has(value.type as NoteKind) ||
    !finite(value.x) || !finite(value.y) || !finite(value.width) || value.width <= 0 ||
    value.scale !== undefined && !isValidNoteScale(value.scale) ||
    !(value.height === null || value.height === undefined || finite(value.height) && value.height > 0)) return null;
  const task = parseTask(value.task);
  const taskMemory = parseTask(value.taskMemory);
  const time = parseTimeData(value.time);
  const message = parseMessageData(value.message);
  const embedSections = parseEmbedSections(value.embedSections);
  const image = value.image === undefined ? null : parseImageRef(value.image);
  const opacity = value.opacity === undefined ? undefined : normalizeImageOpacity(value.opacity);
  const media = value.media === undefined ? null : parseMediaRef(value.media);
  const pdfZoom = value.pdfZoom === undefined ? undefined : normalizePdfZoom(value.pdfZoom);
  const recordings = value.recordings === undefined ? undefined : parseAudioRecordings(value.recordings);
  const youtube = value.youtube === undefined ? null : parseYouTubeRef(value.youtube) ?? null;
  const glow = parseNoteGlow(value.glow);
  if (task === false || taskMemory === false ||
    value.time !== undefined && !time ||
    value.message !== undefined && !message ||
    value.embedSections !== undefined && !embedSections ||
    value.importance !== undefined && value.importance !== null && !IMPORTANCE_LEVELS.includes(value.importance as typeof IMPORTANCE_LEVELS[number]) ||
    value.purposes !== undefined && (!Array.isArray(value.purposes) || value.purposes.some((item) => !PURPOSE_KINDS.includes(item as typeof PURPOSE_KINDS[number]))) ||
    value.moods !== undefined && (!Array.isArray(value.moods) || value.moods.some((item) => !MOOD_KINDS.includes(item as typeof MOOD_KINDS[number]))) ||
    value.color !== undefined && typeof value.color !== "string" ||
    value.zoneId !== undefined && value.zoneId !== null && typeof value.zoneId !== "string" ||
    value.createdAt !== undefined && !finite(value.createdAt) ||
    value.image !== undefined && !image || value.type === "image" && (!image || !finite(value.height) || value.height <= 0) ||
    value.media !== undefined && !media || value.type === "pdf" && media?.kind !== "pdf" || value.type === "format" && media?.kind !== "text" || value.type === "audio" && media?.kind !== "audio" && !recordings || value.type === "video" && media?.kind !== "video" ||
    value.recordings !== undefined && (value.type !== "audio" || !recordings) ||
    value.youtube !== undefined && !youtube || value.type === "youtube" && !youtube ||
    value.headerHidden !== undefined && typeof value.headerHidden !== "boolean" ||
    value.pdfZoom !== undefined && (value.type !== "pdf" || pdfZoom === undefined) ||
    value.opacity !== undefined && (value.type !== "image" || opacity === undefined) ||
    value.frameHidden !== undefined && (value.type !== "youtube" && value.type !== "video" || value.frameHidden !== true) ||
    value.flipX !== undefined && value.flipX !== true || value.flipY !== undefined && value.flipY !== true ||
    value.gifStopped !== undefined && value.gifStopped !== true) return null;
  const scope = value.scope === undefined ? undefined : parseScope(value.scope);
  const tiers = value.tiers === undefined ? undefined : parseTiers(value.tiers);
  if (scope === null || tiers === null) return null;
  const smoothLineAnchors = value.smoothLines === true && value.smoothLineAnchors !== undefined
    ? parseSmoothLineAnchorSnapshot(value.smoothLineAnchors) ?? undefined
    : undefined;
  return {
    id: value.id,
    type: value.type as NoteKind,
    name: value.name,
    text: value.text,
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height ?? null,
    ...(typeof value.scale === "number" && value.scale > 1 ? { scale: value.scale } : {}),
    ...(task ? { task } : {}),
    ...(taskMemory ? { taskMemory } : {}),
    ...(time ? { time: copyTimeForHost(value.type as NoteKind, time) } : {}),
    ...(value.type === "message" ? { message: message ?? defaultMessageData() } : message ? { message } : {}),
    ...(embedSections ? { embedSections } : {}),
    ...(image ? { image } : {}),
    ...(value.type === "image" && opacity !== undefined ? { opacity } : {}),
    ...(media ? { media } : {}),
    ...(value.type === "pdf" && pdfZoom !== undefined ? { pdfZoom } : {}),
    ...(recordings ? { recordings: copyAudioRecordings(recordings) } : {}),
    ...(youtube ? { youtube } : {}),
    ...(glow ? { glow } : {}),
    ...((value.type === "youtube" || value.type === "video") && value.frameHidden === true ? { frameHidden: true } : {}),
    ...(value.type === "image" && value.flipX === true ? { flipX: true } : {}),
    ...(value.type === "image" && value.flipY === true ? { flipY: true } : {}),
    ...(value.type === "image" && value.gifStopped === true ? { gifStopped: true } : {}),
    ...(value.headerHidden === true ? { headerHidden: true } : {}),
    ...(value.importance ? { importance: value.importance as Note["importance"] } : {}),
    ...(value.purposes ? { purposes: value.purposes as Note["purposes"] } : {}),
    ...(value.moods ? { moods: value.moods as Note["moods"] } : {}),
    ...(scope ? { scope } : {}),
    ...(tiers ? { tiers } : {}),
    ...(parseListItems(value.listItems) ? { listItems: parseListItems(value.listItems)! } : {}),
    ...(parseSource(value.source) ? { source: parseSource(value.source)! } : {}),
    ...(typeof value.inboxGroup === "string" && value.inboxGroup ? { inboxGroup: value.inboxGroup } : {}),
    ...(parseRandomPick(value.randomPick) ? { randomPick: parseRandomPick(value.randomPick)! } : {}),
    ...(parseCustomMarks(value.customMarks) ? { customMarks: parseCustomMarks(value.customMarks)! } : {}),
    ...(value.customMarkFrame === true ? { customMarkFrame: true } : {}),
    ...(value.listStats === true ? { listStats: true } : {}),
    ...(value.headerHidden === true ? { headerHidden: true } : {}),
    ...(value.smoothLines === true ? { smoothLines: true } : {}),
    ...(smoothLineAnchors ? { smoothLineAnchors } : {}),
    ...(typeof value.color === "string" ? { color: value.color } : {}),
    ...(typeof value.accentColor === "string" && /^#[0-9a-f]{6}$/i.test(value.accentColor) ? { accentColor: value.accentColor } : {}),
    ...(typeof value.zoneId === "string" ? { zoneId: value.zoneId } : {}),
    ...(finite(value.createdAt) ? { createdAt: value.createdAt } : {}),
  };
}

function parseTrashZone(value: unknown): Zone | null {
  if (!isRecord(value) || !validId(value.id) || typeof value.name !== "string" || !value.name.trim() ||
    typeof value.color !== "string" || !/^#[0-9a-f]{6}$/i.test(value.color) ||
    value.createdAt !== undefined && !finite(value.createdAt) ||
    !Array.isArray(value.parts) || !Array.isArray(value.holes)) return null;
  const parts = parseContours(value.parts);
  const holes = parseContours(value.holes);
  if (!parts || !holes || parts.length === 0) return null;
  return {
    id: value.id,
    name: value.name,
    color: value.color,
    parts,
    holes,
    ...(finite(value.createdAt) ? { createdAt: value.createdAt } : {}),
  };
}

function parseContours(value: unknown): Zone["parts"] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const contours: Zone["parts"] = [];
  for (const contour of value) {
    if (!Array.isArray(contour) || contour.length < 3 || contour.length > 512) return null;
    const points = contour.map((point) => isRecord(point) && finite(point.x) && finite(point.y)
      ? { x: point.x, y: point.y }
      : null);
    if (points.some((point) => point === null)) return null;
    contours.push(points as Zone["parts"][number]);
  }
  return contours;
}

function parseTrashLink(value: unknown): Link | null {
  if (!isRecord(value) || !validId(value.id) || !validId(value.from) || !validId(value.to) ||
    value.from === value.to || value.kind !== "strong" && value.kind !== "weak" ||
    !LINK_SHAPES.has(value.shape as Link["shape"]) ||
    value.fromAnchor !== undefined && !isFrameAnchor(value.fromAnchor) ||
    value.toAnchor !== undefined && !isFrameAnchor(value.toAnchor) ||
    value.transferDeclined !== undefined && typeof value.transferDeclined !== "boolean" ||
    value.transferOriginalText !== undefined && typeof value.transferOriginalText !== "string") return null;
  return {
    id: value.id,
    from: value.from,
    to: value.to,
    kind: value.kind,
    shape: value.shape as Link["shape"],
    ...(value.fromAnchor ? { fromAnchor: value.fromAnchor as Link["fromAnchor"] } : {}),
    ...(value.toAnchor ? { toAnchor: value.toAnchor as Link["toAnchor"] } : {}),
    ...(typeof value.transferDeclined === "boolean" ? { transferDeclined: value.transferDeclined } : {}),
    ...(typeof value.transferOriginalText === "string" ? { transferOriginalText: value.transferOriginalText } : {}),
  };
}

function parseTask(value: unknown): TaskState | null | false {
  if (value === undefined || value === null) return null;
  return isRecord(value) && typeof value.done === "boolean" &&
    (value.doneAt === null || finite(value.doneAt) && value.doneAt >= 0)
    ? { done: value.done, doneAt: value.doneAt as number | null }
    : false;
}

function parseTimeData(value: unknown): TimeNodeData | null {
  if (value === undefined) return null;
  if (!isRecord(value) || typeof value.enabled !== "boolean" || !isRecord(value.schedule)) return null;
  const raw = value.schedule;
  let schedule: TimeSchedule;
  if (raw.kind === "at") {
    const date = raw.date === undefined ? null : raw.date;
    const rule = parseCalendarRule(raw.rule);
    if (typeof raw.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time) ||
      !(date === null || typeof date === "string" && isValidDate(date)) || raw.rule !== undefined && rule === null) return null;
    schedule = { kind: "at", date, time: raw.time, ...(rule ? { rule } : {}) };
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

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("/") && !value.includes("\\");
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
