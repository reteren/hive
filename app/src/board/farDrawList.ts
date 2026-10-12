import type { Point } from "./cameraMath";
import type { Rect } from "./spatialIndex";
import type { Link } from "../model/link";
import type { Note } from "../model/note";
import { BEACON_SIZE } from "../model/note";
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
  bitmap?: CanvasImageSource;
}

export interface FarLinkItem {
  id: string;
  kind: Link["kind"];
  points: readonly Point[];
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
  rect: Rect;
  noteIds: readonly string[];
  notes: Readonly<Record<string, Note | undefined>>;
  noteOrder: ReadonlyMap<string, number>;
  selectedNoteIds?: ReadonlySet<string>;
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
const BEACON_DEFAULT = "#d0a840";
const PRO_FRAME = "#293d2e";
const PRO_BODY = "#202d23";
const CON_FRAME = "#422d2c";
const CON_BODY = "#302222";
const MODULE_KINDS = new Set(["importance", "purpose", "mood"]);

/** Build world-space draw items from spatial-query results; camera changes do not call this again. */
export function buildFarDrawList(input: FarDrawListInput): FarDrawList {
  const selected = input.selectedNoteIds ?? EMPTY_IDS;
  const zoneItems: FarZoneItem[] = [];
  const linkItems: FarLinkItem[] = [];
  const noteItems: FarNoteItem[] = [];
  const beaconItems: FarNoteItem[] = [];

  for (const id of input.zoneIds) {
    const zone = input.zones[id];
    if (!zone || !boundsIntersect(zoneBoundsFast(zone.parts, zone.holes), input.rect)) continue;
    zoneItems.push({ id, color: zone.color, parts: zone.parts, holes: zone.holes });
  }

  for (const id of input.linkIds) {
    const link = input.links[id];
    const points = input.routePoints(id);
    if (!link || !points || points.length < 2 || !boundsIntersect(pointsBounds(points), input.rect)) continue;
    linkItems.push({ id, kind: link.kind, points });
  }

  const visibleNotes = input.noteIds
    .filter((id) => !selected.has(id) && input.notes[id])
    .sort((first, second) => {
      const a = input.notes[first]!;
      const b = input.notes[second]!;
      const imageOrder = Number(a.type !== "image") - Number(b.type !== "image");
      return imageOrder || (input.noteOrder.get(first) ?? Number.MAX_SAFE_INTEGER) -
        (input.noteOrder.get(second) ?? Number.MAX_SAFE_INTEGER);
    });

  for (const id of visibleNotes) {
    const note = input.notes[id]!;
    const width = Math.max(0, note.width * noteScale(note));
    const height = Math.max(0, note.height ?? 6) * noteScale(note);
    const kind = note.type === "beacon" ? "beacon" : note.type === "image" ? "image" : "rect";
    const item: FarNoteItem = {
      id,
      kind,
      x: note.x,
      y: note.y,
      width: kind === "beacon" ? BEACON_SIZE : width,
      height: kind === "beacon" ? BEACON_SIZE : height,
      frame: note.type === "beacon" ? note.color ?? BEACON_DEFAULT : frameColor(note),
      body: note.type === "beacon" ? note.color ?? BEACON_DEFAULT : bodyColor(note),
      headerHeight: headerHeight(note.type, note.headerHidden),
      opacity: (note.task?.done ? 0.6 : 1) * (kind === "image" ? note.opacity ?? 1 : 1),
      ...(kind === "image" && input.imageBitmaps?.has(id) ? { bitmap: input.imageBitmaps.get(id) } : {}),
    };
    if (!boundsIntersect(item, input.rect)) continue;
    if (kind === "beacon") beaconItems.push(item);
    else noteItems.push(item);
  }

  return {
    zones: zoneItems,
    links: linkItems,
    notes: noteItems,
    beacons: beaconItems,
    drawCalls: zoneItems.length * 2 + linkItems.length + noteItems.reduce((count, note) =>
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
): number {
  const scale = Math.max(0.0001, camera.zoom * 10);
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
    context.lineWidth = 1.5 / scale;
    context.stroke();
    calls += 2;
  }

  context.strokeStyle = "#a9a294";
  context.lineWidth = 1 / scale;
  for (const link of drawList.links) {
    if (link.kind === "weak") context.setLineDash([4 / scale, 4 / scale]);
    else context.setLineDash([]);
    context.beginPath();
    appendPolyline(context, link.points);
    context.stroke();
    calls += 1;
  }
  context.setLineDash([]);

  for (const note of drawList.notes) {
    context.globalAlpha = note.opacity;
    if (note.kind === "image") {
      if (note.bitmap) context.drawImage(note.bitmap, note.x, note.y, note.width, note.height);
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

  for (const beacon of drawList.beacons) {
    context.beginPath();
    context.arc(beacon.x + beacon.width / 2, beacon.y + beacon.height / 2, beacon.width / 2, 0, Math.PI * 2);
    context.fillStyle = beacon.frame;
    context.fill();
    calls += 1;
  }
  return calls;
}

function frameColor(note: Note): string {
  if (note.color) return note.color;
  if (note.type === "pro") return PRO_FRAME;
  if (note.type === "con") return CON_FRAME;
  return DEFAULT_FRAME;
}

function bodyColor(note: Note): string {
  if (note.accentColor) return note.accentColor;
  if (note.type === "pro") return PRO_BODY;
  if (note.type === "con") return CON_BODY;
  return DEFAULT_BODY;
}

function headerHeight(type: Note["type"], headerHidden: boolean | undefined): number {
  if (headerHidden || MODULE_KINDS.has(type)) return 0;
  return type === "pro" || type === "con" ? 2.4 : 2.8;
}

function noteScale(note: Note): number {
  return Number.isFinite(note.scale) && (note.scale ?? 1) > 0 ? note.scale ?? 1 : 1;
}

function zoneBoundsFast(parts: readonly (readonly Point[])[], holes: readonly (readonly Point[])[]): Rect {
  return pointsBounds([...parts, ...holes].flat());
}

function pointsBounds(points: readonly Point[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let left = points[0]!.x;
  let right = left;
  let top = points[0]!.y;
  let bottom = top;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function boundsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width &&
    a.y <= b.y + b.height && b.y <= a.y + a.height;
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
