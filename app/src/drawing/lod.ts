import type { DrawQuad } from "./gpu/glEngine";
import { tileKeysInRect, tileWorldOrigin } from "./tileStore.svelte";
import { DRAW_MAX_LEVEL, DRAW_TILE_SIZE_PX, levelTileUnits, parseTileKey, type TileKey, type WorldRect } from "./types";

/** One viewport should need at most this many composite tiles at a time. */
export const MAX_COMPOSITE_TARGET_TILES = 64;
/** Leaves twelve of the 96 resident slots for an incremental composite source batch. */
export const MAX_DRAWING_TILES_PER_FRAME = 84;
export const MAX_COARSE_SOURCE_BATCH_SIZE = 12;

export interface DrawingLodPlan {
  targetLevel: number;
  visibleTileUpperBound: number;
  /** Native, coarser levels drawn before the cached target-level composite. */
  fallbackLevels: number[];
  /** Bounded grid of target tiles, including absent tiles that may aggregate finer content. */
  compositeKeys: TileKey[];
}

/** Select a bounded viewport grid and skip finer native levels in the frame renderer. */
export function drawingLodPlan(rect: WorldRect, targetLevel: number, populatedLevels: readonly number[]): DrawingLodPlan {
  let boundedLevel = targetLevel;
  const countFor = (level: number) => tileGridCount(rect, level) + populatedLevels
    .filter((sourceLevel) => sourceLevel > level)
    .reduce((count, sourceLevel) => count + tileGridCount(rect, sourceLevel), 0);
  while ((tileGridCount(rect, boundedLevel) > MAX_COMPOSITE_TARGET_TILES || countFor(boundedLevel) > MAX_DRAWING_TILES_PER_FRAME) && boundedLevel < DRAW_MAX_LEVEL) {
    boundedLevel += 1;
  }
  const compositeKeys = tileKeysInRect(rect, boundedLevel, () => true);
  const visibleTileUpperBound = countFor(boundedLevel);
  return {
    targetLevel: boundedLevel,
    visibleTileUpperBound,
    fallbackLevels: populatedLevels.filter((level) => level > boundedLevel).sort((a, b) => b - a),
    compositeKeys,
  };
}

function tileGridCount(rect: WorldRect, level: number): number {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  if (![rect.x, rect.y, rect.width, rect.height, right, bottom].every(Number.isFinite) || rect.width === 0 || rect.height === 0) return 0;
  const left = Math.min(rect.x, right);
  const top = Math.min(rect.y, bottom);
  const maxX = Math.max(rect.x, right);
  const maxY = Math.max(rect.y, bottom);
  const size = levelTileUnits(level);
  const columns = Math.max(0, Math.ceil(maxX / size) - Math.floor(left / size));
  const rows = Math.max(0, Math.ceil(maxY / size) - Math.floor(top / size));
  return columns * rows;
}

/** Map one source tile into a target tile's raster space for coarse compositing. */
export function compositeSourceQuad(targetKey: TileKey, sourceKey: TileKey, sourceTexture: WebGLTexture): DrawQuad | null {
  const target = parseTileKey(targetKey);
  const source = parseTileKey(sourceKey);
  if (!target || !source || source.level > target.level) return null;
  const targetOrigin = tileWorldOrigin(targetKey);
  const sourceOrigin = tileWorldOrigin(sourceKey);
  if (!targetOrigin || !sourceOrigin) return null;
  const scale = sourceOrigin.size / targetOrigin.size;
  return {
    dst: {
      x: (sourceOrigin.x - targetOrigin.x) / targetOrigin.size * DRAW_TILE_SIZE_PX,
      y: (sourceOrigin.y - targetOrigin.y) / targetOrigin.size * DRAW_TILE_SIZE_PX,
      width: DRAW_TILE_SIZE_PX * scale,
      height: DRAW_TILE_SIZE_PX * scale,
    },
    src: { texture: sourceTexture, width: DRAW_TILE_SIZE_PX, height: DRAW_TILE_SIZE_PX, rect: { x: 0, y: 0, width: DRAW_TILE_SIZE_PX, height: DRAW_TILE_SIZE_PX } },
    mode: "rgba",
    color: [1, 1, 1, 1],
  };
}
