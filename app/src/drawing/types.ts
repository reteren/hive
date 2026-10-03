/**
 * R10 drawing contract (coordinator-owned; ask before changing).
 *
 * MODEL: the drawing is ONE raster layer over the infinite board, stored as square tiles in world
 * space. Raster (not vector) because the roadmap needs raster operations: eraser on drawings and
 * photos, flood fill, lasso cut/move of a piece of a stroke, spray, blur, smudge (R10.2–R10.7).
 *
 * - Density: DRAW_PX_PER_UNIT raster pixels per world unit (1 u = 10 px at zoom 1, so 20 px/u is
 *   crisp up to ~2× zoom). A tile covers DRAW_TILE_SIZE_PX px = DRAW_TILE_SIZE_PX / DRAW_PX_PER_UNIT u.
 * - Tile key "col:row": tile (col,row) covers world x in [col*T, (col+1)*T), y likewise, T = tile size in u.
 * - Empty tiles are not stored. A tile that becomes fully transparent is deleted.
 * - Layer order (user default, not objected): above zones, BELOW links, beacons and nodes.
 *   Drawings never belong to zones or beacon coverage (ROADMAP M172).
 * - Brush size is in SCREEN px (the cursor stays e.g. 10 px at any zoom); in world units it is
 *   size / (PX_PER_UNIT * zoom), so drawing from far away makes thicker lines on the board (R10.1).
 * - Accumulation (R10.1): within ONE stroke the paint does not build up (a stroke is rasterised into a
 *   temporary stroke layer at max(alpha), then composited once on pointer-up with the stroke opacity).
 *   A NEW stroke over the same place adds up. Holding the pointer still adds nothing.
 *
 * PERSISTENCE (project folder): `drawing/tiles/<col>_<row>.png` (straight-alpha RGBA PNG, exactly
 * DRAW_TILE_SIZE_PX square) + `drawing/drawing.json` = DrawingIndex. Saved debounced after edits like
 * notes; included in backups/export like notes (not attachments: tiles are mutable).
 *
 * UNDO: every user action (one stroke, one fill, one selection move/delete) is ONE history entry holding
 * the before/after content of only the touched tiles.
 */
export const DRAW_PX_PER_UNIT = 20;
export const DRAW_TILE_SIZE_PX = 512;
export const DRAW_TILE_SIZE_UNITS = DRAW_TILE_SIZE_PX / DRAW_PX_PER_UNIT;

export type TileKey = string; // "col:row", integers, may be negative

export interface DrawingIndex {
  version: 1;
  pxPerUnit: number;
  tileSizePx: number;
  /** Keys of tiles that exist on disk. */
  tiles: TileKey[];
}

export type DrawTool = "brush" | "eraser" | "fill" | "select-rect" | "select-lasso" | "select-polygon";

export interface BrushSettings {
  /** "#rrggbb" */
  color: string;
  /** Screen px diameter, 1..400. */
  size: number;
  /** 0.05..1, applied once per stroke. */
  opacity: number;
  /** 0 (soft edge) .. 1 (hard edge). */
  hardness: number;
}

export interface BrushPreset extends BrushSettings {
  id: string;
  name: string;
}

export const DEFAULT_BRUSH: BrushSettings = { color: "#e8e8e8", size: 10, opacity: 1, hardness: 0.85 };

/** World rectangle in units. */
export interface WorldRect { x: number; y: number; width: number; height: number }

/** Snapshot of tiles for undo: null = tile absent. Stored as encoded PNG blobs to keep memory sane. */
export type TileSnapshot = Map<TileKey, Blob | null>;

/**
 * The tile store API (implemented by TASK CORE in src/drawing/tileStore.svelte.ts). Everything that
 * paints (brush, eraser, fill, selection, later spray/effects) goes through this.
 */
export interface DrawingTileStore {
  /** Tile canvas, creating an empty one when `create`. Coordinates of the canvas are tile-local px. */
  tile(key: TileKey, create: boolean): HTMLCanvasElement | null;
  /** Keys of tiles intersecting a world rect (existing only unless `includeMissing`). */
  keysInRect(rect: WorldRect, includeMissing?: boolean): TileKey[];
  /** Encode current content of the given tiles (for undo "before"/"after"). */
  snapshot(keys: readonly TileKey[]): Promise<TileSnapshot>;
  /** Replace tile contents from a snapshot (undo/redo); deletes tiles mapped to null. */
  restore(snapshot: TileSnapshot): Promise<void>;
  /** Mark tiles changed: repaint on screen + schedule save; fully transparent tiles are dropped. */
  commit(keys: readonly TileKey[]): void;
  /** Bumps on any visible change (Svelte-reactive) so layers re-render. */
  readonly revision: number;
}

export function tileKey(col: number, row: number): TileKey {
  return `${col}:${row}`;
}

export function parseTileKey(key: TileKey): { col: number; row: number } | null {
  const match = /^(-?\d+):(-?\d+)$/.exec(key);
  return match ? { col: Number(match[1]), row: Number(match[2]) } : null;
}

/** World point -> raster pixel (global, may be negative). */
export function worldToRaster(x: number, y: number): { px: number; py: number } {
  return { px: x * DRAW_PX_PER_UNIT, py: y * DRAW_PX_PER_UNIT };
}
