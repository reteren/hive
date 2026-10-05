import { camera, viewport } from "../board/camera.svelte";
import { currentDrawLevel, levelPxPerUnit, type DrawPointerEvent, type DrawTool, type DrawToolHandler, type TileKey, type TileSnapshot, type WorldRect, worldToRaster } from "./types";
import { drawingStore } from "./tileStore.svelte";
import { affectedTileKeys, applyAcrossLevels, pushDrawingHistory, rasterRectToWorld, readCompositeRect } from "./history";
import { record } from "../history/history.svelte";
import { drawingGpu } from "./gpu/glEngine";
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
  /** Pyramid level of the raster coordinates (the zoom the selection was made at). */
  level: number;
}

interface SelectionGesture {
  kind: "shape" | "move";
  tool?: SelectionTool;
  level: number;
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
  selectionBefore?: DrawingSelectionArea | null;
  fastPreview?: HTMLCanvasElement | null;
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
  level: number;
}

const DRAG_THRESHOLD_PX = 4;
const MIN_PATH_STEP_RASTER_PX = 2;
const MAX_SELECTION_DIMENSION = 4096;
const MAX_SELECTION_PIXELS = 16_777_216;
const SELECTION_TOOLS: readonly SelectionTool[] = ["select-rect", "select-lasso", "select-polygon"];

export const drawingSelection = $state({
  area: null as DrawingSelectionArea | null,
  preview: null as { tool: SelectionTool; points: RasterPoint[]; level: number } | null,
  floating: null as RasterPixels | null,
  floatingAt: null as RasterPoint | null,
  fastPreview: null as { canvas: HTMLCanvasElement; offsetX: number; offsetY: number; hideSource: boolean } | null,
  revision: 0,
});

let activeGesture: SelectionGesture | null = null;
let clipboard: ClipboardPixels | null = null;
let cursorWorld: RasterPoint | null = null;

/** Rasterize a rectangle, lasso, or polygon without depending on canvas APIs. */
export function buildSelectionArea(tool: SelectionTool, points: readonly RasterPoint[], level = 0): DrawingSelectionArea | null {
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
      level,
    };
  }

  const cleanPoints = compactPath(points);
  if (cleanPoints.length < 3) return null;
  const bounds = boundsForPoints(cleanPoints);
  if (!bounds) return null;
  const mask = rasterizePolygonMask(bounds, cleanPoints);
  if (!mask.some((value) => value !== 0)) return null;
  return { ...bounds, tool, mask, outline: cleanPoints, level };
}

export function selectionContains(area: DrawingSelectionArea, point: RasterPoint): boolean {
  const x = Math.floor(point.x) - area.x;
  const y = Math.floor(point.y) - area.y;
  return x >= 0 && y >= 0 && x < area.width && y < area.height && area.mask[y * area.width + x] !== 0;
}

function distanceToSegment(point: RasterPoint, start: RasterPoint, end: RasterPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/** True when the existing selection should handle this pointer as a move gesture. */
export function isDrawingSelectionBorder(event: DrawPointerEvent, bandPx = 6): boolean {
  const area = drawingSelection.area;
  if (!area || drawingSelection.floatingAt) return false;

  // Ctrl makes the selected pixels a move handle while a selection tool is active. Ctrl+Alt is
  // reserved for copying in beginMove; Ctrl alone always means move, including on the border.
  if (event.ctrl && selectionContains(area, readPoint(event, area.level))) return true;

  const ppu = levelPxPerUnit(area.level);
  const point = { x: event.world.x * ppu, y: event.world.y * ppu };
  const pixelsPerRasterPx = event.zoom * PX_PER_UNIT / ppu;
  const maxDistance = Math.max(0, bandPx) / Math.max(Number.EPSILON, pixelsPerRasterPx);
  const outline = area.outline;
  for (let index = 0; index < outline.length; index += 1) {
    const start = outline[index]!;
    const end = outline[(index + 1) % outline.length]!;
    if (distanceToSegment(point, start, end) <= maxDistance) return true;
  }
  return false;
}

/** Start an existing selection move from the shared draw-input router, for every active sub-tool. */
export function beginSelectionBorderMove(event: DrawPointerEvent): boolean {
  if (!isDrawingSelectionBorder(event) || activeGesture) return false;
  return beginMove(event);
}

/** The active selection edge has its own gesture route even when another draw sub-tool is selected. */
export const selectionMoveHandler: DrawToolHandler = {
  down() {},
  move: moveActiveGesture,
  up: finishActiveGesture,
  cancel: cancelActiveGesture,
  deactivate: deactivateSelectionGesture,
};

/** Ctrl-drag on brush/eraser/fill makes a one-gesture rectangle without changing the active tool. */
export function shouldStartQuickSelection(tool: DrawTool, event: DrawPointerEvent, moveAlreadyStarted = false): boolean {
  return !moveAlreadyStarted && event.ctrl && (tool === "brush" || tool === "eraser" || tool === "fill");
}

/** Selection commands are mode-wide, so Delete/Esc/C/V work with any drawing sub-tool active. */
export function handleDrawingSelectionKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.repeat) return false;
  if (event.key === "Escape") {
    if (drawingSelection.preview?.tool === "select-polygon") {
      drawingSelection.area = copySelectionArea(polygonSelectionBefore);
      polygonSelectionBefore = null;
      drawingSelection.preview = null;
      updateState();
      return true;
    }
    const gesture = activeGesture;
    if (gesture?.kind === "move" && gesture.started) {
      void commitMove(gesture).finally(clearDrawingSelection);
      return true;
    }
    if (gesture?.kind === "move") {
      void cancelMove(gesture).finally(clearDrawingSelection);
      return true;
    }
    const hadState = Boolean(gesture || drawingSelection.area || drawingSelection.preview);
    if (gesture) {
      activeGesture = null;
      drawingSelection.area = copySelectionArea(gesture.selectionBefore ?? null);
      drawingSelection.preview = null;
      updateState();
      return hadState;
    }
    if (hadState) clearDrawingSelection();
    return hadState;
  }
  if (activeGesture?.completion) return false;
  if (event.key === "Enter" && drawingSelection.preview?.tool === "select-polygon") {
    const previousArea = polygonSelectionBefore;
    polygonSelectionBefore = null;
    void selectPixels("select-polygon", drawingSelection.preview.points, drawingSelection.preview.level, previousArea);
    return true;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    if (!drawingSelection.area) return false;
    void deleteCurrentSelection();
    return true;
  }
  if (event.ctrlKey && event.code === "KeyC") {
    if (!drawingSelection.area) return false;
    copyCurrentSelection();
    return true;
  }
  if (event.ctrlKey && event.code === "KeyV") {
    if (!clipboard) return false;
    void pasteClipboard(cursorWorld);
    return true;
  }
  return false;
}

/** Clear selection UI and cancel any unfinished selection gesture without changing pixels. */
export function clearDrawingSelection(): void {
  const gesture = activeGesture;
  const previousArea = copySelectionArea(drawingSelection.area ?? gesture?.selectionBefore ?? polygonSelectionBefore ?? null);
  if (gesture?.kind === "move" && !gesture.cancelled) void cancelMove(gesture);
  else if (gesture) activeGesture = null;
  clearSelection();
  recordSelectionChange("Clear selection", previousArea, null);
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
    level: area.level,
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

function readPoint(event: DrawPointerEvent, level: number): RasterPoint {
  const point = worldToRaster(event.world.x, event.world.y, level);
  return { x: point.px, y: point.py };
}

/** Level a new gesture works at: the existing selection's, otherwise the one matching the zoom. */
function gestureLevel(event: DrawPointerEvent): number {
  return drawingSelection.area?.level ?? currentDrawLevel(event.zoom);
}

function areaWorldRect(area: PixelBounds, level: number): WorldRect {
  return rasterRectToWorld(area.x, area.y, area.width, area.height, level);
}

/** Visible drawing (all levels) inside an area, at the area's level. */
function readVisible(area: PixelBounds, level: number): RasterPixels {
  return {
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    data: new Uint8ClampedArray(readCompositeRect(area.x, area.y, area.width, area.height, level).data),
  };
}

/** Remove the masked pixels from every level (the selection mask as a destination-out source). */
function cutMask(area: DrawingSelectionArea): TileKey[] {
  const canvas = document.createElement("canvas");
  canvas.width = area.width;
  canvas.height = area.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create a drawing selection mask.");
  const image = context.createImageData(area.width, area.height);
  for (let pixel = 0; pixel < area.mask.length; pixel += 1) image.data[pixel * 4 + 3] = area.mask[pixel]!;
  context.putImageData(image, 0, 0);
  try {
    return applyAcrossLevels(canvas, area.x, area.y, area.level, "erase", 1, area, true);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Paint pixels at a level like a brush (covers finer detail underneath). */
function paintPixels(pixels: RasterPixels, level: number): TileKey[] {
  const canvas = canvasFromPixels(pixels);
  try {
    return applyAcrossLevels(canvas, pixels.x, pixels.y, level, "paint", 1);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
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

function copySelectionArea(area: DrawingSelectionArea | null): DrawingSelectionArea | null {
  return area ? {
    ...area,
    mask: new Uint8Array(area.mask),
    outline: area.outline.map((point) => ({ ...point })),
  } : null;
}

function restoreSelectionArea(area: DrawingSelectionArea | null): void {
  drawingSelection.area = copySelectionArea(area);
  drawingSelection.preview = null;
  drawingSelection.floating = null;
  drawingSelection.floatingAt = null;
  drawingSelection.fastPreview = null;
  updateState();
}

function sameSelectionArea(left: DrawingSelectionArea | null, right: DrawingSelectionArea | null): boolean {
  if (!left || !right) return left === right;
  if (left.x !== right.x || left.y !== right.y || left.width !== right.width || left.height !== right.height ||
    left.tool !== right.tool || left.level !== right.level || left.mask.length !== right.mask.length ||
    left.outline.length !== right.outline.length) return false;
  for (let index = 0; index < left.mask.length; index += 1) if (left.mask[index] !== right.mask[index]) return false;
  return left.outline.every((point, index) => point.x === right.outline[index]!.x && point.y === right.outline[index]!.y);
}

function recordSelectionChange(label: string, before: DrawingSelectionArea | null, after: DrawingSelectionArea | null): void {
  const beforeSnapshot = copySelectionArea(before);
  const afterSnapshot = copySelectionArea(after);
  if (sameSelectionArea(beforeSnapshot, afterSnapshot)) return;
  record({
    label,
    undo: () => restoreSelectionArea(beforeSnapshot),
    do: () => restoreSelectionArea(afterSnapshot),
  });
}

let polygonSelectionBefore: DrawingSelectionArea | null = null;

function selectPixels(
  tool: SelectionTool,
  points: readonly RasterPoint[],
  level: number,
  beforeArea: DrawingSelectionArea | null = copySelectionArea(drawingSelection.area),
): void {
  const area = buildSelectionArea(tool, points, level);
  drawingSelection.preview = null;
  if (!area) {
    drawingSelection.area = copySelectionArea(beforeArea);
    drawingSelection.floating = null;
    drawingSelection.floatingAt = null;
    drawingSelection.fastPreview = null;
    updateState();
    return;
  }
  drawingSelection.area = area;
  drawingSelection.floating = null;
  drawingSelection.floatingAt = null;
  drawingSelection.fastPreview = null;
  recordSelectionChange(beforeArea ? "Replace selection" : "Create selection", beforeArea, area);
  updateState();
}

function appendDistinct(points: readonly RasterPoint[], next: RasterPoint): RasterPoint[] {
  const previous = points.at(-1);
  if (previous && Math.hypot(previous.x - next.x, previous.y - next.y) < MIN_PATH_STEP_RASTER_PX) return [...points];
  return [...points, next];
}

function prepareMove(area: DrawingSelectionArea): Promise<PreparedMove> {
  const sourceKeys = affectedTileKeys(areaWorldRect(area, area.level), area.level, "erase");
  const split = splitPixelsByMask(readVisible(area, area.level), area.mask);
  return drawingStore.snapshot(sourceKeys).then((before) => ({
    area,
    sourceKeys,
    before,
    selected: split.selected,
    remainder: split.remainder,
  }));
}

function beginMove(event: DrawPointerEvent): boolean {
  const area = drawingSelection.area;
  if (!area) return false;
  const point = readPoint(event, area.level);
  activeGesture = {
    kind: "move",
    level: area.level,
    start: point,
    last: point,
    startClient: { ...event.client },
    lastClient: { ...event.client },
    copy: event.ctrl && event.alt,
  };
  return true;
}

function captureScreenSelection(area: DrawingSelectionArea): HTMLCanvasElement | null {
  const gpu = drawingGpu();
  if (!gpu || gpu.isLost || typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = gpu.canvas.width;
  canvas.height = gpu.canvas.height;
  const context = canvas.getContext("2d");
  if (!context || canvas.width === 0 || canvas.height === 0) return null;
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const ppu = levelPxPerUnit(area.level);
  context.beginPath();
  area.outline.forEach((point, index) => {
    const screenX = viewport.width / 2 + (point.x / ppu - camera.x) * PX_PER_UNIT * camera.zoom;
    const screenY = viewport.height / 2 + (point.y / ppu - camera.y) * PX_PER_UNIT * camera.zoom;
    if (index === 0) context.moveTo(screenX * dpr, screenY * dpr);
    else context.lineTo(screenX * dpr, screenY * dpr);
  });
  context.closePath();
  context.clip();
  // The GPU canvas keeps no buffer between frames: render it in this task, then copy it (a copy of
  // an already presented frame was blank, so the moved piece vanished until release).
  gpu.renderNow?.();
  context.drawImage(gpu.canvas, 0, 0);
  return canvas;
}

function startFloating(gesture: SelectionGesture): void {
  const area = drawingSelection.area;
  if (!area) return;
  gesture.fastPreview = captureScreenSelection(area);
  drawingSelection.fastPreview = gesture.fastPreview ? {
    canvas: gesture.fastPreview,
    offsetX: gesture.lastClient.x - gesture.startClient.x,
    offsetY: gesture.lastClient.y - gesture.startClient.y,
    hideSource: !gesture.copy,
  } : null;
  updateState();
}

function prepareFloatingMove(gesture: SelectionGesture): void {
  if (gesture.pending || !gesture.started) return;
  const area = drawingSelection.area;
  if (!area) return;
  gesture.prepared = new Promise<PreparedMove>((resolve, reject) => {
    const prepareAfterPaint = () => setTimeout(() => {
      try {
        void prepareMove(area).then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    }, 0);
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(prepareAfterPaint);
    else prepareAfterPaint();
  });
  gesture.pending = gesture.prepared.then(async (prepared) => {
    if (gesture.cancelled || activeGesture !== gesture || !gesture.started) return;
    if (!hasVisiblePixels(prepared.selected)) {
      gesture.started = false;
      drawingSelection.floatingAt = null;
      drawingSelection.fastPreview = null;
      updateState();
      return;
    }
    let cutAttempted = false;
    try {
      if (!gesture.copy) {
        cutAttempted = true;
        cutMask(prepared.area);
        gesture.didCut = true;
      }
      drawingSelection.floating = prepared.selected;
      drawingSelection.fastPreview = null;
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
    drawingSelection.fastPreview = null;
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
    const destinationKeys = affectedTileKeys(areaWorldRect(destination, prepared.area.level), prepared.area.level, "paint");
    if (destinationKeys.length === 0) {
      if (gesture.didCut) await drawingStore.restore(prepared.before);
      mutationStarted = false;
      return;
    }
    const destinationBefore = await drawingStore.snapshot(destinationKeys);
    for (const [key, blob] of destinationBefore) if (!rollback.has(key)) rollback.set(key, blob);

    mutationStarted = true;
    const painted = paintPixels({ ...prepared.selected, x: destination.x, y: destination.y }, prepared.area.level);
    const changedKeys = [...new Set([...prepared.sourceKeys, ...destinationKeys, ...painted])];
    for (const key of changedKeys) if (!rollback.has(key)) rollback.set(key, null);
    const after = await drawingStore.snapshot(changedKeys);
    const selectionBefore = copySelectionArea(prepared.area);
    const selectionAfter: DrawingSelectionArea = {
      ...prepared.area,
      x: destination.x,
      y: destination.y,
      outline: prepared.area.outline.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY })),
    };
    pushDrawingHistory(gesture.copy ? "Copy selection" : "Move selection", rollback, after, {
      undo: () => restoreSelectionArea(selectionBefore),
      redo: () => restoreSelectionArea(selectionAfter),
    });
    drawingSelection.area = copySelectionArea(selectionAfter);
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
    drawingSelection.fastPreview = null;
    updateState();
    if (activeGesture === gesture) activeGesture = null;
  }
}

function commitMove(gesture: SelectionGesture): Promise<void> {
  if (gesture.completion) return gesture.completion;
  prepareFloatingMove(gesture);
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
    drawingSelection.fastPreview = null;
    updateState();
    if (activeGesture === gesture) activeGesture = null;
  }
}

async function deleteCurrentSelection(): Promise<void> {
  const area = drawingSelection.area;
  if (!area) return;
  const keys = affectedTileKeys(areaWorldRect(area, area.level), area.level, "erase");
  if (keys.length === 0) return;
  let before: TileSnapshot | null = null;
  let mutationStarted = false;
  try {
    const selected = copySelectionPixels(readVisible(area, area.level), area.mask);
    if (!hasVisiblePixels(selected)) return;
    before = await drawingStore.snapshot(keys);
    mutationStarted = true;
    cutMask(area);
    const after = await drawingStore.snapshot(keys);
    pushDrawingHistory("Delete selection", before, after);
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
    const selected = copySelectionPixels(readVisible(area, area.level), area.mask);
    if (!hasVisiblePixels(selected)) return;
    clipboard = { ...selected, mask: new Uint8Array(area.mask), level: area.level };
  } catch (error) {
    console.error("Could not copy the drawing selection", error);
  }
}

async function pasteClipboard(world: RasterPoint | null): Promise<void> {
  if (!clipboard || !world) return;
  const selectionBefore = copySelectionArea(drawingSelection.area);
  const level = clipboard.level;
  const point = worldToRaster(world.x, world.y, level);
  const targetX = Math.floor(point.px);
  const targetY = Math.floor(point.py);
  const pixels = { ...clipboard, x: targetX, y: targetY };
  const keys = affectedTileKeys(areaWorldRect(pixels, level), level, "paint");
  if (keys.length === 0) return;
  let before: TileSnapshot | null = null;
  let mutationStarted = false;
  try {
    before = await drawingStore.snapshot(keys);
    mutationStarted = true;
    const painted = paintPixels(pixels, level);
    const changed = [...new Set([...keys, ...painted])];
    for (const key of changed) if (!before.has(key)) before.set(key, null);
    const after = await drawingStore.snapshot(changed);
    const selectionAfter: DrawingSelectionArea = {
      x: targetX,
      y: targetY,
      width: pixels.width,
      height: pixels.height,
      tool: "select-rect",
      level,
      mask: new Uint8Array(clipboard.mask),
      outline: [
        { x: targetX, y: targetY },
        { x: targetX + pixels.width, y: targetY },
        { x: targetX + pixels.width, y: targetY + pixels.height },
        { x: targetX, y: targetY + pixels.height },
      ],
    };
    pushDrawingHistory("Paste selection", before, after, {
      undo: () => restoreSelectionArea(selectionBefore),
      redo: () => restoreSelectionArea(selectionAfter),
    });
    drawingSelection.area = copySelectionArea(selectionAfter);
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
  drawingSelection.fastPreview = null;
  polygonSelectionBefore = null;
  updateState();
}

function addPolygonPoint(
  gestureTool: SelectionTool,
  event: DrawPointerEvent,
  previousArea: DrawingSelectionArea | null = copySelectionArea(drawingSelection.area),
): void {
  const previous = drawingSelection.preview;
  const continuing = previous?.tool === gestureTool;
  if (!continuing) polygonSelectionBefore = copySelectionArea(previousArea);
  const level = continuing ? previous.level : currentDrawLevel(event.zoom);
  const point = readPoint(event, level);
  const points = continuing ? appendDistinct(previous.points, point) : [point];
  drawingSelection.preview = { tool: gestureTool, points, level };
  cursorWorld = { ...event.world };
  if (event.detail >= 2) {
    const beforeArea = polygonSelectionBefore;
    polygonSelectionBefore = null;
    void selectPixels("select-polygon", points, level, beforeArea);
  }
  updateState();
}

function createHandler(tool: SelectionTool) {
  return {
    down(event: DrawPointerEvent) {
      if (activeGesture?.completion) return;
      cursorWorld = { ...event.world };
      const area = drawingSelection.area;
      const previousArea = copySelectionArea(area);
      if (area) {
        if (isDrawingSelectionBorder(event)) {
          beginMove(event);
          return;
        }
        // A selection-tool drag always starts a replacement selection unless it starts on the edge.
        clearSelection();
      }
      if (tool === "select-polygon" && drawingSelection.preview?.tool === "select-polygon") {
        addPolygonPoint(tool, event, previousArea);
        return;
      }
      if (tool === "select-polygon") {
        addPolygonPoint(tool, event, previousArea);
        return;
      }
      const level = gestureLevel(event);
      const point = readPoint(event, level);
      activeGesture = {
        kind: "shape",
        tool,
        level,
        start: point,
        last: point,
        startClient: { ...event.client },
        lastClient: { ...event.client },
        points: [point],
        selectionBefore: previousArea,
      };
      drawingSelection.preview = { tool, points: [point], level };
      updateState();
    },
    move: moveActiveGesture,
    up: finishActiveGesture,
    cancel: cancelActiveGesture,
    key: handleDrawingSelectionKey,
    deactivate: deactivateSelectionGesture,
  };
}

function moveActiveGesture(event: DrawPointerEvent): void {
  cursorWorld = { ...event.world };
  const gesture = activeGesture;
  if (!gesture || gesture.completion) return;
  gesture.last = readPoint(event, gesture.level);
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
      if (gesture.fastPreview) {
        drawingSelection.fastPreview = {
          canvas: gesture.fastPreview,
          offsetX: gesture.lastClient.x - gesture.startClient.x,
          offsetY: gesture.lastClient.y - gesture.startClient.y,
          hideSource: !gesture.copy,
        };
      }
      updateState();
    }
    return;
  }

  const points = gesture.tool === "select-rect"
    ? [gesture.start, gesture.last]
    : appendDistinct(gesture.points ?? [], gesture.last);
  gesture.points = points;
  drawingSelection.preview = { tool: gesture.tool!, points, level: gesture.level };
  updateState();
}

function finishActiveGesture(event: DrawPointerEvent): void {
  const gesture = activeGesture;
  if (!gesture || gesture.completion) return;
  gesture.last = readPoint(event, gesture.level);
  if (gesture.kind === "move") {
    if (gesture.started) void commitMove(gesture);
    else activeGesture = null;
    return;
  }
  activeGesture = null;
  void selectPixels(gesture.tool!, gesture.tool === "select-rect"
    ? [gesture.start, gesture.last]
    : appendDistinct(gesture.points ?? [], gesture.last), gesture.level, gesture.selectionBefore ?? null);
}

function cancelActiveGesture(): void {
  const gesture = activeGesture;
  if (gesture?.completion) return;
  if (gesture?.kind === "move") void cancelMove(gesture);
  else {
    activeGesture = null;
    if (gesture?.kind === "shape") drawingSelection.area = copySelectionArea(gesture.selectionBefore ?? null);
    drawingSelection.preview = null;
    updateState();
  }
}

function deactivateSelectionGesture(): void {
  const gesture = activeGesture;
  if (gesture?.kind === "move" && !gesture.cancelled) {
    if (gesture.started) void commitMove(gesture);
    else void cancelMove(gesture);
  } else if (gesture) {
    activeGesture = null;
    if (gesture.kind === "shape") drawingSelection.area = copySelectionArea(gesture.selectionBefore ?? null);
    drawingSelection.preview = null;
    updateState();
  }
}

for (const tool of SELECTION_TOOLS) registerDrawTool(tool, createHandler(tool));

export const quickSelectionHandler: DrawToolHandler = createHandler("select-rect");

function worldFromClient(clientX: number, clientY: number): RasterPoint | null {
  const board = document.querySelector<HTMLElement>(".board");
  if (!board) return null;
  const bounds = board.getBoundingClientRect();
  return screenToWorld(camera, viewport, { x: clientX - bounds.left, y: clientY - bounds.top });
}

if (typeof window !== "undefined") {
  window.addEventListener("pointermove", (event) => {
    if (!SELECTION_TOOLS.includes(drawingTools.active as SelectionTool)) return;
    const point = worldFromClient(event.clientX, event.clientY);
    if (point) cursorWorld = point;
  }, true);

  const updateSelectionMoveHover = (event: KeyboardEvent) => {
    if (document.documentElement.dataset.drawingMode !== "true" ||
      !SELECTION_TOOLS.includes(drawingTools.active as SelectionTool) || activeGesture) return;
    const area = drawingSelection.area;
    if (!area || drawingSelection.floatingAt || !cursorWorld) {
      delete document.documentElement.dataset.selectionMoveHover;
      return;
    }
    const pointer: DrawPointerEvent = {
      world: cursorWorld,
      client: { x: 0, y: 0 },
      zoom: camera.zoom,
      pressure: 0.5,
      shift: event.shiftKey,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      detail: 1,
    };
    if (isDrawingSelectionBorder(pointer)) document.documentElement.dataset.selectionMoveHover = "true";
    else delete document.documentElement.dataset.selectionMoveHover;
  };
  window.addEventListener("keydown", updateSelectionMoveHover, true);
  window.addEventListener("keyup", updateSelectionMoveHover, true);
}

export function selectionAreaWorldRect(area: PixelBounds & { level?: number }): WorldRect {
  return areaWorldRect(area, area.level ?? 0);
}

export function selectionBoundsWorldPixels(area: PixelBounds & { level?: number }): { left: number; top: number; width: number; height: number } {
  const ratio = PX_PER_UNIT / levelPxPerUnit(area.level ?? 0);
  return { left: area.x * ratio, top: area.y * ratio, width: area.width * ratio, height: area.height * ratio };
}
