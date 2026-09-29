import { PX_PER_UNIT, type Camera, type Point, type Size } from "../board/cameraMath";

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapNoteBounds extends WorldRect {
  id: string;
}

export interface MapZoneShape {
  id: string;
  parts: readonly (readonly Point[])[];
}

export interface MapTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface MapLinkInput {
  id: string;
  from: string;
  to: string;
  kind: "strong" | "weak";
}

export interface ProjectedMapLink {
  id: string;
  kind: "strong" | "weak";
  from: Point;
  to: Point;
}

export const MAX_PROJECTED_MAP_LINKS = 750;

function includePoint(bounds: { left: number; top: number; right: number; bottom: number }, point: Point): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  bounds.left = Math.min(bounds.left, point.x);
  bounds.top = Math.min(bounds.top, point.y);
  bounds.right = Math.max(bounds.right, point.x);
  bounds.bottom = Math.max(bounds.bottom, point.y);
}

/** Bounds of all notes and zone contours, always including ME at the origin. */
export function wholeBoardBounds(
  notes: readonly MapNoteBounds[],
  zones: readonly MapZoneShape[],
  me: Point = { x: 0, y: 0 },
): WorldRect {
  const bounds = { left: me.x, top: me.y, right: me.x, bottom: me.y };
  for (const note of notes) {
    if (![note.x, note.y, note.width, note.height].every(Number.isFinite)) continue;
    includePoint(bounds, { x: note.x, y: note.y });
    includePoint(bounds, { x: note.x + note.width, y: note.y + note.height });
  }
  for (const zone of zones) {
    for (const part of zone.parts) for (const point of part) includePoint(bounds, point);
  }
  return {
    x: bounds.left,
    y: bounds.top,
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
  };
}

/** Fit world bounds into a map box while keeping equal scale on both axes. */
export function fitMap(
  bounds: WorldRect,
  box: Size,
  padding = 16,
  minimumWorldSpan = 24,
): MapTransform {
  const width = Number.isFinite(box.width) && box.width > 0 ? box.width : 1;
  const height = Number.isFinite(box.height) && box.height > 0 ? box.height : 1;
  const safePadding = Math.max(0, Math.min(padding, Math.min(width, height) / 2 - 0.5));
  const worldWidth = Math.max(minimumWorldSpan, Math.abs(bounds.width));
  const worldHeight = Math.max(minimumWorldSpan, Math.abs(bounds.height));
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const scale = Math.max(Number.EPSILON, Math.min(
    (width - 2 * safePadding) / worldWidth,
    (height - 2 * safePadding) / worldHeight,
  ));
  return {
    scale,
    offsetX: width / 2 - centerX * scale,
    offsetY: height / 2 - centerY * scale,
  };
}

export function worldToMap(point: Point, transform: MapTransform): Point {
  return {
    x: point.x * transform.scale + transform.offsetX,
    y: point.y * transform.scale + transform.offsetY,
  };
}

export function mapToWorld(point: Point, transform: MapTransform): Point {
  return {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale,
  };
}

/** Zoom an already fitted map around the centre of its view box. */
export function zoomMapTransform(transform: MapTransform, box: Size, zoom: number): MapTransform {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const centerMap = { x: box.width / 2, y: box.height / 2 };
  const centerWorld = mapToWorld(centerMap, transform);
  const scale = transform.scale * safeZoom;
  return {
    scale,
    offsetX: centerMap.x - centerWorld.x * scale,
    offsetY: centerMap.y - centerWorld.y * scale,
  };
}

/** Build the single fitted transform shared by a rendered map frame and its pointer conversion. */
export function mapTransformForBounds(bounds: WorldRect, box: Size, padding: number, zoom: number): MapTransform {
  return zoomMapTransform(fitMap(bounds, box, padding), box, zoom);
}

/** Project node-centre links for the map; large link sets are skipped to keep drawing cheap. */
export function projectMapLinks(
  links: readonly MapLinkInput[],
  notes: readonly MapNoteBounds[],
  transform: MapTransform,
  meId = "me",
  me: Point = { x: 0, y: 0 },
  maximumLinks = MAX_PROJECTED_MAP_LINKS,
): ProjectedMapLink[] {
  if (links.length > maximumLinks) return [];
  const centers = new Map<string, Point>([[meId, me]]);
  for (const note of notes) {
    centers.set(note.id, { x: note.x + note.width / 2, y: note.y + note.height / 2 });
  }
  return links.flatMap((link) => {
    const from = centers.get(link.from);
    const to = centers.get(link.to);
    return from && to
      ? [{ id: link.id, kind: link.kind, from: worldToMap(from, transform), to: worldToMap(to, transform) }]
      : [];
  });
}

/** Current camera viewport projected into map coordinates. */
export function cameraViewportRect(camera: Camera, viewport: Size, transform: MapTransform): WorldRect {
  const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
  const worldWidth = Math.max(0, viewport.width) / (PX_PER_UNIT * zoom);
  const worldHeight = Math.max(0, viewport.height) / (PX_PER_UNIT * zoom);
  const topLeft = worldToMap({ x: camera.x - worldWidth / 2, y: camera.y - worldHeight / 2 }, transform);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: worldWidth * transform.scale,
    height: worldHeight * transform.scale,
  };
}
