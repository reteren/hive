import type { Point } from "../board/cameraMath";
import { ME_OBJECT_ID, pairKey, type Link } from "../model/link";
import { calculatorKey } from "../model/nodeData";
import { normalizeNoteScale, type Note } from "../model/note";
import type { ArchiveEntry } from "../model/retention.svelte";
import { estimatedCreationHeight } from "../notes/creationPosition";
import { uniqueName } from "../notes/naming";
import { copyTierRows } from "../tierlist/logic";

export type RestorePlacement = "old" | "centre";

export interface ArchiveRestorePlan {
  note: Note;
  links: Link[];
  missingLinks: Link[];
  nameChanged: boolean;
  placeOccupied: boolean;
  calculatorUsesLiveData: boolean;
}

/** Archive view nodes and beacons are navigation objects; all content and module nodes are eligible. */
export function canArchiveNote(note: Note | undefined): boolean {
  return !!note && note.type !== "beacon" && note.type !== "archive" && note.type !== "trash";
}

export function copyArchivedNote(note: Note): Note {
  return {
    ...note,
    ...(note.task ? { task: { ...note.task } } : {}),
    ...(note.taskMemory ? { taskMemory: { ...note.taskMemory } } : {}),
    ...(note.message ? { message: { ...note.message } } : {}),
    ...(note.time ? { time: { ...note.time, schedule: { ...note.time.schedule }, ...(note.time.runtime ? { runtime: { ...note.time.runtime } } : {}) } } : {}),
    ...(note.purposes ? { purposes: [...note.purposes] } : {}),
    ...(note.moods ? { moods: [...note.moods] } : {}),
    ...(note.smoothLineAnchors ? { smoothLineAnchors: copySmoothLineAnchorSnapshot(note.smoothLineAnchors) } : {}),
    ...(note.scope ? { scope: { ...note.scope } } : {}),
    ...(note.tiers ? { tiers: copyTierRows(note.tiers) } : {}),
  };
}

function copySmoothLineAnchorSnapshot(snapshot: NonNullable<Note["smoothLineAnchors"]>): NonNullable<Note["smoothLineAnchors"]> {
  return Object.fromEntries(Object.entries(snapshot).map(([linkId, anchor]) => [linkId, anchor ? { ...anchor } : null]));
}

export function copyArchivedLink(link: Link): Link {
  return {
    ...link,
    ...(link.fromAnchor ? { fromAnchor: { ...link.fromAnchor } } : {}),
    ...(link.toAnchor ? { toAnchor: { ...link.toAnchor } } : {}),
  };
}

/** Preview exactly what a restore will do before running its one Undo command. */
export function planArchiveRestore(
  entry: ArchiveEntry,
  placement: RestorePlacement,
  centre: Point,
  activeNotes: readonly Note[],
  activeLinks: readonly Link[],
  activeCalculatorKeys: readonly string[] = [],
): ArchiveRestorePlan {
  const note = copyArchivedNote(entry.note);
  const name = uniqueName(note.name, activeNotes
    .filter((item) => note.type !== "calculator" || item.type !== "calculator")
    .map((item) => item.name));
  const scale = normalizeNoteScale(note.scale);
  const width = note.width * scale;
  const height = estimatedCreationHeight(note) * scale;
  if (placement === "centre") {
    note.x = centre.x - width / 2;
    note.y = centre.y - height / 2;
  }
  note.name = name;

  const occupiedPairs = new Set(activeLinks.map((link) => pairKey(link.from, link.to)));
  const occupiedIds = new Set(activeLinks.map((link) => link.id));
  const available = new Set([ME_OBJECT_ID, note.id, ...activeNotes.map((item) => item.id)]);
  const links: Link[] = [];
  const missingLinks: Link[] = [];
  for (const original of entry.links) {
    const link = copyArchivedLink(original);
    const key = pairKey(link.from, link.to);
    if (!available.has(link.from) || !available.has(link.to) || occupiedIds.has(link.id) || occupiedPairs.has(key)) {
      missingLinks.push(link);
      continue;
    }
    links.push(link);
    occupiedIds.add(link.id);
    occupiedPairs.add(key);
  }

  return {
    note,
    links,
    missingLinks,
    nameChanged: name !== entry.note.name,
    placeOccupied: activeNotes.some((other) => overlaps(
      note, width, height, other, other.width * normalizeNoteScale(other.scale),
      estimatedCreationHeight(other) * normalizeNoteScale(other.scale),
    )),
    calculatorUsesLiveData: note.type === "calculator" &&
      activeCalculatorKeys.includes(calculatorKey(note.name)),
  };
}

function overlaps(first: Note, firstWidth: number, firstHeight: number, second: Note, secondWidth: number, secondHeight: number): boolean {
  return first.x < second.x + secondWidth && second.x < first.x + firstWidth &&
    first.y < second.y + secondHeight && second.y < first.y + firstHeight;
}
