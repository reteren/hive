import type { Point } from "../board/cameraMath";
import { history, execute } from "../history/history.svelte";
import { clearZoneSelection, selectZonesOnly, selection } from "../selection/selection.svelte";
import { addZone, removeZone, updateZone, zones } from "../model/zones.svelte";
import type { Zone, ZoneBounds } from "../model/zone";
import {
  contourToShape,
  shapeToContour,
  type EditContour,
} from "./contourEdit";
import { MIN_ZONE_PART, subtractRect, type ZoneShape } from "./shape";

/** Temporary interaction state for editing one zone's contour. */
export const shapeEdit = $state({
  zoneId: null as string | null,
  contour: null as EditContour | null,
  marquee: null as ZoneBounds | null,
  /** History position at entry; Undo past the edit session exits before undoing earlier work. */
  entryCursor: 0,
});

export function enterShapeEdit(zoneId: string): boolean {
  const zone = zones.byId[zoneId];
  if (!zone || shapeEdit.zoneId) return false;

  selectZonesOnly([zoneId]);
  shapeEdit.zoneId = zoneId;
  shapeEdit.contour = shapeToContour(toShape(zone), true);
  shapeEdit.marquee = null;
  shapeEdit.entryCursor = history.cursor;
  return true;
}

/** Leaving keeps every completed contour edit in the zone store. */
export function leaveShapeEdit(): void {
  const editedId = shapeEdit.zoneId;
  shapeEdit.zoneId = null;
  shapeEdit.contour = null;
  shapeEdit.marquee = null;
  shapeEdit.entryCursor = history.cursor;
  if (editedId && !zones.byId[editedId] && selection.zoneIds.includes(editedId)) clearZoneSelection();
}

export function clearShapeEditMarquee(): boolean {
  if (!shapeEdit.marquee) return false;
  shapeEdit.marquee = null;
  return true;
}

/** Commit a cut or a completed drag as one history command. */
export function commitContourEdit(
  before: EditContour,
  after: EditContour,
  label: "Cut zone edge" | "Edit zone shape",
): boolean {
  const id = shapeEdit.zoneId;
  const zone = id ? zones.byId[id] : undefined;
  if (!id || !zone) return false;

  const beforeShape = toShape(zone);
  const afterShape = cloneShape(contourToShape(after));
  if (sameContour(before, after)) {
    shapeEdit.contour = cloneContour(after);
    return false;
  }

  const beforeContour = cloneContour(before);
  const afterContour = cloneContour(after);
  const target = zone.name;
  execute({
    label,
    target,
    do: () => applyShape(id, afterShape, afterContour),
    undo: () => applyShape(id, beforeShape, beforeContour),
  });
  return true;
}

/** Delete the selected area from the edited zone in one Undo step. */
export function cutOutShapeEditArea(): boolean {
  const id = shapeEdit.zoneId;
  const zone = id ? zones.byId[id] : undefined;
  const rect = shapeEdit.marquee;
  if (!zone || !id || !rect) return false;

  const beforeShape = toShape(zone);
  const afterShape = subtractRect(beforeShape, rect, MIN_ZONE_PART);
  const index = zones.order.indexOf(id);
  const beforeZone = cloneZone(zone);
  const beforeContour = shapeEdit.contour ? cloneContour(shapeEdit.contour) : shapeToContour(beforeShape, false);

  if (!afterShape) {
    execute({
      label: "Cut out zone area",
      target: zone.name,
      do: () => {
        removeZone(id);
        leaveShapeEdit();
      },
      undo: () => addZone(beforeZone, index),
    });
    return true;
  }

  const nextShape = cloneShape(afterShape);
  if (sameShape(beforeShape, nextShape)) {
    shapeEdit.marquee = null;
    return false;
  }
  const afterContour = shapeToContour(nextShape, false);
  execute({
    label: "Cut out zone area",
    target: zone.name,
    do: () => applyShape(id, nextShape, afterContour),
    undo: () => {
      updateZone(id, cloneShapePatch(beforeShape));
      if (shapeEdit.zoneId === id) {
        shapeEdit.contour = cloneContour(beforeContour);
        shapeEdit.marquee = null;
      }
    },
  });
  return true;
}

function applyShape(id: string, shape: ZoneShape, contour: EditContour): void {
  updateZone(id, cloneShapePatch(shape));
  if (shapeEdit.zoneId === id) {
    shapeEdit.contour = cloneContour(contour);
    shapeEdit.marquee = null;
  }
}

function toShape(zone: Pick<Zone, "parts" | "holes">): ZoneShape {
  return { parts: zone.parts.map(cloneRing), holes: zone.holes.map(cloneRing) };
}

function cloneZone(zone: Zone): Zone {
  return { ...zone, ...cloneShapePatch(zone) };
}

function cloneShapePatch(shape: ZoneShape): Pick<Zone, "parts" | "holes"> {
  return { parts: shape.parts.map(cloneRing), holes: shape.holes.map(cloneRing) };
}

function cloneShape(shape: ZoneShape): ZoneShape {
  return cloneShapePatch(shape);
}

function cloneContour(contour: EditContour): EditContour {
  return { rings: contour.rings.map((ring) => ({ kind: ring.kind, points: ring.points.map(clonePoint) })) };
}

function cloneRing(ring: readonly Point[]): Point[] {
  return ring.map(clonePoint);
}

function clonePoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

function sameShape(first: ZoneShape, second: ZoneShape): boolean {
  return sameRings(first.parts, second.parts) && sameRings(first.holes, second.holes);
}

function sameContour(first: EditContour, second: EditContour): boolean {
  return first.rings.length === second.rings.length && first.rings.every((ring, ringIndex) => {
    const other = second.rings[ringIndex];
    return ring.kind === other.kind && sameRings([ring.points], [other.points]);
  });
}

function sameRings(first: readonly (readonly Point[])[], second: readonly (readonly Point[])[]): boolean {
  return first.length === second.length && first.every((ring, ringIndex) => {
    const other = second[ringIndex];
    return ring.length === other.length && ring.every((point, pointIndex) => {
      const otherPoint = other[pointIndex];
      return point.x === otherPoint.x && point.y === otherPoint.y;
    });
  });
}
