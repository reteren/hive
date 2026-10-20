import type { Note, NoteKind } from "../model/note";
import { PX_PER_UNIT } from "../board/cameraMath";
import { t } from "../i18n/i18n.svelte";

export const KIND_LABELS: Record<NoteKind, string> = {
  get note() { return t("Text"); },
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

export interface OverviewLabel {
  kind: string;
  title: string | null;
}

/**
 * Debug 19: a YouTube node whose name is still its video id or pasted link shows the video title
 * (from oEmbed) in the overview; a name the user typed wins.
 */
export function overviewNameFor(note: Pick<Note, "type" | "name" | "youtube">): string {
  const youtube = note.type === "youtube" ? note.youtube : undefined;
  const title = youtube?.title?.trim();
  if (!youtube || !title) return note.name;
  const name = note.name.trim();
  const generated = name === youtube.videoId || name === youtube.url || /^https?:\/\//i.test(name) ||
    new RegExp(`^${escapeRegExp(youtube.videoId)}(?: \\d+)?$`).test(name);
  return generated ? title : note.name;
}

/** Turn default names into their kind and number, while preserving user titles. */
export function overviewLabelFor(kind: NoteKind, name: string, options: { gif?: boolean } = {}): OverviewLabel {
  // Debug 17: an animated image is labelled "GIF", not "Image".
  const label = kind === "image" && options.gif ? "GIF" : KIND_LABELS[kind];
  const trimmed = name.trim();
  const defaultName = [label, ...(kind === "note" ? ["Note"] : []), ...(kind === "image" ? ["Image"] : [])]
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

/** Font size in the node's untransformed local pixels, proportional to the node; board zoom scales it with the node. */
export function overviewFontSize(kind: string, title: string | null, widthPx: number, heightPx: number): number {
  const longestLine = Math.max(kind.length, title?.length ?? 0, 1);
  const lines = title ? 2 : 1;
  // No fixed cap (debug 16): the label grows with the object, filling most of its box, so a huge
  // Map shows a huge name in the overview.
  return Math.max(0, 0.85 * Math.min(widthPx / (longestLine * 0.62), heightPx / (lines * 1.35)));
}

/** "Zone · 3" for a default name ("Zone 3"), "Zone" for a bare default, "Zone · Kitchen" otherwise. */
export function overviewZoneLabel(name: string): string {
  const trimmed = name.trim();
  const numbered = /^zone(?:\s+(\d+))?$/i.exec(trimmed);
  if (numbered) return numbered[1] ? t("Zone · {value}", { value: numbered[1] }) : t("Zone");
  return trimmed ? t("Zone · {trimmed}", { trimmed: trimmed }) : t("Zone");
}

/** World-unit font size for the large center label drawn inside a zone. */
export function overviewZoneFontSize(name: string, width: number, height: number, zoom: number): number | null {
  if (![width, height, zoom].every(Number.isFinite) || width <= 0 || height <= 0 || zoom <= 0) return null;
  const text = overviewZoneLabel(name);
  // At most 5 units up close; zoomed out the cap grows to keep 14 px on screen, so the names stay
  // readable from afar as long as the zone itself is big enough to hold them.
  const cap = Math.max(5, 14 / (PX_PER_UNIT * zoom));
  const size = Math.min(cap, width / (Math.max(text.length, 1) * 0.58), height * 0.36);
  return size * PX_PER_UNIT * zoom >= 8 ? size : null;
}

export function isAltOnlyCandidate(event: Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "shiftKey" | "metaKey" | "repeat">): boolean {
  return (event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight") &&
    event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey && !event.repeat;
}

export interface AltOverviewGesture {
  held: boolean;
  wheelConsumed: boolean;
}

export function beginAltOverviewGesture(): AltOverviewGesture {
  return { held: true, wheelConsumed: false };
}

/** Alt + wheel belongs to the drawing brush while draw mode is active. */
export function consumeDrawAltWheel(
  gesture: AltOverviewGesture,
  drawMode: boolean,
  event: Pick<WheelEvent, "altKey" | "ctrlKey" | "shiftKey" | "metaKey">,
): AltOverviewGesture {
  if (!gesture.held || gesture.wheelConsumed || !drawMode || !event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) {
    return gesture;
  }
  return { ...gesture, wheelConsumed: true };
}

export function shouldShowAltOverview(gesture: AltOverviewGesture): boolean {
  return gesture.held && !gesture.wheelConsumed;
}

export function endAltOverviewGesture(): AltOverviewGesture {
  return { held: false, wheelConsumed: false };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
