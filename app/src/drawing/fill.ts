import { DRAW_PX_PER_UNIT, DRAW_TILE_SIZE_PX, type BrushSettings } from "./types";
import { showLinkStatus } from "../links-in-text/contextMenu.svelte";
import { drawingTools } from "./tools.svelte";
import { readRasterRect, writeRasterRect, pushDrawingHistory } from "./history";
import { drawingStore } from "./tileStore.svelte";
import { registerDrawTool } from "./toolRegistry";
import type { DrawPointerEvent, DrawToolHandler } from "./types";

export const DEFAULT_FILL_TOLERANCE = 24;
export const FILL_WINDOW_PIXELS = DRAW_TILE_SIZE_PX * 8;

export interface FloodFillResult {
  status: "filled" | "open" | "empty";
  /** Tight, expanded crop to write back; absent unless status is "filled". */
  image?: { data: Uint8ClampedArray; width: number; height: number; rasterX: number; rasterY: number };
  pixelsChanged: number;
}

interface FillOptions {
  color: string;
  opacity: number;
  tolerance?: number;
  /** Global drawing-raster origin of the supplied window. */
  rasterX?: number;
  rasterY?: number;
}

/** A tile-aligned, bounded raster window centered near the requested global pixel. */
export function fillWindowAt(rasterX: number, rasterY: number): { x: number; y: number; width: number; height: number } {
  const size = FILL_WINDOW_PIXELS;
  const tile = DRAW_TILE_SIZE_PX;
  return {
    x: Math.floor((rasterX - size / 2) / tile) * tile,
    y: Math.floor((rasterY - size / 2) / tile) * tile,
    width: size,
    height: size,
  };
}

/**
 * Find the connected color region in one bounded RGBA raster window, then prepare a small fill crop.
 * For transparent regions, every non-zero-alpha stroke pixel is a boundary, including antialiased
 * edge pixels; this prevents a nearly transparent gap from opening a path to the infinite board.
 */
export function prepareFloodFill(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  options: FillOptions,
): FloodFillResult {
  validatePixels(source, width, height);
  const x = Math.floor(startX);
  const y = Math.floor(startY);
  if (x < 0 || y < 0 || x >= width || y >= height) return { status: "empty", pixelsChanged: 0 };

  const tolerance = Math.max(0, Math.floor(options.tolerance ?? DEFAULT_FILL_TOLERANCE));
  const seedIndex = (y * width + x) * 4;
  const seed = [source[seedIndex]!, source[seedIndex + 1]!, source[seedIndex + 2]!, source[seedIndex + 3]!];
  const alphaSeed = seed[3]!;
  const total = width * height;
  const mask = new Uint8Array(total);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  const matches = (pixel: number): boolean => {
    if (mask[pixel]) return false;
    const offset = pixel * 4;
    const alpha = source[offset + 3]!;
    if (alphaSeed === 0) return alpha === 0;
    return Math.abs(source[offset]! - seed[0]!) <= tolerance &&
      Math.abs(source[offset + 1]! - seed[1]!) <= tolerance &&
      Math.abs(source[offset + 2]! - seed[2]!) <= tolerance &&
      Math.abs(alpha - alphaSeed) <= tolerance;
  };

  const spans: number[] = [y * width + x];
  let pixelsChanged = 0;
  let touchesWindowEdge = false;
  while (spans.length) {
    const index = spans.pop()!;
    const spanY = Math.floor(index / width);
    const spanX = index - spanY * width;
    if (!matches(index)) continue;

    let left = spanX;
    while (left > 0 && matches(spanY * width + left - 1)) left -= 1;
    let right = spanX;
    while (right + 1 < width && matches(spanY * width + right + 1)) right += 1;

    if (spanY === 0 || spanY === height - 1 || left === 0 || right === width - 1) touchesWindowEdge = true;
    minX = Math.min(minX, left);
    minY = Math.min(minY, spanY);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, spanY);
    for (let fillX = left; fillX <= right; fillX += 1) {
      mask[spanY * width + fillX] = 1;
      pixelsChanged += 1;
    }

    enqueueNeighborRuns(spans, mask, source, width, spanY - 1, left, right, seed, alphaSeed, tolerance);
    enqueueNeighborRuns(spans, mask, source, width, spanY + 1, left, right, seed, alphaSeed, tolerance);
  }

  if (touchesWindowEdge) return { status: "open", pixelsChanged: 0 };
  if (pixelsChanged === 0) return { status: "empty", pixelsChanged: 0 };

  const [red, green, blue] = parseFillColor(options.color);
  const opacity = clamp(options.opacity, 0, 1);
  const fillAlpha = Math.round(opacity * 255);
  if (fillAlpha === 0) return { status: "empty", pixelsChanged: 0 };

  // Fill one pixel beneath partially covered boundary pixels. Destination-over preserves the
  // antialiased stroke while removing the transparent seam between the line and the filled region.
  const fringe = new Uint8Array(total);
  const regionLeft = minX;
  const regionTop = minY;
  const regionRight = maxX;
  const regionBottom = maxY;
  for (let py = regionTop; py <= regionBottom; py += 1) {
    for (let px = regionLeft; px <= regionRight; px += 1) {
      const pixel = py * width + px;
      if (!mask[pixel]) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          const alpha = source[neighbor * 4 + 3]!;
          if (!mask[neighbor] && alpha > 0 && alpha < 255 && !fringe[neighbor]) {
            fringe[neighbor] = 1;
            minX = Math.min(minX, nx);
            minY = Math.min(minY, ny);
            maxX = Math.max(maxX, nx);
            maxY = Math.max(maxY, ny);
          }
        }
      }
    }
  }

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const crop = new Uint8ClampedArray(cropWidth * cropHeight * 4);
  for (let row = 0; row < cropHeight; row += 1) {
    const from = ((minY + row) * width + minX) * 4;
    crop.set(source.subarray(from, from + cropWidth * 4), row * cropWidth * 4);
  }
  for (let py = regionTop; py <= regionBottom; py += 1) {
    for (let px = regionLeft; px <= regionRight; px += 1) {
      if (!mask[py * width + px]) continue;
      writeColor(crop, ((py - minY) * cropWidth + px - minX) * 4, red, green, blue, fillAlpha);
    }
  }
  for (let py = Math.max(0, regionTop - 1); py <= Math.min(height - 1, regionBottom + 1); py += 1) {
    for (let px = Math.max(0, regionLeft - 1); px <= Math.min(width - 1, regionRight + 1); px += 1) {
      if (!fringe[py * width + px]) continue;
      destinationOver(crop, ((py - minY) * cropWidth + px - minX) * 4, red, green, blue, fillAlpha);
    }
  }

  return {
    status: "filled",
    image: {
      data: crop,
      width: cropWidth,
      height: cropHeight,
      rasterX: (options.rasterX ?? 0) + minX,
      rasterY: (options.rasterY ?? 0) + minY,
    },
    pixelsChanged,
  };
}

function enqueueNeighborRuns(
  spans: number[],
  mask: Uint8Array,
  source: Uint8ClampedArray,
  width: number,
  y: number,
  left: number,
  right: number,
  seed: readonly number[],
  alphaSeed: number,
  tolerance: number,
): void {
  if (y < 0 || y * width >= mask.length) return;
  const matches = (x: number): boolean => {
    const pixel = y * width + x;
    if (mask[pixel]) return false;
    const offset = pixel * 4;
    const alpha = source[offset + 3]!;
    if (alphaSeed === 0) return alpha === 0;
    return Math.abs(source[offset]! - seed[0]!) <= tolerance &&
      Math.abs(source[offset + 1]! - seed[1]!) <= tolerance &&
      Math.abs(source[offset + 2]! - seed[2]!) <= tolerance &&
      Math.abs(alpha - alphaSeed) <= tolerance;
  };
  let x = left;
  while (x <= right) {
    if (!matches(x)) {
      x += 1;
      continue;
    }
    spans.push(y * width + x);
    do { x += 1; } while (x <= right && matches(x));
  }
}

function validatePixels(data: Uint8ClampedArray, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || data.length !== width * height * 4) {
    throw new RangeError("Flood fill expects a non-empty RGBA pixel buffer.");
  }
}

function parseFillColor(color: string): [number, number, number] {
  const match = /^#([\da-f]{6})$/i.exec(color);
  if (!match) throw new TypeError("Fill colour must be a #rrggbb value.");
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function writeColor(data: Uint8ClampedArray, offset: number, r: number, g: number, b: number, a: number): void {
  data[offset] = r;
  data[offset + 1] = g;
  data[offset + 2] = b;
  data[offset + 3] = a;
}

function destinationOver(data: Uint8ClampedArray, offset: number, r: number, g: number, b: number, fillAlpha: number): void {
  const originalAlpha = data[offset + 3]! / 255;
  const underneathAlpha = (fillAlpha / 255) * (1 - originalAlpha);
  const outputAlpha = originalAlpha + underneathAlpha;
  if (outputAlpha <= 0) return;
  data[offset] = (data[offset]! * originalAlpha + r * underneathAlpha) / outputAlpha;
  data[offset + 1] = (data[offset + 1]! * originalAlpha + g * underneathAlpha) / outputAlpha;
  data[offset + 2] = (data[offset + 2]! * originalAlpha + b * underneathAlpha) / outputAlpha;
  data[offset + 3] = outputAlpha * 255;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

/** Convert a world-space click to global drawing-raster pixels for the fill window. */
export function fillRasterPoint(world: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.floor(world.x * DRAW_PX_PER_UNIT), y: Math.floor(world.y * DRAW_PX_PER_UNIT) };
}

/** Build the RGBA ImageData expected by writeRasterRect without requiring canvas APIs in logic tests. */
export function toImageData(result: NonNullable<FloodFillResult["image"]>): ImageData {
  const image = new ImageData(result.width, result.height);
  image.data.set(result.data);
  return image;
}

export function settingsForFill(settings: BrushSettings): Pick<FillOptions, "color" | "opacity"> {
  return { color: settings.color, opacity: settings.opacity };
}

/** Fill is a click tool; a drag gesture is ignored to avoid accidental bucket actions. */
export function createFillHandler(getSettings: () => BrushSettings = () => drawingTools.brush): DrawToolHandler {
  let pressed: { client: { x: number; y: number }; world: { x: number; y: number }; settings: BrushSettings } | null = null;
  let committing = false;
  const clickThresholdPx = 4;

  function cancel(): void {
    pressed = null;
  }

  return {
    down(event: DrawPointerEvent) {
      if (committing) return;
      pressed = { client: { ...event.client }, world: { ...event.world }, settings: { ...getSettings() } };
    },
    move() {},
    up(event: DrawPointerEvent) {
      const click = pressed;
      pressed = null;
      if (!click || Math.hypot(event.client.x - click.client.x, event.client.y - click.client.y) > clickThresholdPx) return;
      committing = true;
      void fillAt(click.world, click.settings)
        .catch((error: unknown) => showLinkStatus(error instanceof Error ? error.message : String(error)))
        .finally(() => { committing = false; });
    },
    cancel,
    deactivate: cancel,
  };
}

export function registerFillTool(): () => void {
  return registerDrawTool("fill", createFillHandler());
}

export const unregisterFillTool = registerFillTool();

async function fillAt(world: { x: number; y: number }, settings: BrushSettings): Promise<void> {
  const point = fillRasterPoint(world);
  const window = fillWindowAt(point.x, point.y);
  const worldRect = {
    x: window.x / DRAW_PX_PER_UNIT,
    y: window.y / DRAW_PX_PER_UNIT,
    width: window.width / DRAW_PX_PER_UNIT,
    height: window.height / DRAW_PX_PER_UNIT,
  };
  // Empty infinite space is necessarily open; avoid allocating a 4096² buffer when no tile exists.
  if (drawingStore.keysInRect(worldRect, false).length === 0) {
    showLinkStatus("Fill needs a closed shape");
    return;
  }

  const source = readRasterRect(window.x, window.y, window.width, window.height);
  const result = prepareFloodFill(
    source.data,
    source.width,
    source.height,
    point.x - window.x,
    point.y - window.y,
    { ...settingsForFill(settings), rasterX: window.x, rasterY: window.y },
  );
  if (result.status === "open") {
    showLinkStatus("Fill needs a closed shape");
    return;
  }
  if (result.status !== "filled" || !result.image) return;

  const image = result.image;
  const keys = drawingStore.keysInRect({
    x: image.rasterX / DRAW_PX_PER_UNIT,
    y: image.rasterY / DRAW_PX_PER_UNIT,
    width: image.width / DRAW_PX_PER_UNIT,
    height: image.height / DRAW_PX_PER_UNIT,
  }, true);
  if (keys.length === 0) return;
  const before = await drawingStore.snapshot(keys);
  writeRasterRect(toImageData(image), image.rasterX, image.rasterY);
  try {
    const after = await drawingStore.snapshot(keys);
    pushDrawingHistory("Fill", before, after);
  } catch (error) {
    await drawingStore.restore(before);
    throw error;
  }
}
