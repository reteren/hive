import { record, type HistoryCommand } from "../history/history.svelte";
import { drawingStore } from "./tileStore.svelte";
import {
  DRAW_PX_PER_UNIT,
  DRAW_TILE_SIZE_PX,
  type TileKey,
  type TileSnapshot,
} from "./types";

export interface DrawingHistoryExtras {
  undo(): void;
  redo(): void;
}

let restoreQueue = Promise.resolve();

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

/** Composite a rasterized stroke/fill into intersecting board tiles and commit them together. */
export function paintIntoTiles(
  source: HTMLCanvasElement,
  rasterX: number,
  rasterY: number,
  mode: GlobalCompositeOperation,
  alpha: number,
): TileKey[] {
  if (!Number.isSafeInteger(rasterX) || !Number.isSafeInteger(rasterY) || source.width < 1 || source.height < 1) return [];
  const opacity = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 0));
  if (opacity === 0) return [];
  const keys = drawingStore.keysInRect({
    x: rasterX / DRAW_PX_PER_UNIT,
    y: rasterY / DRAW_PX_PER_UNIT,
    width: source.width / DRAW_PX_PER_UNIT,
    height: source.height / DRAW_PX_PER_UNIT,
  }, true);
  for (const key of keys) {
    const tile = drawingStore.tile(key, true);
    if (!tile) continue;
    const context = tile.getContext("2d");
    if (!context) throw new Error(`Could not paint drawing tile ${key}.`);
    const [col, row] = key.split(":").map(Number);
    context.globalCompositeOperation = mode;
    context.globalAlpha = opacity;
    context.drawImage(source, rasterX - col * DRAW_TILE_SIZE_PX, rasterY - row * DRAW_TILE_SIZE_PX);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  }
  drawingStore.commit(keys);
  return keys;
}

/** Read a bounded raster rectangle from multiple tiles; absent tiles are transparent. */
export function readRasterRect(rasterX: number, rasterY: number, width: number, height: number): ImageData {
  validateRasterRect(rasterX, rasterY, width, height);
  const output = new ImageData(width, height);
  const colStart = Math.floor(rasterX / DRAW_TILE_SIZE_PX);
  const rowStart = Math.floor(rasterY / DRAW_TILE_SIZE_PX);
  const colEnd = Math.floor((rasterX + width - 1) / DRAW_TILE_SIZE_PX);
  const rowEnd = Math.floor((rasterY + height - 1) / DRAW_TILE_SIZE_PX);
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      const tile = drawingStore.tile(`${col}:${row}`, false);
      if (!tile) continue;
      const context = tile.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error(`Could not read drawing tile ${col}:${row}.`);
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

/** Write a raster rectangle across tile boundaries, then prune any tiles left transparent. */
export function writeRasterRect(image: ImageData, rasterX: number, rasterY: number): TileKey[] {
  validateRasterRect(rasterX, rasterY, image.width, image.height);
  const colStart = Math.floor(rasterX / DRAW_TILE_SIZE_PX);
  const rowStart = Math.floor(rasterY / DRAW_TILE_SIZE_PX);
  const colEnd = Math.floor((rasterX + image.width - 1) / DRAW_TILE_SIZE_PX);
  const rowEnd = Math.floor((rasterY + image.height - 1) / DRAW_TILE_SIZE_PX);
  const changed: TileKey[] = [];
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      const left = Math.max(rasterX, col * DRAW_TILE_SIZE_PX);
      const top = Math.max(rasterY, row * DRAW_TILE_SIZE_PX);
      const right = Math.min(rasterX + image.width, (col + 1) * DRAW_TILE_SIZE_PX);
      const bottom = Math.min(rasterY + image.height, (row + 1) * DRAW_TILE_SIZE_PX);
      const tile = drawingStore.tile(`${col}:${row}`, true);
      const context = tile?.getContext("2d");
      if (!tile || !context) throw new Error(`Could not write drawing tile ${col}:${row}.`);
      const chunk = new ImageData(right - left, bottom - top);
      copyRows(image.data, image.width, bottom - top, chunk.data, chunk.width, 0, 0, left - rasterX);
      context.putImageData(chunk, left - col * DRAW_TILE_SIZE_PX, top - row * DRAW_TILE_SIZE_PX);
      changed.push(`${col}:${row}`);
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
): void {
  const byteWidth = targetWidth * 4;
  for (let row = 0; row < rowCount; row += 1) {
    const sourceStart = (row * sourceWidth + sourceX) * 4;
    const targetStart = ((targetY + row) * targetWidth + targetX) * 4;
    target.set(source.subarray(sourceStart, sourceStart + byteWidth), targetStart);
  }
}
