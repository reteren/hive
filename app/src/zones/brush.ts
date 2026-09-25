import type { Point } from "../board/cameraMath";
import type { ZoneBounds } from "../model/zone";
import type { ZoneShape } from "./shape";

/**
 * Zone brush contract (redesign 25.09, replaces the Edit shape editor). The zone tool paints zones
 * with a SQUARE brush (LMB) and erases with the same square (RMB); Ctrl+LMB / Ctrl+RMB drag a
 * rectangle to paint / erase. Brush squares snap to a 10 u grid. Implemented by the brush-engine
 * worker; the UI worker calls these pure functions.
 */

export const BRUSH_MIN = 20;
export const BRUSH_MAX = 300;
export const BRUSH_STEP = 20;
/** Brush squares are placed on this grid (user decision 25.09). */
export const BRUSH_GRID = 10;
/** No zone piece may be thinner than this after painting/erasing (replaces the 30 u edit limit). */
export const ZONE_MIN_THICKNESS = 20;

/** Clamp to [BRUSH_MIN, BRUSH_MAX] and round to the nearest multiple of BRUSH_STEP (0 is impossible). */
export declare function normalizeBrushSize(size: number): number;

/** The square the brush covers when centred on `point` (snapped to BRUSH_GRID). */
export declare function brushSquare(point: Point, size: number): ZoneBounds;

/**
 * The area covered by moving the brush from `from` to `to` (interpolated so fast mouse moves
 * leave no gaps). Returned as an orthogonal shape (union of snapped squares).
 */
export declare function brushSegmentShape(from: Point, to: Point, size: number): ZoneShape;

/** Union of shapes (stroke accumulation and painting into a zone). Null when empty. */
export declare function unionShapes(shapes: readonly ZoneShape[]): ZoneShape | null;

/** `shape` minus every shape in `cut`, then thin pieces (< ZONE_MIN_THICKNESS) removed. Null when empty. */
export declare function subtractShapes(shape: ZoneShape, cut: readonly ZoneShape[]): ZoneShape | null;

export interface ZoneShapeEntry {
  id: string;
  shape: ZoneShape;
}

export interface PaintResult {
  /** The zone that grew, or null when a new zone must be created with `shape`. */
  zoneId: string | null;
  /** The new shape of that zone (or of the new zone). Null when nothing could be painted. */
  shape: ZoneShape | null;
}

/**
 * Paint `stroke` (already accumulated) on the board.
 * - `targetZoneId` = the zone the stroke started inside (LMB pressed inside it) → that zone grows;
 *   null (started on empty board) → a new zone.
 * - The painted area never overlaps other zones: it is clipped against every other zone.
 * - Thin leftovers (< ZONE_MIN_THICKNESS) are removed.
 */
export declare function paintStroke(stroke: ZoneShape, targetZoneId: string | null, zones: readonly ZoneShapeEntry[]): PaintResult;

export interface EraseResult {
  /** Zones whose shape changed (split zones stay one zone with several parts). */
  changed: ZoneShapeEntry[];
  /** Zones erased completely (to be deleted). */
  removed: string[];
}

/** Erase `stroke` from EVERY zone under it (user decision 25.09); thin leftovers removed. */
export declare function eraseStroke(stroke: ZoneShape, zones: readonly ZoneShapeEntry[]): EraseResult;
