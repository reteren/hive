import { PX_PER_UNIT, type Point } from "./cameraMath";
import type { Rect } from "./spatialIndex";
import type { Link } from "../model/link";
import type { Note } from "../model/note";
import type { Zone } from "../model/zone";

export interface FarNoteItem {
  id: string;
  kind: "rect" | "image" | "beacon";
  x: number;
  y: number;
  width: number;
  height: number;
  frame: string;
  body: string;
  headerHeight: number;
  opacity: number;
  paintOrder: number;
  bitmap?: CanvasImageSource;
}

export interface FarLinkItem {
  id: string;
  kind: Link["kind"];
  points: readonly Point[];
  opacity: number;
}

export interface FarZoneItem {
  id: string;
  color: string;
  parts: readonly (readonly Point[])[];
  holes: readonly (readonly Point[])[];
}

export interface FarDrawList {
  zones: FarZoneItem[];
  links: FarLinkItem[];
  notes: FarNoteItem[];
  beacons: FarNoteItem[];
  drawCalls: number;
}

export interface FarDrawListInput {
  /** Candidate ids returned by the note spatial index, route AABB index and zone-bounds index. */
  noteIds: readonly string[];
  notes: Readonly<Record<string, Note | undefined>>;
  noteBounds: (note: Note) => Rect;
  noteOrder: ReadonlyMap<string, number>;
  selectedNoteIds?: ReadonlySet<string>;
  focusedObjectIds?: ReadonlySet<string> | null;
  selectedZoneIds?: ReadonlySet<string>;
  selectedLinkIds?: ReadonlySet<string>;
  excludedLinkIds?: ReadonlySet<string>;
  imageBitmaps?: ReadonlyMap<string, CanvasImageSource>;
  zoneIds: readonly string[];
  zones: Readonly<Record<string, Zone | undefined>>;
  linkIds: readonly string[];
  links: Readonly<Record<string, Link | undefined>>;
  routePoints: (id: string) => readonly Point[] | undefined;
}

const DEFAULT_FRAME = "#353535";
const DEFAULT_BODY = "#282828";
const IMAGE_PLACEHOLDER = "#777777";
const BEACON_DEFAULT = "#e8b030";
const PRO_FRAME = "#293d2e";
const PRO_BODY = "#202d23";
const CON_FRAME = "#422d2c";
const CON_BODY = "#302222";
const GOAL_FRAME = "#3b3422";
const GOAL_BODY = "#27241d";
const MODULE_KINDS = new Set(["importance", "purpose", "mood"]);

/** Build world-space draw items from spatial-query results; camera changes do not call this again. */
export function buildFarDrawList(input: FarDrawListInput): FarDrawList {
  const selected = input.selectedNoteIds ?? EMPTY_IDS;
  const zoneItems: FarZoneItem[] = [];
  const linkItems: FarLinkItem[] = [];
  const noteItems: FarNoteItem[] = [];
  const beaconItems: FarNoteItem[] = [];

  for (const id of input.zoneIds) {
    if (input.selectedZoneIds?.has(id)) continue;
    const zone = input.zones[id];
    if (!zone) continue;
    zoneItems.push({ id, color: zone.color, parts: zone.parts, holes: zone.holes });
  }

  for (const id of input.linkIds) {
    if (input.selectedLinkIds?.has(id) || input.excludedLinkIds?.has(id)) continue;
    const link = input.links[id];
    const points = input.routePoints(id);
    if (!link || !points || points.length < 2) continue;
    const dimmed = input.focusedObjectIds &&
      (!input.focusedObjectIds.has(link.from) || !input.focusedObjectIds.has(link.to));
    linkItems.push({ id, kind: link.kind, points, opacity: dimmed ? 0.3 : 1 });
  }

  for (const id of input.noteIds) {
    if (selected.has(id)) continue;
    const note = input.notes[id];
    if (!note) continue;
    const bounds = input.noteBounds(note);
    const kind = note.type === "beacon" ? "beacon" : note.type === "image" ? "image" : "rect";
    const item: FarNoteItem = {
      id,
      kind,
      x: note.x,
      y: note.y,
      width: bounds.width,
      height: bounds.height,
      frame: note.type === "beacon" ? note.color ?? BEACON_DEFAULT : frameColor(note),
      body: note.type === "beacon" ? note.color ?? BEACON_DEFAULT : bodyColor(note),
      headerHeight: headerHeight(note.type, note.headerHidden),
      paintOrder: input.noteOrder.get(id) ?? Number.MAX_SAFE_INTEGER,
      opacity: (note.task?.done ? 0.6 : 1) *
        (input.focusedObjectIds && !input.focusedObjectIds.has(id) ? 0.3 : 1) *
        (kind === "image" ? note.opacity ?? 1 : 1),
      ...(kind === "image" && input.imageBitmaps?.has(id) ? { bitmap: input.imageBitmaps.get(id) } : {}),
    };
    if (kind === "beacon") beaconItems.push(item);
    else noteItems.push(item);
  }
  const byPaintOrder = (first: FarNoteItem, second: FarNoteItem): number => first.paintOrder - second.paintOrder;
  noteItems.sort((first, second) => Number(first.kind !== "image") - Number(second.kind !== "image") || byPaintOrder(first, second));
  beaconItems.sort(byPaintOrder);

  return {
    zones: zoneItems,
    links: linkItems,
    notes: noteItems,
    beacons: beaconItems,
    drawCalls: zoneItems.length * 2 + linkPaintGroupCount(linkItems) + noteItems.reduce((count, note) =>
      count + (note.kind === "image" && note.bitmap ? 1 : note.headerHeight > 0 ? 2 : 1), 0) + beaconItems.length,
  };
}

/** Draw one frame and return the number of canvas paint operations issued. */
export function paintFarDrawList(
  context: CanvasRenderingContext2D,
  drawList: FarDrawList,
  camera: { x: number; y: number; zoom: number },
  viewport: { width: number; height: number },
  pixelRatio = 1,
  imageBitmaps: ReadonlyMap<string, CanvasImageSource> = EMPTY_BITMAPS,
): number {
  const scale = Math.max(0.0001, camera.zoom * PX_PER_UNIT);
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, viewport.width, viewport.height);
  context.setTransform(
    ratio * scale,
    0,
    0,
    ratio * scale,
    ratio * (viewport.width / 2 - camera.x * scale),
    ratio * (viewport.height / 2 - camera.y * scale),
  );

  return paintFarDrawListWorld(context, drawList, imageBitmaps, scale);
}

/** Paint world-space objects using the caller's existing world-to-canvas transform. */
export function paintFarDrawListWorld(
  context: CanvasRenderingContext2D,
  drawList: FarDrawList,
  imageBitmaps: ReadonlyMap<string, CanvasImageSource> = EMPTY_BITMAPS,
  worldScale = 1,
): number {
  let calls = 0;
  for (const zone of drawList.zones) {
    context.beginPath();
    appendPolygons(context, zone.parts);
    appendPolygons(context, zone.holes);
    context.fillStyle = zone.color;
    context.globalAlpha = 0.12;
    context.fill("evenodd");
    context.globalAlpha = 1;
    context.strokeStyle = zone.color;
    context.lineWidth = 1.5 / Math.max(0.0001, worldScale);
    context.stroke();
    calls += 2;
  }

  calls += paintFarLinks(context, drawList.links, worldScale);
  context.globalAlpha = 1;
  context.setLineDash([]);

  for (const beacon of drawList.beacons) {
    context.globalAlpha = beacon.opacity;
    context.beginPath();
    context.arc(beacon.x + beacon.width / 2, beacon.y + beacon.height / 2, beacon.width / 2, 0, Math.PI * 2);
    context.fillStyle = beacon.frame;
    context.fill();
    calls += 1;
  }
  context.globalAlpha = 1;

  for (const note of drawList.notes) {
    context.globalAlpha = note.opacity;
    if (note.kind === "image") {
      const bitmap = imageBitmaps.get(note.id) ?? note.bitmap;
      if (bitmap) context.drawImage(bitmap, note.x, note.y, note.width, note.height);
      else {
        context.fillStyle = IMAGE_PLACEHOLDER;
        context.fillRect(note.x, note.y, note.width, note.height);
      }
      calls += 1;
      continue;
    }
    const header = Math.min(note.height, note.headerHeight);
    if (header > 0) {
      context.fillStyle = note.frame;
      context.fillRect(note.x, note.y, note.width, header);
      calls += 1;
    }
    if (note.height > header) {
      context.fillStyle = note.body;
      context.fillRect(note.x, note.y + header, note.width, note.height - header);
      calls += 1;
    }
  }
  context.globalAlpha = 1;

  return calls;
}

/** Draw links as a handful of grouped paths instead of one stroke per route. */
export function paintFarLinks(
  context: CanvasRenderingContext2D,
  links: readonly FarLinkItem[],
  worldScale: number,
): number {
  if (links.length === 0) return 0;
  const scale = Math.max(0.0001, worldScale);
  const groups = new Map<string, { kind: Link["kind"]; opacity: number; links: FarLinkItem[] }>();
  for (const link of links) {
    const key = `${link.kind}:${link.opacity}`;
    const group = groups.get(key) ?? { kind: link.kind, opacity: link.opacity, links: [] };
    group.links.push(link);
    groups.set(key, group);
  }

  context.strokeStyle = "#a9a294";
  context.lineWidth = 1 / scale;
  for (const group of groups.values()) {
    context.globalAlpha = group.opacity;
    context.setLineDash(group.kind === "weak" ? [4 / scale, 4 / scale] : []);
    context.beginPath();
    for (const link of group.links) appendPolyline(context, link.points);
    context.stroke();
  }
  context.globalAlpha = 1;
  context.setLineDash([]);
  return groups.size;
}

function linkPaintGroupCount(links: readonly FarLinkItem[]): number {
  return new Set(links.map((link) => `${link.kind}:${link.opacity}`)).size;
}

function frameColor(note: Note): string {
  if (note.color) return note.color;
  if (note.type === "pro") return PRO_FRAME;
  if (note.type === "con") return CON_FRAME;
  if (note.type === "goal") return GOAL_FRAME;
  return DEFAULT_FRAME;
}

function bodyColor(note: Note): string {
  if (note.accentColor) return note.accentColor;
  if (note.type === "pro") return PRO_BODY;
  if (note.type === "con") return CON_BODY;
  if (note.type === "goal") return GOAL_BODY;
  return DEFAULT_BODY;
}

function headerHeight(type: Note["type"], headerHidden: boolean | undefined): number {
  if (headerHidden || type === "image" || MODULE_KINDS.has(type)) return 0;
  return type === "pro" || type === "con" ? 2.4 : 2.8;
}

function appendPolygons(context: CanvasRenderingContext2D, polygons: readonly (readonly Point[])[]): void {
  for (const points of polygons) appendPolyline(context, points, true);
}

function appendPolyline(context: CanvasRenderingContext2D, points: readonly Point[], close = false): void {
  const first = points[0];
  if (!first) return;
  context.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    context.lineTo(point.x, point.y);
  }
  if (close) context.closePath();
}

const EMPTY_IDS: ReadonlySet<string> = new Set();
const EMPTY_BITMAPS: ReadonlyMap<string, CanvasImageSource> = new Map();
