import type { Point } from "../board/cameraMath";
import { newId } from "../model/note";
import { addZone, removeZone, updateZone, zones } from "../model/zones.svelte";
import { rectContour, type Zone } from "../model/zone";
import { execute, type HistoryCommand } from "../history/history.svelte";
import { uniqueName } from "../notes/naming";
import { shapeContainsPoint, type ZoneShape } from "./shape";
import {
  brushSegmentShape,
  brushSquare,
  eraseStroke,
  paintStroke,
  unionShapes,
  BRUSH_GRID,
  ZONE_MIN_THICKNESS,
} from "./brush";
import { ZONE_COLORS } from "./commands";

export type BrushMode = "paint" | "erase";

export interface BrushGesture {
  pointerId: number;
  mode: BrushMode;
  rectangle: boolean;
  start: Point;
  current: Point;
  lastPoint: Point;
  targetZoneId: string | null;
  shape: ZoneShape;
}

export interface CompletedBrushGesture {
  mode: BrushMode;
  rectangle: boolean;
  targetZoneId: string | null;
  shape: ZoneShape;
}

export const brushStrokeState = $state({
  cursor: null as Point | null,
  gesture: null as BrushGesture | null,
});

/** Resolve boundary hits to the topmost zone, matching the visible paint order. */
export function resolvePaintTarget(point: Point, entries: readonly { id: string; shape: ZoneShape }[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (shapeContainsPoint(entries[index].shape, point)) return entries[index].id;
  }
  return null;
}

export function startBrushGesture(
  pointerId: number,
  mode: BrushMode,
  point: Point,
  rectangle: boolean,
  targetZoneId: string | null,
  size: number,
): void {
  const start = { x: point.x, y: point.y };
  brushStrokeState.cursor = start;
  brushStrokeState.gesture = {
    pointerId,
    mode,
    rectangle,
    start,
    current: start,
    lastPoint: start,
    targetZoneId,
    shape: rectangle ? brushRectangleShape(start, start) : shapeFromBounds(brushSquare(start, size)),
  };
}

/** Add one sampled pointer position; callers batch samples at requestAnimationFrame cadence. */
export function appendBrushGesturePoint(point: Point, size: number): void {
  const gesture = brushStrokeState.gesture;
  if (!gesture) return;
  const nextPoint = { x: point.x, y: point.y };
  brushStrokeState.cursor = nextPoint;
  gesture.current = nextPoint;
  if (gesture.rectangle) {
    gesture.shape = brushRectangleShape(gesture.start, nextPoint);
  } else {
    const segment = brushSegmentShape(gesture.lastPoint, nextPoint, size);
    gesture.shape = unionShapes([gesture.shape, segment]) ?? gesture.shape;
    gesture.lastPoint = nextPoint;
  }
}

export function setBrushCursor(point: Point | null): void {
  brushStrokeState.cursor = point ? { x: point.x, y: point.y } : null;
}

export function finishBrushGesture(): CompletedBrushGesture | null {
  const gesture = brushStrokeState.gesture;
  brushStrokeState.gesture = null;
  return gesture
    ? {
        mode: gesture.mode,
        rectangle: gesture.rectangle,
        targetZoneId: gesture.targetZoneId,
        shape: cloneShape(gesture.shape),
      }
    : null;
}

export function cancelBrushGesture(): void {
  brushStrokeState.gesture = null;
}

/** Create one stable command for the whole completed brush stroke. */
export function createBrushHistoryCommand(gesture: CompletedBrushGesture): HistoryCommand | null {
  const entries = zones.order.flatMap((id) => {
    const zone = zones.byId[id];
    return zone ? [{ id, shape: { parts: zone.parts, holes: zone.holes } }] : [];
  });

  if (gesture.mode === "paint") return createPaintCommand(gesture, entries);
  return createEraseCommand(gesture, entries);
}

export function commitBrushGesture(gesture: CompletedBrushGesture): boolean {
  const command = createBrushHistoryCommand(gesture);
  if (!command) return false;
  execute(command);
  return true;
}

export function brushRectangleShape(from: Point, to: Point): ZoneShape {
  const startX = snapBrushCoordinate(from.x);
  const startY = snapBrushCoordinate(from.y);
  const endX = snapBrushCoordinate(to.x);
  const endY = snapBrushCoordinate(to.y);
  const width = Math.max(ZONE_MIN_THICKNESS, Math.abs(endX - startX));
  const height = Math.max(ZONE_MIN_THICKNESS, Math.abs(endY - startY));
  const x = endX < startX || (endX === startX && to.x < from.x) ? startX - width : startX;
  const y = endY < startY || (endY === startY && to.y < from.y) ? startY - height : startY;
  return { parts: [rectContour(x, y, width, height)], holes: [] };
}

function createPaintCommand(
  gesture: CompletedBrushGesture,
  entries: readonly { id: string; shape: ZoneShape }[],
): HistoryCommand | null {
  const result = paintStroke(gesture.shape, gesture.targetZoneId, entries);
  if (!result.shape || result.shape.parts.length === 0) return null;

  if (gesture.targetZoneId) {
    const zone = zones.byId[gesture.targetZoneId];
    if (!zone || result.zoneId !== gesture.targetZoneId || sameShape(zone, result.shape)) return null;
    const before = cloneShape({ parts: zone.parts, holes: zone.holes });
    const after = cloneShape(result.shape);
    return {
      label: "Paint zone",
      target: zone.name,
      do: () => updateZone(zone.id, { parts: cloneRings(after.parts), holes: cloneRings(after.holes) }),
      undo: () => updateZone(zone.id, { parts: cloneRings(before.parts), holes: cloneRings(before.holes) }),
    };
  }

  const occupiedNames = Object.values(zones.byId).map((zone) => zone.name);
  const zone: Zone = {
    id: newId(),
    name: uniqueName("Zone", occupiedNames),
    color: ZONE_COLORS[zones.order.length % ZONE_COLORS.length],
    parts: cloneRings(result.shape.parts),
    holes: cloneRings(result.shape.holes),
    createdAt: Date.now(),
  };
  return {
    label: "Paint zone",
    target: zone.name,
    do: () => addZone(zone),
    undo: () => { removeZone(zone.id); },
  };
}

function createEraseCommand(
  gesture: CompletedBrushGesture,
  entries: readonly { id: string; shape: ZoneShape }[],
): HistoryCommand | null {
  const result = eraseStroke(gesture.shape, entries);
  if (result.changed.length === 0 && result.removed.length === 0) return null;

  const removed = result.removed.flatMap((id) => {
    const zone = zones.byId[id];
    return zone ? [{ zone: cloneZone(zone), index: zones.order.indexOf(id) }] : [];
  });
  const beforeChanged = result.changed.flatMap(({ id }) => {
    const zone = zones.byId[id];
    return zone ? [{ id, name: zone.name, shape: cloneShape({ parts: zone.parts, holes: zone.holes }) }] : [];
  });
  const afterChanged = result.changed.map(({ id, shape }) => ({ id, shape: cloneShape(shape) }));
  if (removed.length === 0 && afterChanged.every(({ id, shape }) => {
    const original = beforeChanged.find((entry) => entry.id === id);
    return !original || sameShape(original.shape, shape);
  })) return null;

  return {
    label: "Erase zone",
    target: beforeChanged[0]?.name ?? removed[0]?.zone.name,
    do: () => {
      for (const { id, shape } of afterChanged) updateZone(id, { parts: cloneRings(shape.parts), holes: cloneRings(shape.holes) });
      for (const { zone } of removed) removeZone(zone.id);
    },
    undo: () => {
      for (const { id, shape } of beforeChanged) updateZone(id, { parts: cloneRings(shape.parts), holes: cloneRings(shape.holes) });
      for (const entry of [...removed].sort((first, second) => first.index - second.index)) addZone(cloneZone(entry.zone), entry.index);
    },
  };
}

function shapeFromBounds(bounds: { x: number; y: number; width: number; height: number }): ZoneShape {
  return { parts: [rectContour(bounds.x, bounds.y, bounds.width, bounds.height)], holes: [] };
}

function snapBrushCoordinate(value: number): number {
  return Math.round(value / BRUSH_GRID) * BRUSH_GRID;
}

function sameShape(first: ZoneShape, second: ZoneShape): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function cloneShape(shape: ZoneShape): ZoneShape {
  return { parts: cloneRings(shape.parts), holes: cloneRings(shape.holes) };
}

function cloneRings(rings: Point[][]): Point[][] {
  return rings.map((ring) => ring.map((point) => ({ x: point.x, y: point.y })));
}

function cloneZone(zone: Zone): Zone {
  return { ...zone, parts: cloneRings(zone.parts), holes: cloneRings(zone.holes) };
}
