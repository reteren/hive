import { record, type HistoryCommand } from "../history/history.svelte";
import { drawingStore } from "./tileStore.svelte";
import {
  DRAW_TILE_SIZE_PX,
  levelPxPerUnit,
  parseTileKey,
  tileKey,
  type TileKey,
  type TileSnapshot,
  type WorldRect,
} from "./types";
import { clipRasterDataToSelection, createSelectionCoverageSampler, type SelectionClipMask } from "./selectionClip";

export interface DrawingHistoryExtras {
  undo(): void;
  redo(): void;
}

let restoreQueue = Promise.resolve();

/** Wait until an asynchronous tile restore caused by Undo/Redo has completed. */
export function waitForDrawingHistoryRestore(): Promise<void> {
  return restoreQueue;
}

/** Record one already-applied drawing action with its compact before/after tile snapshots. */
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

/**
 * Apply a level-L raster source to the drawing:
 * - paint: source-over into level L, and source-atop into existing finer tiles so newer paint covers
 *   older detail exactly where that detail exists (finer levels are displayed above coarser ones);
 * - erase: destination-out from existing tiles of every level;
 * - under: destination-over into level L only (fill fringe beneath antialiased stroke edges).
 * Other levels get the source scaled by the GPU; there is no per-pixel JS work. Returns touched keys.
 */
export function applyAcrossLevels(
  source: HTMLCanvasElement,
  rasterX: number,
  rasterY: number,
  level: number,
  kind: LevelPaintKind,
  alpha = 1,
  selection?: SelectionClipMask | null,
  selectionMaskOnly = false,
): TileKey[] {
  if (!Number.isSafeInteger(rasterX) || !Number.isSafeInteger(rasterY) || source.width < 1 || source.height < 1) return [];
  const opacity = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 0));
  if (opacity === 0) return [];
  const rect = rasterRectToWorld(rasterX, rasterY, source.width, source.height, level);
  const touched: TileKey[] = [];
  const apply = (keys: readonly TileKey[], mode: GlobalCompositeOperation): void => {
    if (!selection) {
      touched.push(...drawTiles(keys, source, rasterX, rasterY, level, mode, opacity));
      return;
    }
    const byLevel = new Map<number, TileKey[]>();
    for (const key of keys) {
      const parsed = parseTileKey(key);
      if (!parsed) continue;
      const group = byLevel.get(parsed.level) ?? [];
      group.push(key);
      byLevel.set(parsed.level, group);
    }
    for (const [targetLevel, targetKeys] of byLevel) {
      // Rasterize into each bounded destination tile before clipping. This avoids large full-size
      // temporary canvases when a coarse stroke must also update existing fine pyramid tiles.
      touched.push(...drawClippedTiles(
        targetKeys,
        source,
        rasterX,
        rasterY,
        level,
        targetLevel,
        mode,
        opacity,
        selection,
        selectionMaskOnly,
      ));
    }
  };
  if (kind === "erase") {
    apply(drawingStore.existingKeysInRect(rect), "destination-out");
  } else if (kind === "under") {
    apply(drawingStore.keysInRect(rect, true, level), "destination-over");
  } else {
    // Finer tiles first: they must not see the coarse tiles this call is about to create.
    const finer = drawingStore.existingKeysInRect(rect).filter((key) => (parseTileKey(key)?.level ?? level) < level);
    apply(finer, "source-atop");
    apply(drawingStore.keysInRect(rect, true, level), "source-over");
  }
  const keys = [...new Set(touched)];
  // Paint only adds alpha (source-atop keeps it), so only erasing can leave a tile empty.
  drawingStore.commit(keys, kind === "erase");
  return keys;
}

function drawTiles(
  keys: readonly TileKey[],
  source: HTMLCanvasElement,
  rasterX: number,
  rasterY: number,
  sourceLevel: number,
  mode: GlobalCompositeOperation,
  opacity: number,
): TileKey[] {
  const create = mode === "source-over" || mode === "destination-over";
  const done: TileKey[] = [];
  for (const key of keys) {
    const parsed = parseTileKey(key);
    const tile = parsed ? drawingStore.tile(key, create) : null;
    if (!parsed || !tile) continue;
    const context = tile.getContext("2d");
    if (!context) throw new Error(`Could not paint drawing tile ${key}.`);
    // Source px (level sourceLevel) → tile px (level parsed.level).
    const scale = 2 ** (sourceLevel - parsed.level);
    context.save();
    context.globalCompositeOperation = mode;
    context.globalAlpha = opacity;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      source,
      rasterX * scale - parsed.col * DRAW_TILE_SIZE_PX,
      rasterY * scale - parsed.row * DRAW_TILE_SIZE_PX,
      source.width * scale,
      source.height * scale,
    );
    context.restore();
    done.push(key);
  }
  return done;
}

function drawClippedTiles(
  keys: readonly TileKey[],
  source: HTMLCanvasElement,
  rasterX: number,
  rasterY: number,
  sourceLevel: number,
  targetLevel: number,
  mode: GlobalCompositeOperation,
  opacity: number,
  selection: SelectionClipMask,
  selectionMaskOnly: boolean,
): TileKey[] {
  const create = mode === "source-over" || mode === "destination-over";
  const scratch = document.createElement("canvas");
  scratch.width = DRAW_TILE_SIZE_PX;
  scratch.height = DRAW_TILE_SIZE_PX;
  const scratchContext = scratch.getContext("2d", { willReadFrequently: true });
  if (!scratchContext) throw new Error("Could not prepare a clipped drawing tile.");
  const coverageAt = selectionMaskOnly
    ? createSelectionCoverageSampler(selection, targetLevel, DRAW_TILE_SIZE_PX * DRAW_TILE_SIZE_PX)
    : null;
  const done: TileKey[] = [];
  try {
    for (const key of keys) {
      const parsed = parseTileKey(key);
      const tile = parsed ? drawingStore.tile(key, create) : null;
      if (!parsed || !tile) continue;
      scratchContext.setTransform(1, 0, 0, 1, 0, 0);
      scratchContext.globalAlpha = 1;
      scratchContext.globalCompositeOperation = "source-over";
      scratchContext.clearRect(0, 0, scratch.width, scratch.height);
      if (selectionMaskOnly && coverageAt) {
        const image = scratchContext.createImageData(DRAW_TILE_SIZE_PX, DRAW_TILE_SIZE_PX);
        const tileX = parsed.col * DRAW_TILE_SIZE_PX;
        const tileY = parsed.row * DRAW_TILE_SIZE_PX;
        for (let y = 0; y < DRAW_TILE_SIZE_PX; y += 1) {
          for (let x = 0; x < DRAW_TILE_SIZE_PX; x += 1) {
            image.data[(y * DRAW_TILE_SIZE_PX + x) * 4 + 3] =
              Math.round(coverageAt(tileX + x, tileY + y) * 255);
          }
        }
        scratchContext.putImageData(image, 0, 0);
      } else {
        const scale = 2 ** (sourceLevel - targetLevel);
        scratchContext.imageSmoothingEnabled = true;
        scratchContext.imageSmoothingQuality = "high";
        scratchContext.drawImage(
          source,
          rasterX * scale - parsed.col * DRAW_TILE_SIZE_PX,
          rasterY * scale - parsed.row * DRAW_TILE_SIZE_PX,
          source.width * scale,
          source.height * scale,
        );
        const image = scratchContext.getImageData(0, 0, DRAW_TILE_SIZE_PX, DRAW_TILE_SIZE_PX);
        clipRasterDataToSelection(
          image.data,
          DRAW_TILE_SIZE_PX,
          DRAW_TILE_SIZE_PX,
          parsed.col * DRAW_TILE_SIZE_PX,
          parsed.row * DRAW_TILE_SIZE_PX,
          targetLevel,
          selection,
        );
        scratchContext.putImageData(image, 0, 0);
      }
      const context = tile.getContext("2d");
      if (!context) throw new Error(`Could not paint drawing tile ${key}.`);
      context.save();
      context.globalCompositeOperation = mode;
      context.globalAlpha = opacity;
      context.drawImage(scratch, 0, 0);
      context.restore();
      done.push(key);
    }
  } finally {
    scratch.width = 0;
    scratch.height = 0;
  }
  return done;
}

/** Composite a rasterized stroke/fill into one level's tiles (no cross-level effects) and commit. */
export function paintIntoTiles(
  source: HTMLCanvasElement,
  rasterX: number,
  rasterY: number,
  mode: GlobalCompositeOperation,
  alpha: number,
  level = 0,
): TileKey[] {
  if (!Number.isSafeInteger(rasterX) || !Number.isSafeInteger(rasterY) || source.width < 1 || source.height < 1) return [];
  const opacity = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 0));
  if (opacity === 0) return [];
  const keys = drawingStore.keysInRect(rasterRectToWorld(rasterX, rasterY, source.width, source.height, level), true, level);
  const done = drawTiles(keys, source, rasterX, rasterY, level, mode, opacity);
  drawingStore.commit(done);
  return done;
}

/**
 * Read what the user sees (all levels composited, coarsest first) as a level-L raster rectangle.
 * Fill and selection work on this, so they see the visible drawing at any zoom.
 */
export function readCompositeRect(rasterX: number, rasterY: number, width: number, height: number, level = 0): ImageData {
  validateRasterRect(rasterX, rasterY, width, height);
  const keys = drawingStore.existingKeysInRect(rasterRectToWorld(rasterX, rasterY, width, height, level));
  if (keys.length === 0) return new ImageData(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not read the drawing.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  for (const key of keys) {
    const parsed = parseTileKey(key);
    const tile = drawingStore.tile(key, false);
    if (!parsed || !tile) continue;
    // Tile px → level-L px.
    const scale = 2 ** (parsed.level - level);
    context.drawImage(
      tile,
      parsed.col * DRAW_TILE_SIZE_PX * scale - rasterX,
      parsed.row * DRAW_TILE_SIZE_PX * scale - rasterY,
      DRAW_TILE_SIZE_PX * scale,
      DRAW_TILE_SIZE_PX * scale,
    );
  }
  const image = context.getImageData(0, 0, width, height);
  canvas.width = 0;
  canvas.height = 0;
  return image;
}

/** Read a bounded raster rectangle from one level's tiles; absent tiles are transparent. */
export function readRasterRect(rasterX: number, rasterY: number, width: number, height: number, level = 0): ImageData {
  validateRasterRect(rasterX, rasterY, width, height);
  const output = new ImageData(width, height);
  const colStart = Math.floor(rasterX / DRAW_TILE_SIZE_PX);
  const rowStart = Math.floor(rasterY / DRAW_TILE_SIZE_PX);
  const colEnd = Math.floor((rasterX + width - 1) / DRAW_TILE_SIZE_PX);
  const rowEnd = Math.floor((rasterY + height - 1) / DRAW_TILE_SIZE_PX);
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      const key = tileKey(col, row, level);
      const tile = drawingStore.tile(key, false);
      if (!tile) continue;
      const context = tile.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error(`Could not read drawing tile ${key}.`);
      const left = Math.max(rasterX, col * DRAW_TILE_SIZE_PX);
      const top = Math.max(rasterY, row * DRAW_TILE_SIZE_PX);
      const right = Math.min(rasterX + width, (col + 1) * DRAW_TILE_SIZE_PX);
      const bottom = Math.min(rasterY + height, (row + 1) * DRAW_TILE_SIZE_PX);
      const chunk = context.getImageData(left - col * DRAW_TILE_SIZE_PX, top - row * DRAW_TILE_SIZE_PX, right - left, bottom - top);
      copyRows(chunk.data, chunk.width, chunk.height, output.data, width, left - rasterX, top - rasterY);
    }
  }
  return output;
}

/** Write a raster rectangle across one level's tile boundaries, then prune tiles left transparent. */
export function writeRasterRect(image: ImageData, rasterX: number, rasterY: number, level = 0): TileKey[] {
  validateRasterRect(rasterX, rasterY, image.width, image.height);
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
      const tile = drawingStore.tile(key, true);
      const context = tile?.getContext("2d");
      if (!tile || !context) throw new Error(`Could not write drawing tile ${key}.`);
      const chunk = new ImageData(right - left, bottom - top);
      copyRows(image.data, image.width, bottom - top, chunk.data, chunk.width, 0, 0, left - rasterX, right - left);
      context.putImageData(chunk, left - col * DRAW_TILE_SIZE_PX, top - row * DRAW_TILE_SIZE_PX);
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

function copyRows(
  source: Uint8ClampedArray,
  sourceWidth: number,
  rowCount: number,
  target: Uint8ClampedArray,
  targetWidth: number,
  targetX: number,
  targetY: number,
  sourceX = 0,
  copyWidth = sourceWidth - sourceX,
): void {
  const byteWidth = copyWidth * 4;
  for (let row = 0; row < rowCount; row += 1) {
    const sourceStart = (row * sourceWidth + sourceX) * 4;
    const targetStart = ((targetY + row) * targetWidth + targetX) * 4;
    target.set(source.subarray(sourceStart, sourceStart + byteWidth), targetStart);
  }
}
