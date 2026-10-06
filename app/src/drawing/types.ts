/**
 * R10 drawing contract (coordinator-owned; ask before changing).
 *
 * MODEL: the drawing is ONE raster layer over the infinite board, stored as square tiles in world
 * space. Raster (not vector) because the roadmap needs raster operations: eraser on drawings and
 * photos, flood fill, lasso cut/move of a piece of a stroke, spray, blur, smudge (R10.2–R10.7).
 *
 * - LEVELS (resolution pyramid): level L has levelPxPerUnit(L) = DRAW_PX_PER_UNIT / 2^L raster px per
 *   world unit. Every gesture works at the level that matches the current zoom (drawLevelForZoom: 1.33–2.67
 *   raster px per device px), so a stroke costs the same at zoom 0.05 as at zoom 1. A tile is always
 *   DRAW_TILE_SIZE_PX square, so it covers levelTileUnits(L) = DRAW_TILE_SIZE_PX / levelPxPerUnit(L) u.
 *   Display order: coarser levels below finer ones. Painting at L is source-over at L and source-atop on
 *   existing finer tiles (fresh paint covers older detail without doubling); erasing hits every level.
 * - Tile key "col:row" (level 0, the original format) or "L:col:row" (level L ≠ 0): tile (col,row)
 *   covers world x in [col*T, (col+1)*T), y likewise, T = levelTileUnits(L).
 * - Empty tiles are not stored. A tile that becomes fully transparent is deleted.
 * - Layer order (user default, not objected): above zones, BELOW links, beacons and nodes.
 *   Drawings never belong to zones or beacon coverage (ROADMAP M172).
 * - Brush size is in SCREEN px (the cursor stays e.g. 10 px at any zoom); in world units it is
 *   size / (PX_PER_UNIT * zoom), so drawing from far away makes thicker lines on the board (R10.1).
 * - Accumulation (R10.1): within ONE stroke the paint does not build up (a stroke is rasterised into a
 *   temporary stroke layer at max(alpha), then composited once on pointer-up with the stroke opacity).
 *   A NEW stroke over the same place adds up. Holding the pointer still adds nothing.
 *
 * PERSISTENCE (project folder): `drawing/tiles/<col>_<row>.png` (level 0) or `L<L>_<col>_<row>.png` (straight-alpha RGBA PNG, exactly
 * DRAW_TILE_SIZE_PX square) + `drawing/drawing.json` = DrawingIndex. Saved debounced after edits like
 * notes; included in backups/export like notes (not attachments: tiles are mutable).
 *
 * UNDO: every user action (one stroke, one fill, one selection move/delete) is ONE history entry holding
 * the before/after content of only the touched tiles.
 */
import type { GpuTexture } from "./gpu/glEngine";
import type { TileCopy } from "./tileStore.svelte";

export const DRAW_PX_PER_UNIT = 20;
export const DRAW_TILE_SIZE_PX = 512;
export const DRAW_TILE_SIZE_UNITS = DRAW_TILE_SIZE_PX / DRAW_PX_PER_UNIT;

export type TileKey = string; // "col:row" (level 0) or "L:col:row", integers, may be negative

/** Finest and coarsest resolution levels (160 px/u … 0.3125 px/u). */
export const DRAW_MIN_LEVEL = -3;
export const DRAW_MAX_LEVEL = 6;

/** Raster px per world unit at a pyramid level. */
export function levelPxPerUnit(level: number): number {
  return DRAW_PX_PER_UNIT / 2 ** level;
}

/** World units covered by one tile side at a pyramid level. */
export function levelTileUnits(level: number): number {
  return DRAW_TILE_SIZE_PX / levelPxPerUnit(level);
}

/**
 * The level a gesture at this zoom works in: the coarsest one that still has at least one raster px
 * per device px (screen px per unit = 10 × zoom × devicePixelRatio).
 */
export function drawLevelForZoom(zoom: number, devicePixelRatio = 1): number {
  const density = (Number.isFinite(zoom) && zoom > 0 ? zoom : 1) * (Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1);
  // 1.33–2.67 raster px per device px: stays crisp after zooming in a little; the GPU makes it cheap.
  const level = Math.floor(Math.log2(DRAW_PX_PER_UNIT / (15 * density)) + 1e-9);
  return Math.min(DRAW_MAX_LEVEL, Math.max(DRAW_MIN_LEVEL, level));
}

/** Working level for the current window (reads devicePixelRatio when available). */
export function currentDrawLevel(zoom: number): number {
  return drawLevelForZoom(zoom, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
}

export interface DrawingIndex {
  version: 1;
  pxPerUnit: number;
  tileSizePx: number;
  /** Keys of tiles that exist on disk. */
  tiles: TileKey[];
}

/** R10 delivery 2 adds "shape" (R10.5), "spray" (R10.6) and "effect" (R10.7: blur / smudge / swirl). */
export type DrawTool = "brush" | "eraser" | "fill" | "text" | "select-rect" | "select-lasso" | "select-polygon" | "shape" | "spray" | "effect";

export interface BrushSettings {
  /** "#rrggbb" */
  color: string;
  /** Screen px diameter, 1..400. */
  size: number;
  /** 0.05..1, applied once per stroke. */
  opacity: number;
  /** 0 (soft edge) .. 1 (hard edge). */
  hardness: number;
  /** GPU brush shape used by the Brush tool. Missing in older saved settings. */
  tip?: BrushTip;
  /** Calligraphy nib orientation, degrees clockwise from horizontal (0..180). */
  calligraphyAngle?: number;
  /** Spray density in dots/second for a 24 px diameter brush, scaled by brush area. */
  sprayDensity?: number;
  /** Spray dot diameter in screen pixels. */
  sprayDotSize?: number;
}

export type BrushTip = "round" | "marker" | "pencil" | "calligraphy" | "charcoal";

export const DEFAULT_BRUSH: BrushSettings = {
  color: "#e8e8e8", size: 10, opacity: 1, hardness: 0.85,
  tip: "round", calligraphyAngle: 45, sprayDensity: 120, sprayDotSize: 3,
};

/** World rectangle in units. */
export interface WorldRect { x: number; y: number; width: number; height: number }

/** Snapshot of tiles for undo: null = tile absent. GPU copies, demoted to compressed RAM when old. */
export type TileSnapshot = Map<TileKey, TileCopy | null>;

/**
 * The tile store API (implemented by TASK CORE in src/drawing/tileStore.svelte.ts). Everything that
 * paints (brush, eraser, fill, selection, later spray/effects) goes through this.
 */
export interface DrawingTileStore {
  has(key: TileKey): boolean;
  /** Tile texture on the drawing GPU, creating an empty one when `create`. Texel row 0 = raster top row. */
  texture(key: TileKey, create: boolean): GpuTexture | null;
  /** Keys of one level's tiles intersecting a world rect (existing only unless `includeMissing`); level 0 by default. */
  keysInRect(rect: WorldRect, includeMissing?: boolean, level?: number): TileKey[];
  /** Existing tiles of every level that intersect a world rect, coarsest level first. */
  existingKeysInRect(rect: WorldRect): TileKey[];
  /** Levels that currently hold tiles, coarsest first. */
  levels(): number[];
  /** Copy the current content of the given tiles (for undo "before"/"after"). */
  snapshot(keys: readonly TileKey[]): Promise<TileSnapshot>;
  /** Replace tile contents from a snapshot (undo/redo); deletes tiles mapped to null. */
  restore(snapshot: TileSnapshot): Promise<void>;
  /** Mark tiles changed: repaint on screen + schedule save (empty tiles are dropped while saving). */
  commit(keys: readonly TileKey[]): void;
  /** Bumps on any visible change (Svelte-reactive) so layers re-render. */
  readonly revision: number;
}

export function tileKey(col: number, row: number, level = 0): TileKey {
  return level === 0 ? `${col}:${row}` : `${level}:${col}:${row}`;
}

export function parseTileKey(key: TileKey): { col: number; row: number; level: number } | null {
  const match = /^(?:(-?\d+):)?(-?\d+):(-?\d+)$/.exec(key);
  if (!match) return null;
  const level = match[1] === undefined ? 0 : Number(match[1]);
  // Level 0 has exactly one spelling ("col:row") so a tile can never exist twice.
  if (match[1] !== undefined && level === 0) return null;
  if (!Number.isInteger(level) || level < DRAW_MIN_LEVEL || level > DRAW_MAX_LEVEL) return null;
  return { col: Number(match[2]), row: Number(match[3]), level };
}

/** World point -> raster pixel (global, may be negative) at a pyramid level. */
export function worldToRaster(x: number, y: number, level = 0): { px: number; py: number } {
  const ppu = levelPxPerUnit(level);
  return { px: x * ppu, py: y * ppu };
}

/**
 * TOOL HANDLERS (coordinator contract, added after dispatch). TOOLS owns input: in draw mode it turns
 * pointer/keyboard events into DrawPointerEvent and calls the handler registered for the active tool
 * (src/drawing/toolRegistry.ts). Owners register: CORE → "brush"; ERASEFILL → "eraser", "fill";
 * SELECT → "select-rect", "select-lasso", "select-polygon".
 */
export interface DrawPointerEvent {
  /** World units. */
  world: { x: number; y: number };
  /** Client px (for overlays). */
  client: { x: number; y: number };
  zoom: number;
  /** 0..1, 0.5 when the device has no pressure. */
  pressure: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  /** Number of clicks (2 = double click), for polygon close. */
  detail: number;
}

export interface DrawToolHandler {
  down(event: DrawPointerEvent): void;
  move(event: DrawPointerEvent): void;
  up(event: DrawPointerEvent): void;
  /** Pointer lost / Esc / tool switched mid-gesture: abandon without committing. */
  cancel(): void;
  /** Key while this tool is active (Delete, Enter, Esc, Ctrl+C/V…). Return true when handled. */
  key?(event: KeyboardEvent): boolean;
  /** Called when the tool stops being active (commit pending selection etc.). */
  deactivate?(): void;
}

/**
 * CORE also exports (src/drawing/history.ts, src/drawing/tileStore.svelte.ts, src/drawing/brush.ts):
 *   drawingStore: DrawingTileStore                       — the singleton store
 *   pushDrawingHistory(label, before: TileSnapshot, after: TileSnapshot, extra?: { undo(): void; redo(): void })
 *       — one Undo entry; `extra` lets ERASEFILL restore an image node ref together with tiles
 *   paintIntoTiles(source: HTMLCanvasElement, rasterX: number, rasterY: number,
 *                  mode: GlobalCompositeOperation, alpha: number): TileKey[]  — composite + returns touched keys
 *   readRasterRect(rasterX, rasterY, width, height): ImageData   — read across tiles (fill/selection)
 *   writeRasterRect(image: ImageData, rasterX, rasterY): TileKey[] — write across tiles (replace pixels)
 */

/**
 * STROKE API (CORE, src/drawing/brush.ts) — shared by brush and eraser:
 *   createStroke(settings: BrushSettings, zoom: number): DrawStroke
 *   interface DrawStroke {
 *     add(world: { x: number; y: number }, pressure?: number): void;  // interpolates, max-alpha within stroke
 *     readonly preview: HTMLCanvasElement;   // live stroke mask (white×alpha for erase use), world-positioned by
 *     readonly rasterX: number;              //   raster origin rasterX/rasterY (px, may be negative)
 *     readonly rasterY: number;
 *     finish(): { source: HTMLCanvasElement; rasterX: number; rasterY: number } | null; // null if empty
 *     dispose(): void;
 *   }
 * Brush tool: paintIntoTiles(source, x, y, "source-over", settings.opacity).
 * Eraser tool: paintIntoTiles(source, x, y, "destination-out", settings.opacity) + photo copy-on-write with
 * the same source mask. The stroke source is painted in the brush colour; for erase only its alpha matters.
 */
