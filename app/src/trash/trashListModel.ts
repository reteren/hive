import type { NoteKind } from "../model/note";
import type { TrashListItem } from "./trashActions.svelte";

export type TrashSummaryKind = NoteKind | "zone" | "objects";

export interface TrashEntrySummary {
  kind: TrashSummaryKind;
  label: string;
  objectCount: number;
}

const noteKindLabels: Record<NoteKind, string> = {
  note: "Note",
  pro: "Plus",
  con: "Minus",
  importance: "Importance",
  purpose: "Purpose",
  mood: "Mood",
  beacon: "Beacon",
  goal: "Goal",
  progress: "Progress",
  calculator: "Calculator",
  tierlist: "Tierlist",
  stats: "Statistics",
  archive: "Archive",
  trash: "Trash",
  inbox: "Inbox",
  list: "List",
  source: "Source",
  glossary: "Dictionary",
  map: "Map",
  random: "Random Choice",
};

/** Format one grouped delete entry for the list without counting its attached links as objects. */
export function summarizeTrashEntry(entry: Pick<TrashListItem, "notes" | "zones">): TrashEntrySummary {
  const objectCount = entry.notes.length + entry.zones.length;
  if (objectCount === 1) {
    const note = entry.notes[0];
    if (note) return { kind: note.type, label: `${noteKindLabels[note.type]} ${note.name}`, objectCount };

    const zone = entry.zones[0];
    if (zone) return { kind: "zone", label: `Zone ${zone.name}`, objectCount };
  }

  return {
    kind: "objects",
    label: objectCount === 0 ? "Empty entry" : `${objectCount} objects`,
    objectCount,
  };
}
