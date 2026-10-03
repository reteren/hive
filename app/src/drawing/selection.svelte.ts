import { camera, viewport } from "../board/camera.svelte";
import { DRAW_PX_PER_UNIT, type DrawPointerEvent, type DrawTool, type TileKey, type TileSnapshot, type WorldRect, worldToRaster } from "./types";
import { drawingStore } from "./tileStore.svelte";
import { paintIntoTiles, readRasterRect, writeRasterRect } from "./brush";
import { pushDrawingHistory } from "./history";
import { registerDrawTool } from "./toolRegistry";
import { drawingTools } from "./tools.svelte";
import { PX_PER_UNIT, screenToWorld } from "../board/cameraMath";

export type SelectionTool = Extract<DrawTool, "select-rect" | "select-lasso" | "select-polygon">;
export type SelectionHandle = "nw" | "ne" | "sw" | "se";

export interface RasterPoint { x: number; y: number }
export interface PixelBounds { x: number; y: number; width: number; height: number }
export interface RasterPixels extends PixelBounds { data: Uint8ClampedArray }

/** Binary mask over a bounded raster area; selected pixels contain 255. */
export interface DrawingSelectionArea extends PixelBounds {
  tool: SelectionTool;
  mask: Uint8Array;
  outline: RasterPoint[];
}

interface SelectionGesture {
  kind: "shape" | "move";
  tool?: SelectionTool;
  start: RasterPoint;
  last: RasterPoint;
  startClient: { x: number; y: number };
  lastClient: { x: number; y: number };
  points?: RasterPoint[];
  copy?: boolean;
  started?: boolean;
  cancelled?: boolean;
  didCut?: boolean;
  pending?: Promise<void>;
  prepared?: Promise<PreparedMove>;
  completion?: Promise<void>;
}

interface PreparedMove {
  area: DrawingSelectionArea;
  sourceKeys: TileKey[];
  before: TileSnapshot;
  selected: RasterPixels;
  remainder: RasterPixels;
}

interface ClipboardPixels extends RasterPixels {
  mask: Uint8Array;
}

const DRAG_THRESHOLD_PX = 4;
const MIN_PATH_STEP_RASTER_PX = 2;
const MAX_SELECTION_DIMENSION = 4096;
const MAX_SELECTION_PIXELS = 16_777_216;
const SELECTION_TOOLS: readonly SelectionTool[] = ["select-rect", "select-lasso", "select-polygon"];

export const drawingSelection = $state({
  area: null as DrawingSelectionArea | null,
  preview: null as { tool: SelectionTool; points: RasterPoint[] } | null,
  floating: null as RasterPixels | null,
  floatingAt: null as RasterPoint | null,
  revision: 0,
});

let activeGesture: SelectionGesture | null = null;
let clipboard: ClipboardPixels | null = null;
let cursorRaster: RasterPoint | null = null;

/** Rasterize a rectangle, lasso, or polygon without depending on canvas APIs. */
export function buildSelectionArea(tool: SelectionTool, points: readonly RasterPoint[]): DrawingSelectionArea | null {
  if (tool === "select-rect") {
    if (points.length < 2) return null;
    const x0 = Math.floor(Math.min(points[0]!.x, points.at(-1)!.x));
    const y0 = Math.floor(Math.min(points[0]!.y, points.at(-1)!.y));
    const x1 = Math.max(x0 + 1, Math.ceil(Math.max(points[0]!.x, points.at(-1)!.x)));
    const y1 = Math.max(y0 + 1, Math.ceil(Math.max(points[0]!.y, points.at(-1)!.y)));
    if (![x0, y0, x1, y1].every(Number.isSafeInteger)) return null;
    const width = x1 - x0;
    const height = y1 - y0;
    if (!selectionSizeIsSafe(width, height)) return null;
    const mask = new Uint8Array(width * height);
    mask.fill(255);
    return {
      x: x0,
      y: y0,
      width,
      height,
      tool,
      mask,
      outline: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
    };
  }

  const cleanPoints = compactPath(points);
  if (cleanPoints.length < 3) return null;
  const bounds = boundsForPoints(cleanPoints);
  if (!bounds) return null;
  const mask = rasterizePolygonMask(bounds, cleanPoints);
  if (!mask.some((value) => value !== 0)) return null;
  return { ...bounds, tool, mask, outline: cleanPoints };
}

export function selectionContains(area: DrawingSelectionArea, point: RasterPoint): boolean {
  const x = Math.floor(point.x) - area.x;
  const y = Math.floor(point.y) - area.y;
  return x >= 0 && y >= 0 && x < area.width && y < area.height && area.mask[y * area.width + x] !== 0;
}

/** Resize the selection geometry only. The drawing pixels remain at their original coordinates. */
export function resizeSelectionArea(
  area: DrawingSelectionArea,
  handle: SelectionHandle,
  point: RasterPoint,
): DrawingSelectionArea {
  let left = area.x;
  let top = area.y;
  let right = area.x + area.width;
  let bottom = area.y + area.height;
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  if (handle.includes("w")) left = Math.min(x, right - 1);
  else right = Math.max(x, left + 1);
  if (handle.includes("n")) top = Math.min(y, bottom - 1);
  else bottom = Math.max(y, top + 1);

  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
  if (!selectionSizeIsSafe(bounds.width, bounds.height)) return area;
  const mask = new Uint8Array(bounds.width * bounds.height);
  for (let targetY = 0; targetY < bounds.height; targetY += 1) {
    const sourceY = Math.min(area.height - 1, Math.floor((targetY + 0.5) * area.height / bounds.height));
    for (let targetX = 0; targetX < bounds.width; targetX += 1) {
      const sourceX = Math.min(area.width - 1, Math.floor((targetX + 0.5) * area.width / bounds.width));
      mask[targetY * bounds.width + targetX] = area.mask[sourceY * area.width + sourceX] ?? 0;
    }
  }
  if (area.tool === "select-rect") mask.fill(255);
  const scaleX = bounds.width / area.width;
  const scaleY = bounds.height / area.height;
  return {
    ...bounds,
    tool: area.tool,
    mask,
    outline: area.outline.map((item) => ({
      x: bounds.x + (item.x - area.x) * scaleX,
      y: bounds.y + (item.y - area.y) * scaleY,
    })),
  };
}

/** Split a raster rectangle into selected and remaining pixels, respecting mask coverage. */
export function splitPixelsByMask(
  source: RasterPixels,
  mask: Uint8Array,
): { selected: RasterPixels; remainder: RasterPixels } {
  const selected = new Uint8ClampedArray(source.data.length);
  const remainder = new Uint8ClampedArray(source.data.length);
  const pixelCount = Math.min(mask.length, source.width * source.height);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const coverage = (mask[pixel] ?? 0) / 255;
    const alpha = source.data[offset + 3] ?? 0;
    if (coverage <= 0) {
      remainder.set(source.data.subarray(offset, offset + 4), offset);
      continue;
    }
    if (alpha <= 0) continue;
    selected[offset] = source.data[offset] ?? 0;
    selected[offset + 1] = source.data[offset + 1] ?? 0;
    selected[offset + 2] = source.data[offset + 2] ?? 0;
    selected[offset + 3] = Math.round(alpha * coverage);
    const remainderAlpha = Math.round(alpha * (1 - coverage));
    if (remainderAlpha > 0) {
      remainder[offset] = source.data[offset] ?? 0;
      remainder[offset + 1] = source.data[offset + 1] ?? 0;
      remainder[offset + 2] = source.data[offset + 2] ?? 0;
      remainder[offset + 3] = remainderAlpha;
    }
  }
  for (let pixel = pixelCount; pixel < source.width * source.height; pixel += 1) {
    const offset = pixel * 4;
    remainder.set(source.data.subarray(offset, offset + 4), offset);
  }
  return {
    selected: { x: source.x, y: source.y, width: source.width, height: source.height, data: selected },
    remainder: { x: source.x, y: source.y, width: source.width, height: source.height, data: remainder },
  };
}

export function deleteSelectionPixels(source: RasterPixels, mask: Uint8Array): RasterPixels {
  return splitPixelsByMask(source, mask).remainder;
}

export function copySelectionPixels(source: RasterPixels, mask: Uint8Array): RasterPixels {
  return splitPixelsByMask(source, mask).selected;
}

/** Pure move/copy model used by tests; unselected pixels stay at their original coordinates. */
export function moveSelectionPixels(
  source: RasterPixels,
  mask: Uint8Array,
  deltaX: number,
  deltaY: number,
  copy = false,
): RasterPixels {
  const dx = Math.trunc(deltaX);
  const dy = Math.trunc(deltaY);
  const x = Math.min(source.x, source.x + dx);
  const y = Math.min(source.y, source.y + dy);
  const right = Math.max(source.x + source.width, source.x + dx + source.width);
  const bottom = Math.max(source.y + source.height, source.y + dy + source.height);
  const output: RasterPixels = {
    x,
    y,
    width: right - x,
    height: bottom - y,
    data: new Uint8ClampedArray((right - x) * (bottom - y) * 4),
  };
  const selected = splitPixelsByMask(source, mask).selected;
  if (copy) copyPixels(source, output, source.x, source.y, false);
  else {
    const remainder = deleteSelectionPixels(source, mask);
    copyPixels(remainder, output, remainder.x, remainder.y, false);
  }
  copyPixels(selected, output, selected.x + dx, selected.y + dy, true);
  return output;
}

function copyPixels(source: RasterPixels, target: RasterPixels, targetX: number, targetY: number, sourceOver: boolean): void {
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceOffset = (y * source.width + x) * 4;
      const sourceAlpha = (source.data[sourceOffset + 3] ?? 0) / 255;
      if (sourceAlpha <= 0) continue;
      const worldX = targetX + x;
      const worldY = targetY + y;
      const targetLocalX = worldX - target.x;
      const targetLocalY = worldY - target.y;
      if (targetLocalX < 0 || targetLocalY < 0 || targetLocalX >= target.width || targetLocalY >= target.height) continue;
      const targetOffset = (targetLocalY * target.width + targetLocalX) * 4;
      if (!sourceOver) {
        target.data.set(source.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
        continue;
      }
      const destinationAlpha = (target.data[targetOffset + 3] ?? 0) / 255;
      const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      if (outAlpha <= 0) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        target.data[targetOffset + channel] = Math.round(
          ((source.data[sourceOffset + channel] ?? 0) * sourceAlpha +
            (target.data[targetOffset + channel] ?? 0) * destinationAlpha * (1 - sourceAlpha)) / outAlpha,
        );
      }
      target.data[targetOffset + 3] = Math.round(outAlpha * 255);
    }
  }
}

function compactPath(points: readonly RasterPoint[]): RasterPoint[] {
  const output: RasterPoint[] = [];
  for (const point of points) {
    const previous = output.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= MIN_PATH_STEP_RASTER_PX) {
      output.push({ x: point.x, y: point.y });
    }
  }
  return output;
}

function boundsForPoints(points: readonly RasterPoint[]): PixelBounds | null {
  if (points.length < 3) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite) ||
    Math.max(Math.abs(minX), Math.abs(minY), Math.abs(maxX), Math.abs(maxY)) > Number.MAX_SAFE_INTEGER) return null;
  const left = Math.floor(minX);
  const top = Math.floor(minY);
  const right = Math.ceil(maxX);
  const bottom = Math.ceil(maxY);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  if (!selectionSizeIsSafe(width, height)) return null;
  return { x: left, y: top, width, height };
}

function rasterizePolygonMask(bounds: PixelBounds, points: readonly RasterPoint[]): Uint8Array {
  const mask = new Uint8Array(bounds.width * bounds.height);
  const intersections: number[] = [];
  for (let y = 0; y < bounds.height; y += 1) {
    const scanY = bounds.y + y + 0.5;
    intersections.length = 0;
    for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
      const a = points[previous]!;
      const b = points[index]!;
      if ((a.y > scanY) === (b.y > scanY)) continue;
      intersections.push(a.x + ((scanY - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const first = Math.max(0, Math.ceil(intersections[index]! - bounds.x - 0.5));
      const last = Math.min(bounds.width, Math.ceil(intersections[index + 1]! - bounds.x - 0.5));
      if (last > first) mask.fill(255, y * bounds.width + first, y * bounds.width + last);
    }
  }
  return mask;
}

function selectionSizeIsSafe(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 &&
    width <= MAX_SELECTION_DIMENSION && height <= MAX_SELECTION_DIMENSION && width * height <= MAX_SELECTION_PIXELS;
}

function readPoint(event: DrawPointerEvent): RasterPoint {
  const point = worldToRaster(event.world.x, event.world.y);
  return { x: point.px, y: point.py };
}

function keysForArea(area: PixelBounds): TileKey[] {
  const rect: WorldRect = {
    x: area.x / DRAW_PX_PER_UNIT,
    y: area.y / DRAW_PX_PER_UNIT,
    width: area.width / DRAW_PX_PER_UNIT,
    height: area.height / DRAW_PX_PER_UNIT,
  };
  return drawingStore.keysInRect(rect, true);
}

function imageDataFromPixels(pixels: RasterPixels): ImageData {
  return new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
}

function canvasFromPixels(pixels: RasterPixels): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create a drawing selection canvas.");
  context.putImageData(imageDataFromPixels(pixels), 0, 0);
  return canvas;
}

function hasVisiblePixels(pixels: RasterPixels): boolean {
  for (let index = 3; index < pixels.data.length; index += 4) {
    if (pixels.data[index] !== 0) return true;
  }
  return false;
}

function updateState(): void {
  drawingSelection.revision += 1;
}

function updateCursor(event: DrawPointerEvent): void {
  cursorRaster = readPoint(event);
}

function selectPixels(tool: SelectionTool, points: readonly RasterPoint[]): void {
  const area = buildSelectionArea(tool, points);
  drawingSelection.preview = null;
  if (!area) return;
  drawingSelection.area = area;
  drawingSelection.floating = null;
  drawingSelection.floatingAt = null;
  updateState();
}

function appendDistinct(points: readonly RasterPoint[], next: RasterPoint): RasterPoint[] {
  const previous = points.at(-1);
  if (previous && Math.hypot(previous.x - next.x, previous.y - next.y) < MIN_PATH_STEP_RASTER_PX) return [...points];
  return [...points, next];
}

function prepareMove(area: DrawingSelectionArea): Promise<PreparedMove> {
  const sourceKeys = keysForArea(area);
  const source: RasterPixels = {
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    data: new Uint8ClampedArray(readRasterRect(area.x, area.y, area.width, area.height).data),
  };
  const split = splitPixelsByMask(source, area.mask);
  return drawingStore.snapshot(sourceKeys).then((before) => ({
    area,
    sourceKeys,
    before,
    selected: split.selected,
    remainder: split.remainder,
  }));
}

function beginMove(event: DrawPointerEvent): void {
  const area = drawingSelection.area;
  if (!area) return;
  const point = readPoint(event);
  let prepared: Promise<PreparedMove>;
  try {
    prepared = prepareMove(area);
  } catch (error) {
    console.error("Could not read the drawing selection", error);
    return;
  }
  void prepared.catch((error: unknown) => console.error("Could not snapshot the drawing selection", error));
  activeGesture = {
    kind: "move",
    start: point,
    last: point,
    startClient: { ...event.client },
    lastClient: { ...event.client },
    copy: event.ctrl,
    prepared,
  };
}

function startFloating(gesture: SelectionGesture): void {
  const preparation = gesture.prepared;
  if (!preparation) {
    gesture.started = false;
    return;
  }
  gesture.pending = preparation.then(async (prepared) => {
    if (gesture.cancelled || activeGesture !== gesture || !gesture.started) return;
    if (!hasVisiblePixels(prepared.selected)) {
      gesture.started = false;
      return;
    }
    let cutAttempted = false;
    try {
      if (!gesture.copy) {
        cutAttempted = true;
        const changed = writeRasterRect(imageDataFromPixels(prepared.remainder), prepared.area.x, prepared.area.y);
        drawingStore.commit([...new Set([...prepared.sourceKeys, ...changed])]);
        gesture.didCut = true;
      }
      drawingSelection.floating = prepared.selected;
      drawingSelection.floatingAt = { x: prepared.area.x, y: prepared.area.y };
      updateState();
    } catch (error) {
      if (cutAttempted) {
        await drawingStore.restore(prepared.before).catch((restoreError: unknown) => {
          console.error("Could not roll back a drawing selection cut", restoreError);
        });
        gesture.didCut = false;
      }
      throw error;
    }
  }).catch((error: unknown) => {
    gesture.started = false;
    drawingSelection.floating = null;
    drawingSelection.floatingAt = null;
    updateState();
    console.error("Could not prepare a drawing selection move", error);
  });
}

async function finishMove(gesture: SelectionGesture): Promise<void> {
  let prepared: PreparedMove | null = null;
  let rollback: TileSnapshot | null = null;
  let mutationStarted = false;
  try {
    await gesture.pending;
    if (gesture.cancelled || !gesture.started || !gesture.prepared) return;
    prepared = await gesture.prepared;
    if (!hasVisiblePixels(prepared.selected)) return;
    const deltaX = Math.round(gesture.last.x - gesture.start.x);
    const deltaY = Math.round(gesture.last.y - gesture.start.y);
    rollback = new Map(prepared.before);
    mutationStarted = gesture.didCut === true;
    if (deltaX === 0 && deltaY === 0) {
      if (gesture.didCut) await drawingStore.restore(prepared.before);
      mutationStarted = false;
      return;
    }

    const destination = {
      x: prepared.area.x + deltaX,
      y: prepared.area.y + deltaY,
      width: prepared.area.width,
      height: prepared.area.height,
    };
    const destinationKeys = keysForArea(destination);
    if (destinationKeys.length === 0) {
      if (gesture.didCut) await drawingStore.restore(prepared.before);
      mutationStarted = false;
      return;
    }
    const destinationBefore = await drawingStore.snapshot(destinationKeys);
    for (const [key, blob] of destinationBefore) if (!rollback.has(key)) rollback.set(key, blob);

    const canvas = canvasFromPixels(prepared.selected);
    let painted: TileKey[] = [];
    mutationStarted = true;
    try {
      painted = paintIntoTiles(canvas, destination.x, destination.y, "source-over", 1);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
    const changedKeys = [...new Set([...prepared.sourceKeys, ...destinationKeys, ...painted])];
    drawingStore.commit(changedKeys);
    const after = await drawingStore.snapshot(changedKeys);
    pushDrawingHistory(gesture.copy ? "Copy selection" : "Move selection", rollback, after);

    drawingSelection.area = {
      ...prepared.area,
      x: destination.x,
      y: destination.y,
      outline: prepared.area.outline.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY })),
    };
  } catch (error) {
    if (mutationStarted && rollback) {
      await drawingStore.restore(rollback).catch((restoreError: unknown) => {
        console.error("Could not roll back a drawing selection move", restoreError);
      });
    } else if (gesture.didCut && prepared) {
      await drawingStore.restore(prepared.before).catch((restoreError: unknown) => {
        console.error("Could not restore a drawing selection cut", restoreError);
      });
    }
    console.error("Could not finish a drawing selection move", error);
  } finally {
    drawingSelection.floating = null;
    drawingSelection.floatingAt = null;
    updateState();
    if (activeGesture === gesture) activeGesture = null;
  }
}

function commitMove(gesture: SelectionGesture): Promise<void> {
  if (gesture.completion) return gesture.completion;
  gesture.completion = finishMove(gesture);
  return gesture.completion;
}

async function cancelMove(gesture: SelectionGesture): Promise<void> {
  gesture.cancelled = true;
  try {
    await gesture.pending;
    if (gesture.prepared) {
      const prepared = await gesture.prepared;
      if (gesture.didCut) await drawingStore.restore(prepared.before);
    }
  } catch (error) {
    console.error("Could not cancel a drawing selection move", error);
  } finally {
    drawingSelection.floating = null;
    drawingSelection.floatingAt = null;
    updateState();
    if (activeGesture === gesture) activeGesture = null;
  }
}

async function deleteCurrentSelection(): Promise<void> {
  const area = drawingSelection.area;
  if (!area) return;
  const keys = keysForArea(area);
  if (keys.length === 0) return;
  let before: TileSnapshot | null = null;
  let mutationStarted = false;
  try {
    before = await drawingStore.snapshot(keys);
    const source: RasterPixels = {
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      data: new Uint8ClampedArray(readRasterRect(area.x, area.y, area.width, area.height).data),
    };
    const selected = copySelectionPixels(source, area.mask);
    if (!hasVisiblePixels(selected)) {
      clearSelection();
      return;
    }
    mutationStarted = true;
    const remainder = deleteSelectionPixels(source, area.mask);
    const changed = writeRasterRect(imageDataFromPixels(remainder), area.x, area.y);
    drawingStore.commit([...new Set([...keys, ...changed])]);
    const after = await drawingStore.snapshot(keys);
    pushDrawingHistory("Delete selection", before, after);
    clearSelection();
  } catch (error) {
    if (mutationStarted && before) {
      await drawingStore.restore(before).catch((restoreError: unknown) => {
        console.error("Could not roll back a drawing selection delete", restoreError);
      });
    }
    console.error("Could not delete the drawing selection", error);
  }
}

function copyCurrentSelection(): void {
  const area = drawingSelection.area;
  if (!area) return;
  try {
    const source: RasterPixels = {
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      data: new Uint8ClampedArray(readRasterRect(area.x, area.y, area.width, area.height).data),
    };
    const selected = copySelectionPixels(source, area.mask);
    if (!hasVisiblePixels(selected)) return;
    clipboard = { ...selected, mask: new Uint8Array(area.mask) };
  } catch (error) {
    console.error("Could not copy the drawing selection", error);
  }
}

async function pasteClipboard(point: RasterPoint | null): Promise<void> {
  if (!clipboard || !point) return;
  const targetX = Math.floor(point.x);
  const targetY = Math.floor(point.y);
  const pixels = { ...clipboard, x: targetX, y: targetY };
  const keys = keysForArea(pixels);
  if (keys.length === 0) return;
  let before: TileSnapshot | null = null;
  let mutationStarted = false;
  try {
    before = await drawingStore.snapshot(keys);
    const canvas = canvasFromPixels(pixels);
    let painted: TileKey[] = [];
    mutationStarted = true;
    try {
      painted = paintIntoTiles(canvas, targetX, targetY, "source-over", 1);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
    const changed = [...new Set([...keys, ...painted])];
    drawingStore.commit(changed);
    const after = await drawingStore.snapshot(changed);
    pushDrawingHistory("Paste selection", before, after);
    drawingSelection.area = {
      x: targetX,
      y: targetY,
      width: pixels.width,
      height: pixels.height,
      tool: "select-rect",
      mask: new Uint8Array(clipboard.mask),
      outline: [
        { x: targetX, y: targetY },
        { x: targetX + pixels.width, y: targetY },
        { x: targetX + pixels.width, y: targetY + pixels.height },
        { x: targetX, y: targetY + pixels.height },
      ],
    };
    updateState();
  } catch (error) {
    if (mutationStarted && before) {
      await drawingStore.restore(before).catch((restoreError: unknown) => {
        console.error("Could not roll back a drawing selection paste", restoreError);
      });
    }
    console.error("Could not paste the drawing selection", error);
  }
}

function clearSelection(): void {
  drawingSelection.area = null;
  drawingSelection.preview = null;
  drawingSelection.floating = null;
  drawingSelection.floatingAt = null;
  updateState();
}

function addPolygonPoint(gestureTool: SelectionTool, event: DrawPointerEvent): void {
  const point = readPoint(event);
  const previous = drawingSelection.preview;
  const points = previous?.tool === gestureTool ? appendDistinct(previous.points, point) : [point];
  drawingSelection.preview = { tool: gestureTool, points };
  cursorRaster = point;
  if (event.detail >= 2) void selectPixels("select-polygon", points);
  updateState();
}

function createHandler(tool: SelectionTool) {
  return {
    down(event: DrawPointerEvent) {
      if (activeGesture?.completion) return;
      cursorRaster = readPoint(event);
      const area = drawingSelection.area;
      if (area) {
        if (selectionContains(area, cursorRaster)) {
          beginMove(event);
        } else {
          clearSelection();
        }
        return;
      }
      if (tool === "select-polygon" && drawingSelection.preview?.tool === "select-polygon") {
        addPolygonPoint(tool, event);
        return;
      }
      if (tool === "select-polygon") {
        addPolygonPoint(tool, event);
        return;
      }
      const point = readPoint(event);
      activeGesture = {
        kind: "shape",
        tool,
        start: point,
        last: point,
        startClient: { ...event.client },
        lastClient: { ...event.client },
        points: [point],
      };
      drawingSelection.preview = { tool, points: [point] };
      updateState();
    },
    move(event: DrawPointerEvent) {
      cursorRaster = readPoint(event);
      const gesture = activeGesture;
      if (!gesture || gesture.completion) return;
      gesture.last = readPoint(event);
      gesture.lastClient = { ...event.client };
      if (gesture.kind === "move") {
        if (!gesture.started && Math.hypot(
          gesture.lastClient.x - gesture.startClient.x,
          gesture.lastClient.y - gesture.startClient.y,
        ) >= DRAG_THRESHOLD_PX) {
          gesture.started = true;
          startFloating(gesture);
        }
        const area = drawingSelection.area;
        if (gesture.started && area) {
          drawingSelection.floatingAt = {
            x: area.x + Math.round(gesture.last.x - gesture.start.x),
            y: area.y + Math.round(gesture.last.y - gesture.start.y),
          };
          updateState();
        }
        return;
      }

      const points = gesture.tool === "select-rect"
        ? [gesture.start, gesture.last]
        : appendDistinct(gesture.points ?? [], gesture.last);
      gesture.points = points;
      drawingSelection.preview = { tool: gesture.tool!, points };
      updateState();
    },
    up(event: DrawPointerEvent) {
      const gesture = activeGesture;
      if (!gesture || gesture.completion) return;
      gesture.last = readPoint(event);
      if (gesture.kind === "move") {
        if (gesture.started) void commitMove(gesture);
        else activeGesture = null;
        return;
      }
      activeGesture = null;
      void selectPixels(gesture.tool!, gesture.tool === "select-rect"
        ? [gesture.start, gesture.last]
        : appendDistinct(gesture.points ?? [], gesture.last));
    },
    cancel() {
      const gesture = activeGesture;
      if (gesture?.completion) return;
      if (gesture?.kind === "move") void cancelMove(gesture);
      else {
        activeGesture = null;
        drawingSelection.preview = null;
        updateState();
      }
    },
    key(event: KeyboardEvent): boolean {
      if (event.defaultPrevented || event.isComposing) return false;
      if (event.repeat) return false;
      if (event.key === "Escape") {
        if (drawingSelection.preview?.tool === "select-polygon") {
          drawingSelection.preview = null;
          updateState();
          return true;
        }
        const gesture = activeGesture;
        if (gesture?.kind === "move" && gesture.started) {
          void commitMove(gesture).finally(clearSelection);
          return true;
        }
        if (gesture?.kind === "move") {
          void cancelMove(gesture).finally(clearSelection);
          return true;
        }
        const hadState = Boolean(gesture || drawingSelection.area || drawingSelection.preview);
        if (gesture) {
          activeGesture = null;
          drawingSelection.preview = null;
          updateState();
        }
        clearSelection();
        // Nothing to drop: let Esc leave draw mode.
        return hadState;
      }
      if (activeGesture?.completion) return false;
      if (event.key === "Enter" && drawingSelection.preview?.tool === "select-polygon") {
        void selectPixels("select-polygon", drawingSelection.preview.points);
        return true;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!drawingSelection.area) return false;
        void deleteCurrentSelection();
        return true;
      }
      if (event.ctrlKey && event.code === "KeyC") {
        if (!drawingSelection.area) return false;
        void copyCurrentSelection();
        return true;
      }
      if (event.ctrlKey && event.code === "KeyV") {
        if (!clipboard) return false;
        void pasteClipboard(cursorRaster);
        return true;
      }
      return false;
    },
    deactivate() {
      const gesture = activeGesture;
      if (gesture?.kind === "move" && gesture.started) void commitMove(gesture);
      else if (gesture) {
        activeGesture = null;
        drawingSelection.preview = null;
        updateState();
      }
    },
  };
}

for (const tool of SELECTION_TOOLS) registerDrawTool(tool, createHandler(tool));

function rasterFromClient(clientX: number, clientY: number): RasterPoint | null {
  const board = document.querySelector<HTMLElement>(".board");
  if (!board) return null;
  const bounds = board.getBoundingClientRect();
  const world = screenToWorld(camera, viewport, { x: clientX - bounds.left, y: clientY - bounds.top });
  const point = worldToRaster(world.x, world.y);
  return { x: point.px, y: point.py };
}

if (typeof window !== "undefined") {
  window.addEventListener("pointermove", (event) => {
    if (!SELECTION_TOOLS.includes(drawingTools.active as SelectionTool)) return;
    const point = rasterFromClient(event.clientX, event.clientY);
    if (point) cursorRaster = point;
  }, true);
}

export function selectionAreaWorldRect(area: PixelBounds): WorldRect {
  return {
    x: area.x / DRAW_PX_PER_UNIT,
    y: area.y / DRAW_PX_PER_UNIT,
    width: area.width / DRAW_PX_PER_UNIT,
    height: area.height / DRAW_PX_PER_UNIT,
  };
}

export function selectionBoundsWorldPixels(area: PixelBounds): { left: number; top: number; width: number; height: number } {
  const ratio = PX_PER_UNIT / DRAW_PX_PER_UNIT;
  return { left: area.x * ratio, top: area.y * ratio, width: area.width * ratio, height: area.height * ratio };
}
