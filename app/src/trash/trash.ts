import { uniqueName } from "../notes/naming";
import { ME_OBJECT_ID, pairKey, type Link } from "../model/link";
import type { CalculatorData } from "../model/nodeData";
import type { Note } from "../model/note";
import type { TrashEntry } from "../model/retention.svelte";
import type { Zone } from "../model/zone";
import { copyTimeNodeData } from "../time/data";

export interface TrashRename {
  noteId: string;
  from: string;
  to: string;
}

export interface TrashBrokenLink {
  link: Link;
  missingEndpoints: string[];
  reason: "missing-endpoint" | "link-id-exists" | "pair-exists";
}

export interface TrashRestorePreview {
  linksRestored: Link[];
  linksBroken: TrashBrokenLink[];
  renamed: TrashRename[];
  idConflicts: string[];
}

export interface TrashRestorePlan extends TrashRestorePreview {
  notes: Note[];
}

export interface TrashListItem extends TrashEntry {
  summary: string;
}

/** Resolve names and surviving links without changing the board or trash. */
export function planTrashRestore(
  entry: TrashEntry,
  existingNotes: readonly Note[],
  existingLinks: readonly Link[],
): TrashRestorePlan {
  const existingIds = new Set(existingNotes.map((note) => note.id));
  const reservedNames = existingNotes.filter((note) => note.type !== "calculator").map((note) => note.name);
  const idConflicts: string[] = [];
  const renamed: TrashRename[] = [];
  const notes = entry.notes.map((note) => {
    if (existingIds.has(note.id)) idConflicts.push(note.id);
    const name = uniqueName(note.name, reservedNames);
    if (note.type !== "calculator") reservedNames.push(name);
    if (name !== note.name) renamed.push({ noteId: note.id, from: note.name, to: name });
    return copyTrashNote({ ...note, name });
  });

  const restoreNoteIds = new Set(entry.notes.map((note) => note.id));
  const knownPairs = new Set(existingLinks.map((link) => pairKey(link.from, link.to)));
  const knownLinkIds = new Set(existingLinks.map((link) => link.id));
  const linksRestored: Link[] = [];
  const linksBroken: TrashBrokenLink[] = [];

  for (const source of entry.links) {
    const link = copyTrashLink(source);
    const missingEndpoints = [link.from, link.to].filter((id) =>
      !(id === ME_OBJECT_ID && link.from === id) && !existingIds.has(id) && !restoreNoteIds.has(id),
    );
    if (missingEndpoints.length > 0) {
      linksBroken.push({ link, missingEndpoints, reason: "missing-endpoint" });
      continue;
    }
    if (knownLinkIds.has(link.id)) {
      linksBroken.push({ link, missingEndpoints: [], reason: "link-id-exists" });
      continue;
    }
    const key = pairKey(link.from, link.to);
    if (knownPairs.has(key)) {
      linksBroken.push({ link, missingEndpoints: [], reason: "pair-exists" });
      continue;
    }
    knownPairs.add(key);
    knownLinkIds.add(link.id);
    linksRestored.push(link);
  }

  return { notes, linksRestored, linksBroken, renamed, idConflicts };
}

export function trashEntrySummary(entry: Pick<TrashEntry, "notes" | "zones">): string {
  const names = [
    ...entry.notes.map((note) => note.name),
    ...entry.zones.map((zone) => zone.name),
  ];
  if (names.length === 1) return names[0];
  if (names.length === 0) return "Empty entry";
  const firstNames = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${firstNames} + ${names.length - 2} more` : firstNames;
}

export function copyTrashEntry(entry: TrashEntry): TrashEntry {
  return {
    id: entry.id,
    deletedAt: entry.deletedAt,
    notes: entry.notes.map(copyTrashNote),
    zones: entry.zones.map(copyTrashZone),
    links: entry.links.map(copyTrashLink),
    ...(entry.calculators ? { calculators: Object.fromEntries(
      Object.entries(entry.calculators).map(([key, value]) => [key, copyTrashCalculatorData(value)]),
    ) } : {}),
  };
}

export function copyTrashNote(note: Note): Note {
  return {
    ...note,
    ...(note.task ? { task: { ...note.task } } : {}),
    ...(note.taskMemory ? { taskMemory: { ...note.taskMemory } } : {}),
    ...(note.message ? { message: { ...note.message } } : {}),
    ...(note.time ? { time: copyTimeNodeData(note.time) } : {}),
    ...(note.purposes ? { purposes: [...note.purposes] } : {}),
    ...(note.moods ? { moods: [...note.moods] } : {}),
    ...(note.smoothLineAnchors ? { smoothLineAnchors: copySmoothLineAnchorSnapshot(note.smoothLineAnchors) } : {}),
    ...(note.scope ? { scope: { ...note.scope } } : {}),
    ...(note.tiers ? {
      tiers: note.tiers.map((row) => ({ ...row, cards: row.cards.map((card) => ({ ...card })) })),
    } : {}),
  };
}

function copySmoothLineAnchorSnapshot(snapshot: NonNullable<Note["smoothLineAnchors"]>): NonNullable<Note["smoothLineAnchors"]> {
  return Object.fromEntries(Object.entries(snapshot).map(([linkId, anchor]) => [linkId, anchor ? { ...anchor } : null]));
}

export function copyTrashZone(zone: Zone): Zone {
  return {
    ...zone,
    parts: zone.parts.map((part) => part.map((point) => ({ ...point }))),
    holes: zone.holes.map((hole) => hole.map((point) => ({ ...point }))),
  };
}

export function copyTrashLink(link: Link): Link {
  return {
    ...link,
    ...(link.fromAnchor ? { fromAnchor: { ...link.fromAnchor } } : {}),
    ...(link.toAnchor ? { toAnchor: { ...link.toAnchor } } : {}),
  };
}

export function copyTrashCalculatorData(data: CalculatorData): CalculatorData {
  return {
    entries: data.entries.map((entry) => ({ ...entry })),
    bank: data.bank ? { ...data.bank } : null,
    rows: data.rows.map((row) => ({ ...row })),
  };
}
