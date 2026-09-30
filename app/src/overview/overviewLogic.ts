import type { NoteKind } from "../model/note";
import { PX_PER_UNIT } from "../board/cameraMath";

const KIND_LABELS: Record<NoteKind, string> = {
  note: "Text",
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
  markas: "Mark as",
  time: "Time",
  message: "Message",
  calendar: "Calendar",
};

export interface OverviewLabel {
  kind: string;
  title: string | null;
}

/** Turn default names into their kind and number, while preserving user titles. */
export function overviewLabelFor(kind: NoteKind, name: string): OverviewLabel {
  const label = KIND_LABELS[kind];
  const trimmed = name.trim();
  const defaultName = [label, ...(kind === "note" ? ["Note"] : [])]
    .map((base) => new RegExp(`^${escapeRegExp(base)}(?:\\s+(\\d+))?$`, "i").exec(trimmed))
    .find((match) => match !== null);
  return { kind: label, title: defaultName ? defaultName[1] ?? null : trimmed || null };
}

/** Text is shown only when both its screen-space bounds and line height can fit. */
export function overviewTextFits(
  widthPx: number,
  heightPx: number,
  zoom: number,
  scale = 1,
): boolean {
  return Number.isFinite(widthPx) && Number.isFinite(heightPx) && Number.isFinite(zoom) && Number.isFinite(scale) &&
    widthPx * zoom * scale >= 42 && heightPx * zoom * scale >= 24;
}

/** Font size in the node's untransformed local pixels; board zoom scales it with the node. */
export function overviewFontSize(kind: string, title: string | null, widthPx: number, heightPx: number): number {
  const longestLine = Math.max(kind.length, title?.length ?? 0, 1);
  const lines = title ? 2 : 1;
  return Math.max(0, Math.min(14, widthPx / (longestLine * 0.62), heightPx / (lines * 1.35)));
}

/** "Zone · 3" for a default name ("Zone 3"), "Zone" for a bare default, "Zone · Kitchen" otherwise. */
export function overviewZoneLabel(name: string): string {
  const trimmed = name.trim();
  const numbered = /^zone(?:\s+(\d+))?$/i.exec(trimmed);
  if (numbered) return numbered[1] ? `Zone · ${numbered[1]}` : "Zone";
  return trimmed ? `Zone · ${trimmed}` : "Zone";
}

/** World-unit font size for the large center label drawn inside a zone. */
export function overviewZoneFontSize(name: string, width: number, height: number, zoom: number): number | null {
  if (![width, height, zoom].every(Number.isFinite) || width <= 0 || height <= 0 || zoom <= 0) return null;
  const text = overviewZoneLabel(name);
  const size = Math.min(5, width / (Math.max(text.length, 1) * 0.58), height * 0.36);
  return size * PX_PER_UNIT * zoom >= 8 ? size : null;
}

export function isAltOnlyCandidate(event: Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "shiftKey" | "metaKey" | "repeat">): boolean {
  return (event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight") &&
    event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey && !event.repeat;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
