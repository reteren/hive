import type { NoteKind } from "../model/note";
import type { TrashListItem } from "./trashActions.svelte";
import { t, tp } from "../i18n/i18n.svelte";

export type TrashSummaryKind = NoteKind | "zone" | "objects";

export interface TrashEntrySummary {
  kind: TrashSummaryKind;
  label: string;
  objectCount: number;
}

const noteKindLabels: Record<NoteKind, string> = {
  get note() { return t("Note"); },
  get pro() { return t("Plus"); },
  get con() { return t("Minus"); },
  get importance() { return t("Importance"); },
  get purpose() { return t("Purpose"); },
  get mood() { return t("Mood"); },
  get beacon() { return t("Beacon"); },
  get goal() { return t("Goal"); },
  get progress() { return t("Progress"); },
  get calculator() { return t("Calculator"); },
  get tierlist() { return t("Tierlist"); },
  get graph() { return t("Graph"); },
  get stats() { return t("Statistics"); },
  get archive() { return t("Archive"); },
  get trash() { return t("Trash"); },
  get inbox() { return t("Inbox"); },
  get list() { return t("List"); },
  get source() { return t("Source"); },
  get glossary() { return t("Dictionary"); },
  get map() { return t("Map"); },
  get random() { return t("Random Choice"); },
  get markas() { return t("Mark as"); },
  get time() { return t("Time"); },
  get message() { return t("Message"); },
  get calendar() { return t("Calendar"); },
  get image() { return t("Image"); },
  get pdf() { return t("PDF"); },
  get format() { return t("Format"); },
  get audio() { return t("Audio"); },
  get video() { return t("Video"); },
  get youtube() { return t("YouTube"); },
};

/** Format one grouped delete entry for the list without counting its attached links as objects. */
export function summarizeTrashEntry(entry: Pick<TrashListItem, "notes" | "zones" | "meBeacon">): TrashEntrySummary {
  if (entry.meBeacon) return { kind: "beacon", label: t("Beacon ME"), objectCount: 1 };
  const objectCount = entry.notes.length + entry.zones.length;
  if (objectCount === 1) {
    const note = entry.notes[0];
    if (note) return { kind: note.type, label: `${noteKindLabels[note.type]} ${note.name}`, objectCount };

    const zone = entry.zones[0];
    if (zone) return { kind: "zone", label: t("Zone {name}", { name: zone.name }), objectCount };
  }

  return {
    kind: "objects",
    label: objectCount === 0 ? t("Empty entry") : tp(objectCount, "{count} object", "{count} objects"),
    objectCount,
  };
}
