import {
  DRAW_PX_PER_UNIT,
  type BrushSettings,
} from "./types";
export { paintIntoTiles, readRasterRect, writeRasterRect } from "./history";

export interface StrokePoint {
  x: number;
  y: number;
}

export interface FinishedStroke {
  source: HTMLCanvasElement;
  rasterX: number;
  rasterY: number;
}

export interface StrokeRasterRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawStroke {
  add(world: StrokePoint, pressure?: number): void;
  readonly preview: HTMLCanvasElement;
  readonly rasterX: number;
  readonly rasterY: number;
  readonly lastDirtyRect: StrokeRasterRect | null;
  finish(): FinishedStroke | null;
  dispose(): void;
}

/** The diameter is a fixed board width for the duration of the gesture. */
export function brushWorldWidth(size: number, zoom: number): number {
  return size / (10 * safeZoom(zoom));
}

/** Source-over alpha for consecutive pointer-up strokes (opacity is applied once per stroke). */
export function sourceOverAlpha(destinationAlpha: number, maskAlpha: number, opacity: number): number {
  const destinationByte = Number.isFinite(destinationAlpha) ? Math.min(255, Math.max(0, destinationAlpha)) : 0;
  const sourceByte = Number.isFinite(maskAlpha) ? Math.min(255, Math.max(0, maskAlpha)) : 0;
  const sourceOpacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0;
  const destination = destinationByte / 255;
  const source = sourceByte / 255 * sourceOpacity;
  return Math.round((source + destination * (1 - source)) * 255);
}

/** Interpolate a path at no more than `spacing` between samples, including both endpoints. */
export function interpolateStrokePoints(points: readonly StrokePoint[], spacing: number): StrokePoint[] {
  if (points.length === 0) return [];
  const step = Number.isFinite(spacing) && spacing > 0 ? spacing : 1;
  const result: StrokePoint[] = [{ ...points[0] }];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const segments = Math.max(1, Math.ceil(distance / step));
    for (let segment = 1; segment <= segments; segment += 1) {
      const ratio = segment / segments;
      result.push({ x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio });
    }
  }
  return result;
}

/** Max-alpha accumulation makes repeated dabs in one gesture behave like a single pass. */
export function accumulateDabMaxAlpha(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  hardness: number,
): { x: number; y: number; width: number; height: number } | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || mask.length !== width * height) {
    throw new RangeError("Stroke mask dimensions do not match its buffer.");
  }
  if (![centerX, centerY, radius, hardness].every(Number.isFinite) || radius <= 0) return null;

  const left = Math.max(0, Math.floor(centerX - radius - 1));
  const top = Math.max(0, Math.floor(centerY - radius - 1));
  const right = Math.min(width, Math.ceil(centerX + radius + 1));
  const bottom = Math.min(height, Math.ceil(centerY + radius + 1));
  if (right <= left || bottom <= top) return null;

  const hard = Math.min(1, Math.max(0, hardness));
  const coreRadius = radius * hard;
  const edgeWidth = Math.max(radius - coreRadius, 1e-6);
  let changed = false;
  for (let y = top; y < bottom; y += 1) {
    const dy = y + 0.5 - centerY;
    for (let x = left; x < right; x += 1) {
      const distance = Math.hypot(x + 0.5 - centerX, dy);
      if (distance > radius) continue;
      const edge = Math.min(1, Math.max(0, (distance - coreRadius) / edgeWidth));
      const eased = edge * edge * (3 - 2 * edge);
      const alpha = Math.round(255 * (1 - eased));
      const offset = y * width + x;
      if (alpha > mask[offset]) {
        mask[offset] = alpha;
        changed = true;
      }
    }
  }
  return changed ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

/** Create a pressure-aware, max-alpha raster stroke in the drawing raster's 20 px/u space. */
export function createStroke(settings: BrushSettings, zoom: number): DrawStroke {
  const safeSettings = {
    color: /^#[\da-f]{6}$/i.test(settings.color) ? settings.color : "#e8e8e8",
    size: clamp(settings.size, 1, 400, 10),
    opacity: clamp(settings.opacity, 0.05, 1, 1),
    hardness: clamp(settings.hardness, 0, 1, 0.85),
  };
  const baseDiameter = brushWorldWidth(safeSettings.size, zoom) * DRAW_PX_PER_UNIT;
  const preview = document.createElement("canvas");
  let context = preview.getContext("2d");
  if (!context) throw new Error("Could not create a drawing stroke preview.");

  let originX = 0;
  let originY = 0;
  let width = 0;
  let height = 0;
  let mask = new Uint8ClampedArray();
  let pixels: ImageData | null = null;
  let closed = false;
  let previous: StrokePoint | null = null;
  let contentBounds: StrokeRasterRect | null = null;
  let lastDirtyRect: StrokeRasterRect | null = null;
  let bounds: { left: number; top: number; right: number; bottom: number } | null = null;

  function ensureBounds(point: StrokePoint, radius: number): void {
    const nextLeft = Math.floor(point.x - radius - 1);
    const nextTop = Math.floor(point.y - radius - 1);
    const nextRight = Math.ceil(point.x + radius + 1);
    const nextBottom = Math.ceil(point.y + radius + 1);
    const growthMargin = 128;
    if (bounds && nextLeft >= bounds.left + growthMargin && nextTop >= bounds.top + growthMargin &&
      nextRight <= bounds.right - growthMargin && nextBottom <= bounds.bottom - growthMargin) return;
    const horizontalGrowth = bounds ? Math.max(growthMargin, width) : growthMargin;
    const verticalGrowth = bounds ? Math.max(growthMargin, height) : growthMargin;
    const left = bounds ? Math.min(bounds.left, nextLeft - horizontalGrowth) : nextLeft - growthMargin;
    const top = bounds ? Math.min(bounds.top, nextTop - verticalGrowth) : nextTop - growthMargin;
    const right = bounds ? Math.max(bounds.right, nextRight + horizontalGrowth) : nextRight + growthMargin;
    const bottom = bounds ? Math.max(bounds.bottom, nextBottom + verticalGrowth) : nextBottom + growthMargin;

    const nextWidth = right - left;
    const nextHeight = bottom - top;
    if (nextWidth < 1 || nextHeight < 1 || nextWidth > 8192 || nextHeight > 8192 || nextWidth * nextHeight > 16_777_216) {
      throw new RangeError("Drawing stroke is too large to preview.");
    }
    const nextMask = new Uint8ClampedArray(nextWidth * nextHeight);
    if (bounds) {
      const xOffset = bounds.left - left;
      const yOffset = bounds.top - top;
      for (let row = 0; row < height; row += 1) {
        nextMask.set(mask.subarray(row * width, (row + 1) * width), (row + yOffset) * nextWidth + xOffset);
      }
    }
    originX = left;
    originY = top;
    width = nextWidth;
    height = nextHeight;
    mask = nextMask;
    bounds = { left, top, right, bottom };
    preview.width = width;
    preview.height = height;
    context = preview.getContext("2d");
    if (!context) throw new Error("Could not resize a drawing stroke preview.");
    pixels = context.createImageData(width, height);
    colorizeAllPixels();
    context.putImageData(pixels, 0, 0);
  }

  function colorizeAllPixels(): void {
    if (!pixels) return;
    const red = Number.parseInt(safeSettings.color.slice(1, 3), 16);
    const green = Number.parseInt(safeSettings.color.slice(3, 5), 16);
    const blue = Number.parseInt(safeSettings.color.slice(5, 7), 16);
    for (let index = 0, offset = 0; index < mask.length; index += 1, offset += 4) {
      pixels.data[offset] = red;
      pixels.data[offset + 1] = green;
      pixels.data[offset + 2] = blue;
      pixels.data[offset + 3] = mask[index];
    }
  }

  function dab(point: StrokePoint): StrokeRasterRect | null {
    const radius = Math.max(0.5, baseDiameter / 2);
    ensureBounds(point, radius);
    const dirty = accumulateDabMaxAlpha(mask, width, height, point.x - originX, point.y - originY, radius, safeSettings.hardness);
    if (!dirty || !pixels) return null;
    const red = Number.parseInt(safeSettings.color.slice(1, 3), 16);
    const green = Number.parseInt(safeSettings.color.slice(3, 5), 16);
    const blue = Number.parseInt(safeSettings.color.slice(5, 7), 16);
    for (let y = dirty.y; y < dirty.y + dirty.height; y += 1) {
      for (let x = dirty.x; x < dirty.x + dirty.width; x += 1) {
        const pixelOffset = y * width + x;
        const colorOffset = pixelOffset * 4;
        pixels.data[colorOffset] = red;
        pixels.data[colorOffset + 1] = green;
        pixels.data[colorOffset + 2] = blue;
        pixels.data[colorOffset + 3] = mask[pixelOffset];
      }
    }
    return { x: dirty.x + originX, y: dirty.y + originY, width: dirty.width, height: dirty.height };
  }

  function add(world: StrokePoint, _pressure = 0.5): void {
    // Pressure is intentionally ignored in R10.1: the configured screen diameter is fixed per stroke.
    if (closed || !Number.isFinite(world.x) || !Number.isFinite(world.y)) return;
    lastDirtyRect = null;
    const raster = { x: world.x * DRAW_PX_PER_UNIT, y: world.y * DRAW_PX_PER_UNIT };
    if (!previous) {
      lastDirtyRect = dab(raster);
      previous = raster;
    } else {
      const distance = Math.hypot(raster.x - previous.x, raster.y - previous.y);
      // Dense dabs (10% of the diameter) so the edge of a stroke is smooth instead of scalloped.
      const spacing = Math.max(0.5, baseDiameter * 0.1);
      const steps = Math.max(1, Math.ceil(distance / spacing));
      for (let index = 1; index <= steps; index += 1) {
        const ratio = index / steps;
        const changed = dab({ x: previous.x + (raster.x - previous.x) * ratio, y: previous.y + (raster.y - previous.y) * ratio });
        if (changed) lastDirtyRect = unionRects(lastDirtyRect, changed);
      }
      previous = raster;
    }
    if (lastDirtyRect) {
      contentBounds = unionRects(contentBounds, lastDirtyRect);
      const dirtyX = lastDirtyRect.x - originX;
      const dirtyY = lastDirtyRect.y - originY;
      context?.putImageData(pixels!, 0, 0, dirtyX, dirtyY, lastDirtyRect.width, lastDirtyRect.height);
    }
  }

  return {
    add,
    preview,
    get rasterX() { return originX; },
    get rasterY() { return originY; },
    get lastDirtyRect() { return lastDirtyRect; },
    finish() {
      if (closed) return null;
      closed = true;
      if (!contentBounds) return null;
      const source = document.createElement("canvas");
      source.width = contentBounds.width;
      source.height = contentBounds.height;
      const sourceContext = source.getContext("2d");
      if (!sourceContext) throw new Error("Could not crop a drawing stroke.");
      sourceContext.drawImage(
        preview,
        contentBounds.x - originX,
        contentBounds.y - originY,
        contentBounds.width,
        contentBounds.height,
        0,
        0,
        contentBounds.width,
        contentBounds.height,
      );
      return { source, rasterX: contentBounds.x, rasterY: contentBounds.y };
    },
    dispose() {
      closed = true;
      preview.width = 0;
      preview.height = 0;
      mask = new Uint8ClampedArray();
      pixels = null;
      bounds = null;
      contentBounds = null;
      lastDirtyRect = null;
    },
  };
}

function safeZoom(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function unionRects(first: StrokeRasterRect | null, second: StrokeRasterRect): StrokeRasterRect {
  if (!first) return second;
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  return {
    x,
    y,
    width: Math.max(first.x + first.width, second.x + second.width) - x,
    height: Math.max(first.y + first.height, second.y + second.height) - y,
  };
}
