import type { Note } from "../model/note";
import { noteBounds, type Bounds } from "../notes/layout.svelte";
import type { Point } from "../board/cameraMath";
import { zoneBounds, type Zone } from "../model/zone";
import { zoneAreaInRect, zoneTouchesRect } from "../zones/geometry";
import { shapeArea } from "../zones/shape";

const NOTE_CORNER_RADIUS_PX = 5;
const SELECTION_OUTLINE_OFFSET_PX = 1;

/** Match a note's rounded corners after the note layer's zoom transform and outline offset. */
export function noteSelectionCornerRadius(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) ? Math.max(0, zoom) : 1;
  return NOTE_CORNER_RADIUS_PX * safeZoom + SELECTION_OUTLINE_OFFSET_PX;
}

/** A rectangle with board-space coordinates and non-negative dimensions. */
export function rectFromPoints(first: Point, second: Point): Bounds {
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  };
}

/** Edges count as touching, matching the board's marquee-selection rule. */
export function boundsTouch(first: Bounds, second: Bounds): boolean {
  return (
    first.x <= second.x + second.width &&
    first.x + first.width >= second.x &&
    first.y <= second.y + second.height &&
    first.y + first.height >= second.y
  );
}

export function pointInBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

/** Notes under a point in top-to-bottom paint order. */
export function hitTestNotes(
  point: Point,
  notes: Readonly<Record<string, Note>>,
  paintOrder: readonly string[],
  getBounds: (note: Note) => Bounds = noteBounds,
  include: (id: string) => boolean = () => true,
): string[] {
  const hits: string[] = [];
  for (let index = paintOrder.length - 1; index >= 0; index -= 1) {
    const id = paintOrder[index];
    const note = notes[id];
    if (note && include(id) && pointInBounds(point, getBounds(note))) hits.push(id);
  }
  return hits;
}

/** Notes that touch or intersect a marquee, returned in paint order. */
export function notesTouchingMarquee(
  marquee: Bounds,
  notes: Readonly<Record<string, Note>>,
  paintOrder: readonly string[],
  getBounds: (note: Note) => Bounds = noteBounds,
  include: (id: string) => boolean = () => true,
): string[] {
  return paintOrder.filter((id) => {
    const note = notes[id];
    return note !== undefined && include(id) && boundsTouch(marquee, getBounds(note));
  });
}

/** Zones use the same touch rule as notes, respecting contours and holes. */
export function zonesTouchingMarquee(
  marquee: Bounds,
  zones: Readonly<Record<string, Zone>>,
  paintOrder: readonly string[],
): string[] {
  return paintOrder.filter((id) => {
    const zone = zones[id];
    return zone !== undefined && boundsTouch(marquee, zoneBounds(zone)) && zoneTouchesRect(zone, marquee);
  });
}

/** Share of a zone's area the marquee must cover before the zone joins a marquee selection. */
export const MARQUEE_ZONE_COVERAGE = 0.6;

/**
 * Zones picked up by a marquee (user rule, 1.8.0): a zone is selected only when the marquee
 * selected every object inside it AND covers at least 60 % of the zone's area; otherwise the
 * marquee selects just the objects. The permanent ME beacon is not a marquee target, so it does
 * not count as a member that must be selected.
 */
export function zonesSelectedByMarquee(
  marquee: Bounds,
  zones: Readonly<Record<string, Zone>>,
  paintOrder: readonly string[],
  membersOf: (zoneId: string) => readonly string[],
  selectedIds: readonly string[],
  isMarqueeTarget: (id: string) => boolean = () => true,
): string[] {
  const selected = new Set(selectedIds);
  return paintOrder.filter((id) => {
    const zone = zones[id];
    if (!zone || !boundsTouch(marquee, zoneBounds(zone))) return false;
    const area = shapeArea(zone);
    if (!(area > 0) || zoneAreaInRect(zone, marquee) / area < MARQUEE_ZONE_COVERAGE) return false;
    return membersOf(id).every((member) => !isMarqueeTarget(member) || selected.has(member));
  });
}

/** Topmost zone at a world point, used when the zone surface has no DOM hit target. */
export function hitTestZones(
  point: Point,
  zones: Readonly<Record<string, Zone>>,
  paintOrder: readonly string[],
): string | null {
  for (let index = paintOrder.length - 1; index >= 0; index -= 1) {
    const id = paintOrder[index];
    const zone = zones[id];
    if (zone && pointInBounds(point, zoneBounds(zone)) &&
      zoneTouchesRect(zone, { x: point.x, y: point.y, width: 0, height: 0 })) return id;
  }
  return null;
}
