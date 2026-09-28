import { isFrameAnchor } from "../links/anchors";
import { pairKey, type Link } from "../model/link";
import { parseCalculatorData, parseScope, parseTiers, parseListItems, parseRandomPick, parseSource, parseCustomMarks } from "../model/nodeData";
import { IMPORTANCE_LEVELS, isValidNoteScale, MOOD_KINDS, PURPOSE_KINDS, type Note, type NoteKind, type TaskState } from "../model/note";
import type { ArchiveEntry } from "../model/retention.svelte";
import { copyArchivedLink, copyArchivedNote } from "./logic";

const ARCHIVABLE_KINDS = new Set<NoteKind>([
  "note", "pro", "con", "importance", "purpose", "mood",
  "goal", "progress", "calculator", "tierlist", "stats",
  "inbox", "list", "source", "glossary", "map", "random", "markas",
]);
const LINK_SHAPES = new Set<Link["shape"]>(["base", "orthogonal", "zigzag", "wave"]);

export function copyArchiveEntry(entry: ArchiveEntry): ArchiveEntry {
  return {
    id: entry.id,
    archivedAt: entry.archivedAt,
    note: copyArchivedNote(entry.note),
    links: entry.links.map(copyArchivedLink),
    ...(entry.calculatorData ? { calculatorData: parseCalculatorData(entry.calculatorData) ?? undefined } : {}),
  };
}

/** Keep dangling link ends for the restore preview; they are never added to the live board. */
export function sanitizeArchiveEntries(value: unknown): { entries: ArchiveEntry[]; warnings: string[] } {
  if (value === undefined) return { entries: [], warnings: [] };
  if (!Array.isArray(value)) return { entries: [], warnings: ["Invalid archive in board.json; no entries were loaded."] };
  const entries: ArchiveEntry[] = [];
  const entryIds = new Set<string>();
  const noteIds = new Set<string>();
  let invalid = false;
  for (const candidate of value) {
    if (!isRecord(candidate) || !validId(candidate.id) || entryIds.has(candidate.id) ||
      !Number.isFinite(candidate.archivedAt) || (candidate.archivedAt as number) < 0 ||
      (candidate.archivedAt as number) > 8.64e15) {
      invalid = true;
      continue;
    }
    const note = parseArchivedNote(candidate.note);
    if (!note || noteIds.has(note.id) || !Array.isArray(candidate.links)) {
      invalid = true;
      continue;
    }
    const links: Link[] = [];
    const linkIds = new Set<string>();
    const pairs = new Set<string>();
    for (const rawLink of candidate.links) {
      const link = parseArchivedLink(rawLink, note.id);
      if (!link || linkIds.has(link.id) || pairs.has(pairKey(link.from, link.to))) {
        invalid = true;
        continue;
      }
      links.push(link);
      linkIds.add(link.id);
      pairs.add(pairKey(link.from, link.to));
    }
    const calculatorData = candidate.calculatorData === undefined ? null : parseCalculatorData(candidate.calculatorData);
    if (candidate.calculatorData !== undefined && !calculatorData) invalid = true;
    entries.push({
      id: candidate.id,
      archivedAt: candidate.archivedAt as number,
      note,
      links,
      ...(calculatorData && note.type === "calculator" ? { calculatorData } : {}),
    });
    entryIds.add(candidate.id);
    noteIds.add(note.id);
  }
  return {
    entries,
    warnings: invalid ? ["Invalid archive data in board.json was skipped; check the project backup before saving."] : [],
  };
}

function parseArchivedNote(value: unknown): Note | null {
  if (!isRecord(value) || !validId(value.id) || typeof value.name !== "string" || !value.name.trim() ||
    typeof value.text !== "string" || !ARCHIVABLE_KINDS.has(value.type as NoteKind) ||
    !finite(value.x) || !finite(value.y) || !finite(value.width) || value.width <= 0 ||
    value.scale !== undefined && !isValidNoteScale(value.scale) ||
    !(value.height === null || value.height === undefined || finite(value.height) && value.height > 0)) return null;
  const task = parseTask(value.task);
  const taskMemory = parseTask(value.taskMemory);
  if (task === false || taskMemory === false) return null;
  if (value.importance !== undefined && value.importance !== null && !IMPORTANCE_LEVELS.includes(value.importance as typeof IMPORTANCE_LEVELS[number])) return null;
  if (value.purposes !== undefined && (!Array.isArray(value.purposes) ||
    value.purposes.some((item) => !PURPOSE_KINDS.includes(item)))) return null;
  if (value.moods !== undefined && (!Array.isArray(value.moods) ||
    value.moods.some((item) => !MOOD_KINDS.includes(item)))) return null;
  const scope = value.scope === undefined ? undefined : parseScope(value.scope);
  const tiers = value.tiers === undefined ? undefined : parseTiers(value.tiers);
  if (scope === null || tiers === null || value.color !== undefined && typeof value.color !== "string" ||
    value.zoneId !== undefined && value.zoneId !== null && typeof value.zoneId !== "string" ||
    value.createdAt !== undefined && !finite(value.createdAt)) return null;
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
    ...(typeof value.color === "string" ? { color: value.color } : {}),
    ...(typeof value.zoneId === "string" ? { zoneId: value.zoneId } : {}),
    ...(typeof value.createdAt === "number" ? { createdAt: value.createdAt } : {}),
  };
}

function parseArchivedLink(value: unknown, archivedNoteId: string): Link | null {
  if (!isRecord(value) || !validId(value.id) || !validId(value.from) || !validId(value.to) ||
    value.from === value.to || value.from !== archivedNoteId && value.to !== archivedNoteId ||
    value.kind !== "strong" && value.kind !== "weak" || !LINK_SHAPES.has(value.shape as Link["shape"]) ||
    value.fromAnchor !== undefined && !isFrameAnchor(value.fromAnchor) ||
    value.toAnchor !== undefined && !isFrameAnchor(value.toAnchor)) return null;
  return {
    id: value.id, from: value.from, to: value.to, kind: value.kind, shape: value.shape as Link["shape"],
    ...(value.fromAnchor ? { fromAnchor: value.fromAnchor as Link["fromAnchor"] } : {}),
    ...(value.toAnchor ? { toAnchor: value.toAnchor as Link["toAnchor"] } : {}),
    ...(typeof value.transferDeclined === "boolean" ? { transferDeclined: value.transferDeclined } : {}),
    ...(typeof value.transferOriginalText === "string" ? { transferOriginalText: value.transferOriginalText } : {}),
  };
}

function parseTask(value: unknown): TaskState | null | false {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.done !== "boolean" ||
    !(value.doneAt === null || finite(value.doneAt) && value.doneAt >= 0)) return false;
  return { done: value.done, doneAt: value.doneAt as number | null };
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
