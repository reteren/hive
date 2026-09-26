import type { Point } from "../board/cameraMath";
import { ME_OBJECT_ID, pairKey, type Link } from "../model/link";
import { calculatorKey } from "../model/nodeData";
import type { Note } from "../model/note";
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
    ...(note.purposes ? { purposes: [...note.purposes] } : {}),
    ...(note.moods ? { moods: [...note.moods] } : {}),
    ...(note.scope ? { scope: { ...note.scope } } : {}),
    ...(note.tiers ? { tiers: copyTierRows(note.tiers) } : {}),
  };
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
  const height = estimatedCreationHeight(note);
  if (placement === "centre") {
    note.x = centre.x - note.width / 2;
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
    placeOccupied: activeNotes.some((other) => overlaps(note, height, other, estimatedCreationHeight(other))),
    calculatorUsesLiveData: note.type === "calculator" &&
      activeCalculatorKeys.includes(calculatorKey(note.name)),
  };
}

function overlaps(first: Note, firstHeight: number, second: Note, secondHeight: number): boolean {
  return first.x < second.x + second.width && second.x < first.x + first.width &&
    first.y < second.y + secondHeight && second.y < first.y + firstHeight;
}
