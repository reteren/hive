import {
  currentDrawLevel,
  levelPxPerUnit,
  type BrushSettings,
} from "./types";
import { requireDrawingGpu, STROKE_SEGMENTS_PER_PASS, type StrokeStateTile } from "./gpu/glEngine";
import type { GpuRasterSource, RasterPiece } from "./history";
export { readRasterRect, writeRasterRect } from "./history";

export interface StrokePoint {
  x: number;
  y: number;
}

export interface FinishedStroke {
  /** The stroke coverage on the GPU, tinted with the brush colour. */
  source: GpuRasterSource;
  rasterX: number;
  rasterY: number;
  width: number;
  height: number;
  /** Pyramid level of the raster coordinates. */
  level: number;
  /** Read the stroke back as a colour × coverage canvas (image erasing needs a CPU mask). */
  toCanvas(): HTMLCanvasElement;
}

/** Input points closer than this (raster px) to the previous one are ignored. */
const MIN_INPUT_STEP = 0.75;
/** Max direction change between neighbouring straight pieces of a smoothed stroke. */
const MAX_TURN_PER_PIECE = (3 * Math.PI) / 180;

/**
 * Samples (after p1, ending exactly at p2) of the centripetal Catmull-Rom curve through p0..p3, dense
 * enough that neighbouring pieces turn by ≤3°. Centripetal parametrisation never loops or overshoots
 * on sharp turns.
 */
export function smoothStrokeSamples(p0: StrokePoint, p1: StrokePoint, p2: StrokePoint, p3: StrokePoint): StrokePoint[] {
  const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (chord === 0) return [{ ...p2 }];
  const inX = p2.x - p0.x;
  const inY = p2.y - p0.y;
  const outX = p3.x - p1.x;
  const outY = p3.y - p1.y;
  const turn = Math.abs(Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY));
  // The tangent can swing past the chord on both ends, hence the factor 2.
  const count = Math.min(256, Math.max(1, Math.ceil((2 * turn) / MAX_TURN_PER_PIECE), Math.ceil(chord / 64)));
  if (count === 1 || !(turn > 1e-4)) return [{ ...p2 }];

  const knot = (a: StrokePoint, b: StrokePoint) => Math.max(1e-3, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const lerp = (a: StrokePoint, b: StrokePoint, ta: number, tb: number, t: number): StrokePoint => {
    const span = tb - ta;
    const u = span > 0 ? (t - ta) / span : 0;
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  };
  const samples: StrokePoint[] = [];
  for (let index = 1; index <= count; index += 1) {
    if (index === count) {
      samples.push({ ...p2 });
      break;
    }
    const t = t1 + (t2 - t1) * (index / count);
    const a1 = lerp(p0, p1, t0, t1, t);
    const a2 = lerp(p1, p2, t1, t2, t);
    const a3 = lerp(p2, p3, t2, t3, t);
    const b1 = lerp(a1, a2, t0, t2, t);
    const b2 = lerp(a2, a3, t1, t3, t);
    const point = lerp(b1, b2, t1, t2, t);
    samples.push(Number.isFinite(point.x) && Number.isFinite(point.y) ? point : lerp(p1, p2, t1, t2, t));
  }
  return samples;
}


export interface StrokeRasterRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawStroke {
  add(world: StrokePoint, pressure?: number): void;
  readonly level: number;
  readonly pixelsPerUnit: number;
  /** Straight 0..1 brush colour. */
  readonly color: [number, number, number];
  /** Raster rect changed by the last add(). */
  readonly lastDirtyRect: StrokeRasterRect | null;
  /** Raster rect of everything drawn so far. */
  readonly bounds: StrokeRasterRect | null;
  /** Live GPU coverage pieces for the on-screen preview (including the provisional tail). */
  pieces(): RasterPiece[];
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

/** Per-pixel state of one stroke: shown alpha = earlier passes ⊕ the current pass. */
export interface StrokeCoverage {
  /** Shown alpha (0..255). */
  value: Uint8ClampedArray;
  /** Alpha of the earlier passes over this pixel. */
  base: Uint8ClampedArray;
  /** Max alpha of the current pass over this pixel. */
  pass: Uint8ClampedArray;
  /** Path length (raster px) at which the stroke last touched this pixel; -Infinity = never. */
  position: Float32Array;
  /** 0 = the current pass merges with the base by max, 255 = composites over it (see below). */
  blend: Uint8ClampedArray;
}

export function createStrokeCoverage(pixels: number): StrokeCoverage {
  const position = new Float32Array(pixels);
  position.fill(Number.NEGATIVE_INFINITY);
  return {
    value: new Uint8ClampedArray(pixels),
    base: new Uint8ClampedArray(pixels),
    pass: new Uint8ClampedArray(pixels),
    position,
    blend: new Uint8ClampedArray(pixels),
  };
}

/**
 * Add the capsule from (ax, ay) to (bx, by) — path length `startLength`..`endLength` — to a stroke.
 *
 * Within one pass over a pixel (touched again less than `passWindow` px of path ago: neighbouring
 * pieces, holding still) alpha is the max, so joints and a resting pointer never build up. When the
 * stroke comes back from further along the path (crossing itself, going back over) the new pass is
 * composited over the earlier ones like paint (a + b·(1 − a)); between `passWindow` and 3× it the two
 * rules are blended smoothly, so a tight V turn shows no seam. Pure max over the whole path left dark
 * creases where a soft stroke crossed itself.
 */
export function accumulateStrokeSegment(
  coverage: StrokeCoverage,
  width: number,
  height: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  startLength: number,
  endLength: number,
  radius: number,
  hardness: number,
  passWindow: number,
): { x: number; y: number; width: number; height: number } | null {
  const { value, base, pass, position, blend } = coverage;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || value.length !== width * height) {
    throw new RangeError("Stroke mask dimensions do not match its buffer.");
  }
  if (![ax, ay, bx, by, startLength, endLength, radius, hardness, passWindow].every(Number.isFinite) || radius <= 0) return null;

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
  const lengthDelta = endLength - startLength;
  let changed = false;
  for (let y = top; y < bottom; y += 1) {
    const py = y + 0.5 - ay;
    for (let x = left; x < right; x += 1) {
      const px = x + 0.5 - ax;
      const t = lengthSquared > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy) / lengthSquared)) : 0;
      const ox = px - t * dx;
      const oy = py - t * dy;
      const distanceSquared = ox * ox + oy * oy;
      if (distanceSquared > radiusSquared) continue;
      let alpha = 255;
      if (distanceSquared > coreSquared) {
        const edge = Math.min(1, Math.max(0, (Math.sqrt(distanceSquared) - coreRadius) / edgeWidth));
        alpha = Math.round(255 * (1 - edge * edge * (3 - 2 * edge)));
        if (alpha === 0) continue;
      }
      const offset = y * width + x;
      const at = startLength + t * lengthDelta;
      const gap = at - position[offset]!;
      if (gap > passWindow) {
        // A new pass over this pixel: fold what is shown into the base.
        const ramp = Math.min(1, (gap - passWindow) / (passWindow * 2));
        base[offset] = value[offset]!;
        pass[offset] = alpha;
        blend[offset] = Math.round(255 * ramp * ramp * (3 - 2 * ramp));
      } else if (alpha > pass[offset]!) {
        pass[offset] = alpha;
      }
      position[offset] = at;
      const below = base[offset]!;
      const current = pass[offset]!;
      const over = below + current * (255 - below) / 255;
      const weight = blend[offset]! / 255;
      const shown = Math.round(Math.max(below, current) * (1 - weight) + over * weight);
      if (shown > value[offset]!) {
        value[offset] = shown;
        changed = true;
      }
    }
  }
  return changed ? { x: left, y: top, width: right - left, height: bottom - top } : null;
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

/** Stroke tiles: the live stroke state is kept in tile-aligned pieces at the working level. */
const STROKE_TILE = 512;

/** Brush geometry in raster px of the stroke level (shared by the shader and the CPU reference). */
export function brushShape(diameter: number, hardness: number): { radius: number; core: number; edge: number; passWindow: number } {
  const radius = Math.max(0.5, diameter / 2);
  const hard = Math.min(1, Math.max(0, hardness));
  // Keep at least a one-pixel antialiased rim, even for a fully hard brush.
  const core = Math.max(0, Math.min(radius * hard, radius - 1));
  // Neighbouring pieces touch a pixel again within ~1 radius of path; a return from further away is
  // another pass (fully composited after ~4.5 radii).
  return { radius, core, edge: Math.max(radius - core, 1e-6), passWindow: Math.max(4, radius * 1.5) };
}

/**
 * Create a soft-brush stroke at a pyramid level (by default the working level for `zoom`). The path
 * is smoothed on the CPU; every pixel is computed by the drawing GPU (gpu/glEngine.ts STROKE_SHADER),
 * one pass per pointer event over just that event's bounding box.
 */
export function createStroke(settings: BrushSettings, zoom: number, level = currentDrawLevel(zoom)): DrawStroke {
  const gpu = requireDrawingGpu();
  const safeSettings = {
    color: /^#[\da-f]{6}$/i.test(settings.color) ? settings.color : "#e8e8e8",
    size: clamp(settings.size, 1, 400, 10),
    opacity: clamp(settings.opacity, 0.05, 1, 1),
    hardness: clamp(settings.hardness, 0, 1, 0.85),
  };
  const pixelsPerUnit = levelPxPerUnit(level);
  const baseDiameter = brushWorldWidth(safeSettings.size, zoom) * pixelsPerUnit;
  const shape = brushShape(baseDiameter, safeSettings.hardness);
  const color: [number, number, number] = [
    Number.parseInt(safeSettings.color.slice(1, 3), 16) / 255,
    Number.parseInt(safeSettings.color.slice(3, 5), 16) / 255,
    Number.parseInt(safeSettings.color.slice(5, 7), 16) / 255,
  ];
  const tiles = new Map<string, { col: number; row: number; state: StrokeStateTile }>();
  /** Path length drawn so far, in raster px. */
  let pathLength = 0;
  let closed = false;
  let contentBounds: StrokeRasterRect | null = null;
  let lastDirtyRect: StrokeRasterRect | null = null;
  /** Segments of the current pointer event: ax, ay, bx, by + start/end path length. */
  let pendingSegments: number[] = [];
  let pendingLengths: number[] = [];
  /** Last raster input points; the curve between the two middle ones is drawn once the next one is known. */
  let inputs: StrokePoint[] = [];

  function segment(from: StrokePoint, to: StrokePoint): void {
    const startLength = pathLength;
    pathLength += Math.hypot(to.x - from.x, to.y - from.y);
    pendingSegments.push(from.x, from.y, to.x, to.y);
    pendingLengths.push(startLength, pathLength);
  }

  /** Straight pieces from `from` through `samples`. */
  function drawThrough(from: StrokePoint, samples: readonly StrokePoint[]): void {
    let start = from;
    for (const target of samples) {
      segment(start, target);
      start = target;
    }
  }

  function tileFor(col: number, row: number): StrokeStateTile {
    const key = `${col}:${row}`;
    let tile = tiles.get(key);
    if (!tile) {
      tile = { col, row, state: gpu.createStrokeState(STROKE_TILE) };
      tiles.set(key, tile);
    }
    return tile.state;
  }

  /** Regions of `next` that hold the live (provisional) tail instead of committed state. */
  let provisional: { state: StrokeStateTile; rect: { x: number; y: number; width: number; height: number } }[] = [];

  function dropProvisional(): void {
    for (const { state, rect } of provisional) gpu.syncStrokeRect(state, rect);
    provisional = [];
  }

  /**
   * Run the pending segments on the GPU over their bounding box. A provisional run (the tail up to
   * the pointer, redrawn on every event) only updates what the preview shows.
   */
  function flushSegments(commit = true): void {
    const count = pendingLengths.length / 2;
    if (count === 0) return;
    if (commit) dropProvisional();
    const segments = pendingSegments;
    const lengths = pendingLengths;
    pendingSegments = [];
    pendingLengths = [];
    const segmentData = new Float32Array(STROKE_SEGMENTS_PER_PASS * 4);
    const lengthData = new Float32Array(STROKE_SEGMENTS_PER_PASS * 2);
    for (let first = 0; first < count; first += STROKE_SEGMENTS_PER_PASS) {
      const n = Math.min(STROKE_SEGMENTS_PER_PASS, count - first);
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (let index = first; index < first + n; index += 1) {
        const o = index * 4;
        left = Math.min(left, segments[o]!, segments[o + 2]!);
        right = Math.max(right, segments[o]!, segments[o + 2]!);
        top = Math.min(top, segments[o + 1]!, segments[o + 3]!);
        bottom = Math.max(bottom, segments[o + 1]!, segments[o + 3]!);
      }
      const box = {
        x: Math.floor(left - shape.radius - 1),
        y: Math.floor(top - shape.radius - 1),
        right: Math.ceil(right + shape.radius + 1),
        bottom: Math.ceil(bottom + shape.radius + 1),
      };
      const dirty = { x: box.x, y: box.y, width: box.right - box.x, height: box.bottom - box.y };
      lastDirtyRect = unionRects(lastDirtyRect, dirty);
      if (commit) contentBounds = unionRects(contentBounds, dirty);
      for (let col = Math.floor(box.x / STROKE_TILE); col <= Math.floor((box.right - 1) / STROKE_TILE); col += 1) {
        for (let row = Math.floor(box.y / STROKE_TILE); row <= Math.floor((box.bottom - 1) / STROKE_TILE); row += 1) {
          const originX = col * STROKE_TILE;
          const originY = row * STROKE_TILE;
          const x0 = Math.max(0, box.x - originX);
          const y0 = Math.max(0, box.y - originY);
          const x1 = Math.min(STROKE_TILE, box.right - originX);
          const y1 = Math.min(STROKE_TILE, box.bottom - originY);
          if (x1 <= x0 || y1 <= y0) continue;
          // Positions relative to the tile keep float precision far from the board origin.
          for (let index = 0; index < n; index += 1) {
            const o = (first + index) * 4;
            segmentData[index * 4] = segments[o]! - originX;
            segmentData[index * 4 + 1] = segments[o + 1]! - originY;
            segmentData[index * 4 + 2] = segments[o + 2]! - originX;
            segmentData[index * 4 + 3] = segments[o + 3]! - originY;
            lengthData[index * 2] = lengths[(first + index) * 2]!;
            lengthData[index * 2 + 1] = lengths[(first + index) * 2 + 1]!;
          }
          const state = tileFor(col, row);
          const rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
          gpu.strokePass(state, { x: 0, y: 0 }, rect, segmentData, lengthData, n, shape, commit);
          if (!commit) provisional.push({ state, rect });
        }
      }
    }
  }

  function add(world: StrokePoint, _pressure = 0.5): void {
    // Pressure is intentionally ignored: the configured screen diameter is fixed per stroke.
    if (closed || !Number.isFinite(world.x) || !Number.isFinite(world.y)) return;
    lastDirtyRect = null;
    const raster = { x: world.x * pixelsPerUnit, y: world.y * pixelsPerUnit };
    const last = inputs.at(-1);
    if (!last) {
      inputs = [raster];
      segment(raster, raster);
    } else {
      // Sub-pixel jitter would only bend the curve's tangents; a resting pointer adds nothing.
      if (Math.hypot(raster.x - last.x, raster.y - last.y) < MIN_INPUT_STEP) return;
      inputs.push(raster);
      // Soft brushes show every corner of a polyline as a crease on its inner side, so the input is
      // drawn as a smooth curve one point behind the pointer (the tail is drawn by finish()).
      if (inputs.length >= 3) {
        const n = inputs.length;
        drawThrough(inputs[n - 3]!, smoothStrokeSamples(inputs[n - 4] ?? inputs[n - 3]!, inputs[n - 3]!, inputs[n - 2]!, inputs[n - 1]!));
        inputs = inputs.slice(-3);
      }
    }
    flushSegments();
    drawProvisionalTail();
  }

  /** Show the stroke right up to the pointer: the last piece, drawn only into the preview buffers. */
  function drawProvisionalTail(): void {
    const n = inputs.length;
    if (n < 2) return;
    const committedLength = pathLength;
    const p2 = inputs[n - 1]!;
    drawThrough(inputs[n - 2]!, smoothStrokeSamples(inputs[n - 3] ?? inputs[n - 2]!, inputs[n - 2]!, p2, p2));
    flushSegments(false);
    pathLength = committedLength;
  }

  /** Draw the last input piece, which waits for a following point while the pointer is down. */
  function drawTail(): void {
    const n = inputs.length;
    if (n < 2) return;
    lastDirtyRect = null;
    const p2 = inputs[n - 1]!;
    drawThrough(inputs[n - 2]!, smoothStrokeSamples(inputs[n - 3] ?? inputs[n - 2]!, inputs[n - 2]!, p2, p2));
    inputs = [p2];
    flushSegments();
  }

  function pieces(preview = false): RasterPiece[] {
    return [...tiles.values()].map(({ col, row, state }) => ({
      texture: preview ? state.next.state : state.current.state,
      texWidth: STROKE_TILE,
      texHeight: STROKE_TILE,
      texRect: { x: 0, y: 0, width: STROKE_TILE, height: STROKE_TILE },
      x: col * STROKE_TILE,
      y: row * STROKE_TILE,
    }));
  }

  return {
    add,
    level,
    pixelsPerUnit,
    color,
    get lastDirtyRect() { return lastDirtyRect; },
    get bounds() { return contentBounds; },
    pieces: () => pieces(true),
    finish() {
      if (closed) return null;
      dropProvisional();
      drawTail();
      closed = true;
      if (!contentBounds) return null;
      const bounds = contentBounds;
      const source: GpuRasterSource = {
        level,
        mode: "mask",
        color,
        pieces: pieces(false),
        bounds,
        prepare(engine) {
          for (const tile of tiles.values()) engine.ensureStrokeMips(tile.state);
        },
      };
      return {
        source,
        rasterX: bounds.x,
        rasterY: bounds.y,
        width: bounds.width,
        height: bounds.height,
        level,
        toCanvas() {
          const canvas = document.createElement("canvas");
          canvas.width = bounds.width;
          canvas.height = bounds.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not read the brush stroke.");
          const image = context.createImageData(bounds.width, bounds.height);
          const red = Math.round(color[0] * 255);
          const green = Math.round(color[1] * 255);
          const blue = Math.round(color[2] * 255);
          for (const { col, row, state } of tiles.values()) {
            const x0 = Math.max(bounds.x, col * STROKE_TILE);
            const y0 = Math.max(bounds.y, row * STROKE_TILE);
            const x1 = Math.min(bounds.x + bounds.width, (col + 1) * STROKE_TILE);
            const y1 = Math.min(bounds.y + bounds.height, (row + 1) * STROKE_TILE);
            if (x1 <= x0 || y1 <= y0) continue;
            const coverage = gpu.readStrokeCoverage(state, { x: x0 - col * STROKE_TILE, y: y0 - row * STROKE_TILE, width: x1 - x0, height: y1 - y0 });
            for (let y = y0; y < y1; y += 1) {
              for (let x = x0; x < x1; x += 1) {
                const offset = ((y - bounds.y) * bounds.width + (x - bounds.x)) * 4;
                image.data[offset] = red;
                image.data[offset + 1] = green;
                image.data[offset + 2] = blue;
                image.data[offset + 3] = coverage[(y - y0) * (x1 - x0) + (x - x0)]!;
              }
            }
          }
          context.putImageData(image, 0, 0);
          return canvas;
        },
      };
    },
    dispose() {
      closed = true;
      for (const tile of tiles.values()) gpu.deleteStrokeState(tile.state);
      tiles.clear();
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
