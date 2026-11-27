import { ME_OBJECT_ID, type Link } from "../../model/link";
import type { Note } from "../../model/note";
import { board } from "../../model/board.svelte";
import { links } from "../../model/links.svelte";
import { zones } from "../../model/zones.svelte";
import { zoneBounds, type Zone, type ZoneBounds } from "../../model/zone";
import { zoneMembers, zoneOf } from "../../zones/membership.svelte";
import { noteBounds } from "../../notes/layout.svelte";
import { inlineImageTextForFit } from "../../editor/markdownSyntax";
import { hasMeBeacon } from "../../beacons/beaconState.svelte";

export interface LinkInfo {
  id: string;
  from: string;
  to: string;
  /** Left out when "strong" (the default). */
  kind?: Link["kind"];
  /** Left out when "base" (the default). */
  shape?: Link["shape"];
  fromName: string;
  toName: string;
}

export interface NodeSummary {
  id: string;
  type: Note["type"];
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  task?: { done: boolean };
  importance?: Note["importance"];
  purposes?: NonNullable<Note["purposes"]>;
  moods?: NonNullable<Note["moods"]>;
  zoneId?: string;
  textPreview?: string;
  linkCount?: number;
}

export interface ZoneSummary {
  id: string;
  name: string;
  color: string;
  rect: ZoneBounds;
  nodeCount: number;
  nodeIds?: string[];
  parts?: Zone["parts"];
  holes?: Zone["holes"];
}

/** A zone as agents see it: its bounding rectangle and member count; ids and polygon on request. */
export function zoneSummary(zone: Zone, options: { members?: boolean; geometry?: boolean } = {}): ZoneSummary {
  const members = zoneMembers(zone.id);
  return {
    id: zone.id,
    name: zone.name,
    color: zone.color,
    rect: zoneBounds(zone),
    nodeCount: members.length,
    ...(options.members ? { nodeIds: members } : {}),
    ...(options.geometry ? { parts: jsonClone(zone.parts), holes: jsonClone(zone.holes) } : {}),
  };
}

export function linkInfo(link: Link): LinkInfo {
  return {
    id: link.id,
    from: link.from,
    to: link.to,
    ...linkStyle(link),
    fromName: objectName(link.from),
    toName: objectName(link.to),
  };
}

/** A node in a list: position, size and marks; a plain-text preview and link count when non-empty. */
/** Kind and shape of a link, each only when it is not the default (strong, base). */
export function linkStyle(link: Pick<Link, "kind" | "shape">): Pick<LinkInfo, "kind" | "shape"> {
  return {
    ...(link.kind === "strong" ? {} : { kind: link.kind }),
    ...(link.shape === "base" ? {} : { shape: link.shape }),
  };
}

export function nodeSummary(note: Note, previewLength = 80): NodeSummary {
  const bounds = noteBounds(note);
  const zoneId = zoneOf(note.id);
  const textPreview = plainTextPreview(note.text, previewLength);
  const linkCount = Object.values(links.byId).filter((link) => link.from === note.id || link.to === note.id).length;
  return {
    id: note.id,
    type: note.type,
    name: note.name,
    x: note.x,
    y: note.y,
    width: bounds.width,
    height: bounds.height,
    ...(note.color === undefined ? {} : { color: note.color }),
    ...(note.task ? { task: { done: note.task.done } } : {}),
    ...(note.importance === undefined ? {} : { importance: note.importance }),
    ...(note.purposes?.length ? { purposes: [...note.purposes] } : {}),
    ...(note.moods?.length ? { moods: [...note.moods] } : {}),
    ...(zoneId ? { zoneId } : {}),
    ...(textPreview ? { textPreview } : {}),
    ...(linkCount > 0 ? { linkCount } : {}),
  };
}

export function fullNode(note: Note, file: string): Record<string, unknown> {
  const zoneId = zoneOf(note.id);
  const zone = zoneId ? zones.byId[zoneId] : undefined;
  const node = jsonClone(note) as unknown as Record<string, unknown>;
  return {
    ...node,
    file: displayPath(file),
    height: noteBounds(note).height,
    links: Object.values(links.byId)
      .filter((link) => link.from === note.id || link.to === note.id)
      .map(linkInfo),
    ...(zone ? { zone: { id: zone.id, name: zone.name } } : {}),
  };
}

export function displayPath(path: string): string {
  const extendedLengthPrefix = "\\\\?\\";
  return path.startsWith(extendedLengthPrefix) ? path.slice(extendedLengthPrefix.length) : path;
}

export function plainTextPreview(markdown: string, maxCharacters = 160): string {
  const plain = inlineImageTextForFit(markdown)
    .replace(/```[^\n]*\n?([\s\S]*?)```/gu, "$1")
    .replace(/~~~[^\n]*\n?([\s\S]*?)~~~/gu, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gmu, "")
    .replace(/^\s{0,3}>\s?/gmu, "")
    .replace(/^\s*(?:[-+*]|\d{1,9}[.)])\s+/gmu, "")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gmu, "")
    .replace(/(\*\*|__|~~|==)([\s\S]*?)\1/gu, "$2")
    .replace(/(?<!\w)[*_](\S(?:.*?\S)?)[*_](?!\w)/gu, "$1")
    .replace(/`{1,3}/gu, "")
    .replace(/\{\{#[\da-fA-F]{6}\}\}/gu, "")
    .replace(/<[^>]+>/gu, "")
    .replace(/[|]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(plain).slice(0, maxCharacters).join("");
}

export function objectName(id: string): string {
  if (id === ME_OBJECT_ID) return hasMeBeacon() ? "ME" : "Missing ME";
  return board.notes[id]?.name ?? id;
}

export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
