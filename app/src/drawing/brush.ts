import {
  currentDrawLevel,
  levelPxPerUnit,
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
  /** Pyramid level of the raster coordinates. */
  level: number;
}

/** Stroke raster cap (~2 screens at the working level); a longer stroke is clipped, never an error. */
const MAX_STROKE_SIDE = 8192;
const MAX_STROKE_PIXELS = 16_777_216;

export interface StrokeRasterRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawStroke {
  add(world: StrokePoint, pressure?: number): void;
  /** Live stroke canvas; replaced by a larger one when the stroke grows. */
  readonly preview: HTMLCanvasElement;
  readonly level: number;
  readonly pixelsPerUnit: number;
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

/**
 * Max-alpha "capsule" from (ax, ay) to (bx, by): alpha depends on the distance to the segment, so a
 * stroke is one continuous shape with a smooth soft edge (no ripples from discrete dabs) and repeated
 * passes within one gesture never build up.
 */
export function accumulateSegmentMaxAlpha(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  hardness: number,
): { x: number; y: number; width: number; height: number } | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || mask.length !== width * height) {
    throw new RangeError("Stroke mask dimensions do not match its buffer.");
  }
  if (![ax, ay, bx, by, radius, hardness].every(Number.isFinite) || radius <= 0) return null;

  const left = Math.max(0, Math.floor(Math.min(ax, bx) - radius - 1));
  const top = Math.max(0, Math.floor(Math.min(ay, by) - radius - 1));
  const right = Math.min(width, Math.ceil(Math.max(ax, bx) + radius + 1));
  const bottom = Math.min(height, Math.ceil(Math.max(ay, by) + radius + 1));
  if (right <= left || bottom <= top) return null;

  const hard = Math.min(1, Math.max(0, hardness));
  // Keep at least a one-pixel antialiased rim, even for a fully hard brush.
  const coreRadius = Math.max(0, Math.min(radius * hard, radius - 1));
  const edgeWidth = Math.max(radius - coreRadius, 1e-6);
  const radiusSquared = radius * radius;
  const coreSquared = coreRadius * coreRadius;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let changed = false;
  for (let y = top; y < bottom; y += 1) {
    const py = y + 0.5 - ay;
    for (let x = left; x < right; x += 1) {
      const px = x + 0.5 - ax;
      // Distance to the segment: project onto it and clamp to the end points.
      const t = lengthSquared > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy) / lengthSquared)) : 0;
      const ox = px - t * dx;
      const oy = py - t * dy;
      const distanceSquared = ox * ox + oy * oy;
      if (distanceSquared > radiusSquared) continue;
      const offset = y * width + x;
      if (distanceSquared <= coreSquared) {
        if (mask[offset] !== 255) {
          mask[offset] = 255;
          changed = true;
        }
        continue;
      }
      if (mask[offset] === 255) continue;
      const edge = Math.min(1, Math.max(0, (Math.sqrt(distanceSquared) - coreRadius) / edgeWidth));
      const alpha = Math.round(255 * (1 - edge * edge * (3 - 2 * edge)));
      if (alpha > mask[offset]!) {
        mask[offset] = alpha;
        changed = true;
      }
    }
  }
  return changed ? { x: left, y: top, width: right - left, height: bottom - top } : null;
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
  // Keep at least a one-pixel antialiased rim, even for a fully hard brush.
  const coreRadius = Math.max(0, Math.min(radius * hard, radius - 1));
  const edgeWidth = Math.max(radius - coreRadius, 1e-6);
  let changed = false;
  const radiusSquared = radius * radius;
  const coreSquared = coreRadius * coreRadius;
  for (let y = top; y < bottom; y += 1) {
    const dy = y + 0.5 - centerY;
    const dySquared = dy * dy;
    for (let x = left; x < right; x += 1) {
      const dx = x + 0.5 - centerX;
      const distanceSquared = dx * dx + dySquared;
      if (distanceSquared > radiusSquared) continue;
      const offset = y * width + x;
      if (distanceSquared <= coreSquared) {
        if (mask[offset] !== 255) {
          mask[offset] = 255;
          changed = true;
        }
        continue;
      }
      if (mask[offset] === 255) continue;
      const distance = Math.sqrt(distanceSquared);
      const edge = Math.min(1, Math.max(0, (distance - coreRadius) / edgeWidth));
      const eased = edge * edge * (3 - 2 * edge);
      const alpha = Math.round(255 * (1 - eased));
      if (alpha > mask[offset]) {
        mask[offset] = alpha;
        changed = true;
      }
    }
  }
  return changed ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

/**
 * Create a max-alpha raster stroke at a pyramid level (by default the working level for `zoom`, so
 * the raster is 1.5–3 px per device px and the cost does not depend on how far the board is zoomed out).
 */
export function createStroke(settings: BrushSettings, zoom: number, level = currentDrawLevel(zoom)): DrawStroke {
  const safeSettings = {
    color: /^#[\da-f]{6}$/i.test(settings.color) ? settings.color : "#e8e8e8",
    size: clamp(settings.size, 1, 400, 10),
    opacity: clamp(settings.opacity, 0.05, 1, 1),
    hardness: clamp(settings.hardness, 0, 1, 0.85),
  };
  const pixelsPerUnit = levelPxPerUnit(level);
  const baseDiameter = brushWorldWidth(safeSettings.size, zoom) * pixelsPerUnit;
  const red = Number.parseInt(safeSettings.color.slice(1, 3), 16);
  const green = Number.parseInt(safeSettings.color.slice(3, 5), 16);
  const blue = Number.parseInt(safeSettings.color.slice(5, 7), 16);
  let preview = document.createElement("canvas");
  preview.width = 1;
  preview.height = 1;

  let originX = 0;
  let originY = 0;
  let width = 0;
  let height = 0;
  let mask = new Uint8ClampedArray();
  let closed = false;
  let previous: StrokePoint | null = null;
  let contentBounds: StrokeRasterRect | null = null;
  let lastDirtyRect: StrokeRasterRect | null = null;
  let bounds: { left: number; top: number; right: number; bottom: number } | null = null;

  function fits(w: number, h: number): boolean {
    return w >= 1 && h >= 1 && w <= MAX_STROKE_SIDE && h <= MAX_STROKE_SIDE && w * h <= MAX_STROKE_PIXELS;
  }

  /** Grow the stroke raster to contain a dab. Never throws: past the size cap the dab is clipped. */
  function ensureBounds(point: StrokePoint, radius: number): void {
    const needLeft = Math.floor(point.x - radius - 1);
    const needTop = Math.floor(point.y - radius - 1);
    const needRight = Math.ceil(point.x + radius + 1);
    const needBottom = Math.ceil(point.y + radius + 1);
    if (bounds && needLeft >= bounds.left && needTop >= bounds.top && needRight <= bounds.right && needBottom <= bounds.bottom) return;

    const margin = Math.max(256, Math.ceil(radius * 2));
    const grow = (extra: number) => ({
      left: Math.min(bounds?.left ?? Infinity, needLeft - extra),
      top: Math.min(bounds?.top ?? Infinity, needTop - extra),
      right: Math.max(bounds?.right ?? -Infinity, needRight + extra),
      bottom: Math.max(bounds?.bottom ?? -Infinity, needBottom + extra),
    });
    let next = grow(Math.max(margin, Math.ceil(Math.max(width, height) / 2)));
    if (!fits(next.right - next.left, next.bottom - next.top)) next = grow(0);
    if (!fits(next.right - next.left, next.bottom - next.top)) {
      if (bounds) return;
      // A single dab bigger than the cap: keep the centred part.
      const half = Math.floor(Math.min(MAX_STROKE_SIDE, Math.sqrt(MAX_STROKE_PIXELS)) / 2);
      next = { left: Math.floor(point.x) - half, top: Math.floor(point.y) - half, right: Math.floor(point.x) + half, bottom: Math.floor(point.y) + half };
    }

    const nextWidth = next.right - next.left;
    const nextHeight = next.bottom - next.top;
    const nextMask = new Uint8ClampedArray(nextWidth * nextHeight);
    const nextPreview = document.createElement("canvas");
    nextPreview.width = nextWidth;
    nextPreview.height = nextHeight;
    if (bounds) {
      const xOffset = bounds.left - next.left;
      const yOffset = bounds.top - next.top;
      for (let row = 0; row < height; row += 1) {
        nextMask.set(mask.subarray(row * width, (row + 1) * width), (row + yOffset) * nextWidth + xOffset);
      }
      nextPreview.getContext("2d")?.drawImage(preview, xOffset, yOffset);
      preview.width = 0;
      preview.height = 0;
    }
    originX = next.left;
    originY = next.top;
    width = nextWidth;
    height = nextHeight;
    mask = nextMask;
    preview = nextPreview;
    bounds = next;
  }

  /** One continuous piece of the stroke from `from` to `to` (a dot when they are equal). */
  function segment(from: StrokePoint, to: StrokePoint): StrokeRasterRect | null {
    const radius = Math.max(0.5, baseDiameter / 2);
    ensureBounds(from, radius);
    ensureBounds(to, radius);
    const dirty = accumulateSegmentMaxAlpha(
      mask, width, height,
      from.x - originX, from.y - originY, to.x - originX, to.y - originY,
      radius, safeSettings.hardness,
    );
    return dirty ? { x: dirty.x + originX, y: dirty.y + originY, width: dirty.width, height: dirty.height } : null;
  }

  /** Colour the changed part of the mask into the preview canvas (one putImageData per pointer event). */
  function flush(rect: StrokeRasterRect): void {
    const context = preview.getContext("2d");
    if (!context) return;
    const left = rect.x - originX;
    const top = rect.y - originY;
    const image = context.createImageData(rect.width, rect.height);
    const data = image.data;
    for (let y = 0; y < rect.height; y += 1) {
      let maskOffset = (top + y) * width + left;
      let offset = y * rect.width * 4;
      for (let x = 0; x < rect.width; x += 1, maskOffset += 1, offset += 4) {
        const alpha = mask[maskOffset]!;
        if (alpha === 0) continue;
        data[offset] = red;
        data[offset + 1] = green;
        data[offset + 2] = blue;
        data[offset + 3] = alpha;
      }
    }
    context.putImageData(image, left, top);
  }

  function add(world: StrokePoint, _pressure = 0.5): void {
    // Pressure is intentionally ignored in R10.1: the configured screen diameter is fixed per stroke.
    if (closed || !Number.isFinite(world.x) || !Number.isFinite(world.y)) return;
    lastDirtyRect = null;
    const raster = { x: world.x * pixelsPerUnit, y: world.y * pixelsPerUnit };
    const from = previous ?? raster;
    // Long jumps are split so each piece only scans a small box around itself.
    const pieces = Math.max(1, Math.ceil(Math.hypot(raster.x - from.x, raster.y - from.y) / Math.max(16, baseDiameter)));
    let start = from;
    for (let index = 1; index <= pieces; index += 1) {
      const end = index === pieces ? raster : {
        x: from.x + (raster.x - from.x) * index / pieces,
        y: from.y + (raster.y - from.y) * index / pieces,
      };
      const changed = segment(start, end);
      if (changed) lastDirtyRect = unionRects(lastDirtyRect, changed);
      start = end;
    }
    previous = raster;
    if (lastDirtyRect) {
      contentBounds = unionRects(contentBounds, lastDirtyRect);
      flush(lastDirtyRect);
    }
  }

  return {
    add,
    get preview() { return preview; },
    level,
    pixelsPerUnit,
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
      return { source, rasterX: contentBounds.x, rasterY: contentBounds.y, level };
    },
    dispose() {
      closed = true;
      preview.width = 0;
      preview.height = 0;
      mask = new Uint8ClampedArray();
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
