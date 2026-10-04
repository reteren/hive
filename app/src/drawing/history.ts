import { record, type HistoryCommand } from "../history/history.svelte";
import { drawingStore } from "./tileStore.svelte";
import { requireDrawingGpu, type BlendKind, type DrawQuad, type DrawingGpu, type GpuTexture, type TexRect } from "./gpu/glEngine";
import {
  DRAW_TILE_SIZE_PX,
  levelPxPerUnit,
  parseTileKey,
  tileKey,
  type TileKey,
  type TileSnapshot,
  type WorldRect,
} from "./types";
import type { SelectionClipMask } from "./selectionClip";

export interface DrawingHistoryExtras {
  undo(): void;
  redo(): void;
}

let restoreQueue = Promise.resolve();

/** Wait until an asynchronous tile restore caused by Undo/Redo has completed. */
export function waitForDrawingHistoryRestore(): Promise<void> {
  return restoreQueue;
}

/** Record one already-applied drawing action with its before/after tile copies. */
export function pushDrawingHistory(
  label: string,
  before: TileSnapshot,
  after: TileSnapshot,
  extra?: DrawingHistoryExtras,
): void {
  const command: HistoryCommand = {
    label,
    do() {
      enqueueRestore(after);
      extra?.redo();
    },
    undo() {
      enqueueRestore(before);
      extra?.undo();
    },
  };
  record(command);
}

/** World rectangle covered by a raster rectangle at a level. */
export function rasterRectToWorld(rasterX: number, rasterY: number, width: number, height: number, level = 0): WorldRect {
  const ppu = levelPxPerUnit(level);
  return { x: rasterX / ppu, y: rasterY / ppu, width: width / ppu, height: height / ppu };
}

export type LevelPaintKind = "paint" | "erase" | "under";

/**
 * Tiles a level-aware operation may change, for the Undo "before" snapshot:
 * paint → the level's tiles (created on demand) + existing finer tiles; erase → existing tiles of
 * every level; under → the level's tiles only.
 */
export function affectedTileKeys(rect: WorldRect, level: number, kind: LevelPaintKind): TileKey[] {
  if (kind === "under") return drawingStore.keysInRect(rect, true, level);
  const existing = drawingStore.existingKeysInRect(rect);
  if (kind === "erase") return existing;
  const finer = existing.filter((key) => (parseTileKey(key)?.level ?? level) < level);
  return [...new Set([...drawingStore.keysInRect(rect, true, level), ...finer])];
}

/** One GPU-resident piece of an operation source, positioned in raster px of the source level. */
export interface RasterPiece {
  texture: WebGLTexture;
  texWidth: number;
  texHeight: number;
  /** Part of the texture that holds the piece, in texture px. */
  texRect: TexRect;
  /** Raster px (source level) of texRect's top-left corner. */
  x: number;
  y: number;
}

/**
 * Pixels an operation paints with, already on the GPU: "rgba" pieces are straight colour stored
 * premultiplied; "mask" pieces carry coverage in red and are tinted with `color`.
 */
export interface GpuRasterSource {
  level: number;
  mode: "rgba" | "mask";
  /** Straight 0..1 colour for mask sources. */
  color: [number, number, number];
  pieces: RasterPiece[];
  /** Raster rect (source level) covering every piece. */
  bounds: TexRect;
  /** Make the pieces sampleable at coarser scales (mip chains). */
  prepare(gpu: DrawingGpu): void;
}

export type RasterSourceInput = HTMLCanvasElement | ImageData | GpuRasterSource;

function isGpuSource(source: RasterSourceInput): source is GpuRasterSource {
  return typeof (source as GpuRasterSource).pieces === "object" && Array.isArray((source as GpuRasterSource).pieces);
}

/** Upload a CPU image as a one-piece source (straight colour, premultiplied on upload). */
function uploadSource(gpu: DrawingGpu, image: HTMLCanvasElement | ImageData, rasterX: number, rasterY: number, level: number): { source: GpuRasterSource; texture: GpuTexture } {
  const texture = gpu.uploadImage(image);
  return {
    texture,
    source: {
      level,
      mode: "rgba",
      color: [1, 1, 1],
      pieces: [{ texture: texture.tex, texWidth: texture.width, texHeight: texture.height, texRect: { x: 0, y: 0, width: texture.width, height: texture.height }, x: rasterX, y: rasterY }],
      bounds: { x: rasterX, y: rasterY, width: texture.width, height: texture.height },
      prepare(engine) { engine.ensureMips(texture); },
    },
  };
}

const selectionTextures = new WeakMap<SelectionClipMask, WebGLTexture>();

/** The selection mask as an R8 texture (cached per selection object). */
export function selectionMaskTexture(gpu: DrawingGpu, selection: SelectionClipMask): WebGLTexture {
  const cached = selectionTextures.get(selection);
  if (cached) return cached;
  const texture = gpu.createMaskTexture(selection.width, selection.height, selection.mask);
  selectionTextures.set(selection, texture);
  return texture;
}

/** The selection itself as a white mask source (cut / delete the selected area). */
function selectionAsSource(gpu: DrawingGpu, selection: SelectionClipMask): GpuRasterSource {
  const texture = selectionMaskTexture(gpu, selection);
  return {
    level: selection.level,
    mode: "mask",
    color: [1, 1, 1],
    pieces: [{ texture, texWidth: selection.width, texHeight: selection.height, texRect: { x: 0, y: 0, width: selection.width, height: selection.height }, x: selection.x, y: selection.y }],
    bounds: { x: selection.x, y: selection.y, width: selection.width, height: selection.height },
    prepare() {},
  };
}

/**
 * Quads that put `source` into the tile `key` (tile-local px), optionally clipped by a selection.
 * Source px at level S map to tile px at level T by 2^(S−T).
 */
export function quadsForTile(
  gpu: DrawingGpu,
  source: GpuRasterSource,
  key: TileKey,
  opacity: number,
  selection: SelectionClipMask | null | undefined,
): DrawQuad[] {
  const parsed = parseTileKey(key);
  if (!parsed) return [];
  const scale = 2 ** (source.level - parsed.level);
  const tileX = parsed.col * DRAW_TILE_SIZE_PX;
  const tileY = parsed.row * DRAW_TILE_SIZE_PX;
  const color: [number, number, number, number] = source.mode === "mask"
    ? [source.color[0] * opacity, source.color[1] * opacity, source.color[2] * opacity, opacity]
    : [opacity, opacity, opacity, opacity];
  const clipTexture = selection ? selectionMaskTexture(gpu, selection) : null;
  const quads: DrawQuad[] = [];
  for (const piece of source.pieces) {
    const dst = {
      x: piece.x * scale - tileX,
      y: piece.y * scale - tileY,
      width: piece.texRect.width * scale,
      height: piece.texRect.height * scale,
    };
    if (dst.x >= DRAW_TILE_SIZE_PX || dst.y >= DRAW_TILE_SIZE_PX || dst.x + dst.width <= 0 || dst.y + dst.height <= 0) continue;
    let clip: DrawQuad["clip"] = null;
    if (selection && clipTexture) {
      // Destination rect in selection-level raster px, relative to the mask origin.
      const toSelection = 2 ** (parsed.level - selection.level);
      clip = {
        texture: clipTexture,
        width: selection.width,
        height: selection.height,
        rect: {
          x: (dst.x + tileX) * toSelection - selection.x,
          y: (dst.y + tileY) * toSelection - selection.y,
          width: dst.width * toSelection,
          height: dst.height * toSelection,
        },
      };
    }
    quads.push({
      dst,
      src: { texture: piece.texture, width: piece.texWidth, height: piece.texHeight, rect: piece.texRect },
      mode: source.mode,
      color,
      clip,
    });
  }
  return quads;
}

/**
 * Apply a level-L raster source to the drawing, entirely on the GPU:
 * - paint: source-over into level L, and source-atop into existing finer tiles so newer paint covers
 *   older detail exactly where that detail exists (finer levels are displayed above coarser ones);
 * - erase: destination-out from existing tiles of every level;
 * - under: destination-over into level L only (fill fringe beneath antialiased stroke edges).
 * `selectionMaskOnly` paints the selection area itself (cut / delete). Returns touched keys.
 */
export function applyAcrossLevels(
  input: RasterSourceInput,
  rasterX: number,
  rasterY: number,
  level: number,
  kind: LevelPaintKind,
  alpha = 1,
  selection?: SelectionClipMask | null,
  selectionMaskOnly = false,
): TileKey[] {
  const opacity = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 0));
  if (opacity === 0) return [];
  const gpu = requireDrawingGpu();
  let uploaded: GpuTexture | null = null;
  let source: GpuRasterSource;
  if (selectionMaskOnly && selection) {
    source = selectionAsSource(gpu, selection);
  } else if (isGpuSource(input)) {
    source = input;
  } else {
    if (!Number.isSafeInteger(rasterX) || !Number.isSafeInteger(rasterY) || input.width < 1 || input.height < 1) return [];
    ({ source, texture: uploaded } = uploadSource(gpu, input, rasterX, rasterY, level));
  }
  const clip = selectionMaskOnly ? null : selection ?? null;
  try {
    source.prepare(gpu);
    const rect = rasterRectToWorld(source.bounds.x, source.bounds.y, source.bounds.width, source.bounds.height, source.level);
    const touched: TileKey[] = [];
    const apply = (keys: readonly TileKey[], blend: BlendKind, create: boolean): void => {
      for (const key of keys) {
        const quads = quadsForTile(gpu, source, key, opacity, clip);
        if (!quads.length) continue;
        const tile = drawingStore.texture(key, create);
        if (!tile) continue;
        gpu.drawInto(tile, quads, blend);
        touched.push(key);
      }
    };
    if (kind === "erase") {
      apply(drawingStore.existingKeysInRect(rect), "out", false);
    } else if (kind === "under") {
      apply(drawingStore.keysInRect(rect, true, source.level), "under", true);
    } else {
      // Finer tiles first: they must not see the coarse tiles this call is about to create.
      const finer = drawingStore.existingKeysInRect(rect).filter((key) => (parseTileKey(key)?.level ?? source.level) < source.level);
      apply(finer, "atop", false);
      apply(drawingStore.keysInRect(rect, true, source.level), "over", true);
    }
    const keys = [...new Set(touched)];
    drawingStore.commit(keys);
    return keys;
  } finally {
    gpu.deleteTexture(uploaded);
  }
}

/**
 * Composite tiles into the scratch texture as a level-L raster rect and read it back (straight alpha).
 * `onlyLevel` restricts it to one level's tiles; otherwise every level, coarsest first (what the user sees).
 */
function readRect(rasterX: number, rasterY: number, width: number, height: number, level: number, onlyLevel: boolean): ImageData {
  validateRasterRect(rasterX, rasterY, width, height);
  const rect = rasterRectToWorld(rasterX, rasterY, width, height, level);
  const keys = onlyLevel ? drawingStore.keysInRect(rect, false, level) : drawingStore.existingKeysInRect(rect);
  if (keys.length === 0) return new ImageData(width, height);
  const gpu = requireDrawingGpu();
  const scratch = gpu.scratchTexture(width, height);
  gpu.clear(scratch, { x: 0, y: 0, width, height });
  const quads: DrawQuad[] = [];
  for (const key of keys) {
    const parsed = parseTileKey(key);
    const tile = drawingStore.texture(key, false);
    if (!parsed || !tile) continue;
    gpu.ensureMips(tile);
    const scale = 2 ** (parsed.level - level);
    quads.push({
      dst: {
        x: parsed.col * DRAW_TILE_SIZE_PX * scale - rasterX,
        y: parsed.row * DRAW_TILE_SIZE_PX * scale - rasterY,
        width: DRAW_TILE_SIZE_PX * scale,
        height: DRAW_TILE_SIZE_PX * scale,
      },
      src: { texture: tile.tex, width: DRAW_TILE_SIZE_PX, height: DRAW_TILE_SIZE_PX, rect: { x: 0, y: 0, width: DRAW_TILE_SIZE_PX, height: DRAW_TILE_SIZE_PX } },
      mode: "rgba",
      color: [1, 1, 1, 1],
    });
  }
  gpu.drawInto(scratch, quads, "over");
  const data = gpu.readStraight(scratch, { x: 0, y: 0, width, height });
  const image = new ImageData(width, height);
  image.data.set(data);
  return image;
}

/** What the user sees (all levels composited, coarsest first) as a level-L raster rectangle. */
export function readCompositeRect(rasterX: number, rasterY: number, width: number, height: number, level = 0): ImageData {
  return readRect(rasterX, rasterY, width, height, level, false);
}

/** A bounded raster rectangle of one level's tiles; absent tiles are transparent. */
export function readRasterRect(rasterX: number, rasterY: number, width: number, height: number, level = 0): ImageData {
  return readRect(rasterX, rasterY, width, height, level, true);
}

/** Replace a raster rectangle across one level's tiles (straight-alpha pixels). */
export function writeRasterRect(image: ImageData, rasterX: number, rasterY: number, level = 0): TileKey[] {
  validateRasterRect(rasterX, rasterY, image.width, image.height);
  const gpu = requireDrawingGpu();
  const colStart = Math.floor(rasterX / DRAW_TILE_SIZE_PX);
  const rowStart = Math.floor(rasterY / DRAW_TILE_SIZE_PX);
  const colEnd = Math.floor((rasterX + image.width - 1) / DRAW_TILE_SIZE_PX);
  const rowEnd = Math.floor((rasterY + image.height - 1) / DRAW_TILE_SIZE_PX);
  const changed: TileKey[] = [];
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      const key = tileKey(col, row, level);
      const left = Math.max(rasterX, col * DRAW_TILE_SIZE_PX);
      const top = Math.max(rasterY, row * DRAW_TILE_SIZE_PX);
      const right = Math.min(rasterX + image.width, (col + 1) * DRAW_TILE_SIZE_PX);
      const bottom = Math.min(rasterY + image.height, (row + 1) * DRAW_TILE_SIZE_PX);
      const tile = drawingStore.texture(key, true);
      if (!tile) throw new Error(`Could not write drawing tile ${key}.`);
      const width = right - left;
      const chunk = new Uint8ClampedArray(width * (bottom - top) * 4);
      for (let y = top; y < bottom; y += 1) {
        const from = ((y - rasterY) * image.width + (left - rasterX)) * 4;
        chunk.set(image.data.subarray(from, from + width * 4), (y - top) * width * 4);
      }
      gpu.writePixels(tile, left - col * DRAW_TILE_SIZE_PX, top - row * DRAW_TILE_SIZE_PX, width, bottom - top, chunk);
      changed.push(key);
    }
  }
  drawingStore.commit(changed);
  return changed;
}

function enqueueRestore(snapshot: TileSnapshot): void {
  restoreQueue = restoreQueue.then(() => drawingStore.restore(snapshot)).catch((error: unknown) => {
    console.error("Could not restore drawing history snapshot", error);
  });
}

function validateRasterRect(x: number, y: number, width: number, height: number): void {
  if (![x, y, width, height].every(Number.isSafeInteger) || width < 1 || height < 1 ||
    width > 4096 || height > 4096 || width * height > 16_777_216) {
    throw new RangeError("Drawing raster rectangle is invalid or too large.");
  }
}
