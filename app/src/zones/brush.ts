import { snapToGrid } from "../board/gridMath";
import type { Point } from "../board/cameraMath";
import type { ZoneBounds } from "../model/zone";
import {
  createRectUnionGrid,
  createShapeGrid,
  pruneGrid,
  shapeFromGrid,
  subtractShapeCells,
} from "./shapeGrid";
import { normalizeShape, type ZoneShape } from "./shape";

/**
 * Zone brush contract (redesign 25.09, replaces the Edit shape editor). The zone tool paints zones
 * with a SQUARE brush (LMB) and erases with the same square (RMB); Ctrl+LMB / Ctrl+RMB drag a
 * rectangle to paint / erase. Brush squares snap to a 10 u grid.
 */

export const BRUSH_MIN = 20;
export const BRUSH_MAX = 300;
export const BRUSH_STEP = 20;
/** Brush squares are placed on this grid (user decision 25.09). */
export const BRUSH_GRID = 10;
/** No zone piece may be thinner than this after painting/erasing (replaces the 30 u edit limit). */
export const ZONE_MIN_THICKNESS = 20;

/** Clamp to [BRUSH_MIN, BRUSH_MAX] and round to the nearest multiple of BRUSH_STEP (0 is impossible). */
export function normalizeBrushSize(size: number): number {
  if (Number.isNaN(size)) return BRUSH_MIN;
  const nearest = Math.round(size / BRUSH_STEP) * BRUSH_STEP;
  return Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, nearest));
}

/**
 * The square the brush covers when centred on `point`. Its top-left is snapped with Math.round to
 * the nearest 10u multiple (ties go toward positive infinity, including negative half-steps);
 * `snap = false` supports internal geometry callers; the interactive brush always snaps.
 */
export function brushSquare(point: Point, size: number, snap = true): ZoneBounds {
  if (![point.x, point.y].every(Number.isFinite)) throw new RangeError("Brush point must be finite.");
  const normalizedSize = normalizeBrushSize(size);
  const corner = { x: point.x - normalizedSize / 2, y: point.y - normalizedSize / 2 };
  const snapped = snap ? snapToGrid(corner, BRUSH_GRID) : corner;
  const topLeft = {
    x: Object.is(snapped.x, -0) ? 0 : snapped.x,
    y: Object.is(snapped.y, -0) ? 0 : snapped.y,
  };
  return { x: topLeft.x, y: topLeft.y, width: normalizedSize, height: normalizedSize };
}

/**
 * The area covered by moving the brush from `from` to `to`. Samples are no more than half a
 * 10u grid step apart along the path, then snapped square stamps are rasterized as one union.
 */
export function brushSegmentShape(from: Point, to: Point, size: number, snap = true): ZoneShape {
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) throw new RangeError("Brush segment must be finite.");
  const normalizedSize = normalizeBrushSize(size);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const sampleCount = Math.max(1, Math.ceil(distance / (BRUSH_GRID / 2)));
  const squares = new Map<string, ZoneBounds>();
  for (let sample = 0; sample <= sampleCount; sample += 1) {
    const ratio = sample / sampleCount;
    const point = {
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio,
    };
    const square = brushSquare(point, normalizedSize, snap);
    squares.set(`${square.x},${square.y}`, square);
  }
  return shapeFromGrid(createRectUnionGrid([...squares.values()]));
}

/** Union of shapes (stroke accumulation and painting into a zone). Null when empty. */
export function unionShapes(shapes: readonly ZoneShape[]): ZoneShape | null {
  if (shapes.length === 0) return null;
  const grid = createShapeGrid(shapes);
  if (!grid.cells.some((row) => row.some(Boolean))) return null;
  const result = shapeFromGrid(grid);
  return result.parts.length > 0 ? result : null;
}

/** `shape` minus every shape in `cut`, then thin pieces (< ZONE_MIN_THICKNESS) removed. Null when empty. */
export function subtractShapes(shape: ZoneShape, cut: readonly ZoneShape[]): ZoneShape | null {
  const grid = createShapeGrid([shape, ...cut]);
  subtractShapeCells(grid, shape, cut);
  return pruneGrid(grid, ZONE_MIN_THICKNESS) ? shapeFromGrid(grid) : null;
}

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
export function paintStroke(stroke: ZoneShape, targetZoneId: string | null, zones: readonly ZoneShapeEntry[]): PaintResult {
  const target = targetZoneId === null ? undefined : zones.find((entry) => entry.id === targetZoneId);
  const obstacles = zones.filter((entry) => entry !== target).map((entry) => entry.shape);
  const clippedStroke = subtractShapes(stroke, obstacles);
  if (!clippedStroke) return { zoneId: target?.id ?? null, shape: null };

  if (!target) return { zoneId: null, shape: clippedStroke };
  const grown = unionShapes([target.shape, clippedStroke]);
  if (!grown) return { zoneId: target.id, shape: null };
  const normalized = normalizeShape(grown);
  const result = pruneNormalizedShape(normalized);
  return { zoneId: target.id, shape: result };
}

export interface EraseResult {
  /** Zones whose shape changed (split zones stay one zone with several parts). */
  changed: ZoneShapeEntry[];
  /** Zones erased completely (to be deleted). */
  removed: string[];
}

/** Erase `stroke` from EVERY zone under it (user decision 25.09); thin leftovers removed. */
export function eraseStroke(stroke: ZoneShape, zones: readonly ZoneShapeEntry[]): EraseResult {
  const changed: ZoneShapeEntry[] = [];
  const removed: string[] = [];
  for (const entry of zones) {
    const result = subtractShapes(entry.shape, [stroke]);
    if (!result) {
      removed.push(entry.id);
      continue;
    }
    if (!sameGeometry(entry.shape, result)) changed.push({ id: entry.id, shape: result });
  }
  return { changed, removed };
}

function pruneNormalizedShape(shape: ZoneShape): ZoneShape | null {
  // subtractShapes(shape, []) applies the same stable thin-run pruning as erase and clipping.
  return subtractShapes(shape, []);
}

function sameGeometry(first: ZoneShape, second: ZoneShape): boolean {
  return JSON.stringify(normalizeShape(first)) === JSON.stringify(normalizeShape(second));
}
