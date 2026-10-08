import type { BrushSettings, DrawPointerEvent, DrawToolHandler } from "./types";
import { createStroke, type DrawStroke, type StrokePoint } from "./brush";
import { sprayToolHandler } from "./brushes/spray";
import { drawingTools } from "./tools.svelte";
import { registerDrawTool } from "./toolRegistry";
import { drawingTileStore } from "./tileStore.svelte";
import { affectedTileKeys, applyAcrossLevels, drawingHistoryIdle, pushDrawingHistory, rasterRectToWorld, waitForDrawingHistoryRestore } from "./history";
import type { TileKey, TileSnapshot } from "./types";
import { drawingSelection } from "./selection.svelte";

/**
 * The live stroke shown by DrawingLayer (its coverage stays on the GPU). `revision` bumps on every
 * change so the layer re-renders in the same frame.
 */
export const drawingStrokePreview = $state({
  /** Opacity of the live stroke (the brush opacity; erasing shows a translucent mark). */
  opacity: 1,
  erase: false,
  revision: 0,
});

// Kept outside $state: a proxied stroke would never compare equal to the stroke that owns it.
let previewedStroke: DrawStroke | null = null;

/** The stroke currently shown live (read together with drawingStrokePreview.revision). */
export function previewStroke(): DrawStroke | null {
  return previewedStroke;
}

/** Show a live stroke (brush or eraser) on the drawing layer. */
export function showStrokePreview(stroke: DrawStroke, options: { opacity: number; erase?: boolean }): void {
  previewedStroke = stroke;
  drawingStrokePreview.opacity = options.opacity;
  drawingStrokePreview.erase = options.erase === true;
  drawingStrokePreview.revision += 1;
}

/** Hide the live stroke if it still belongs to this stroke (a newer one may already be drawing). */
export function hideStrokePreview(stroke: DrawStroke): void {
  if (previewedStroke === stroke) clearPreview();
}

let activeStroke: DrawStroke | null = null;
let activeSettings: BrushSettings | null = null;
let commitQueue = Promise.resolve();
let commitsInFlight = 0;
/**
 * Undo "before" copies taken while the stroke is still being drawn, a few tiles per pointer move,
 * so releasing a huge stroke over a detailed drawing does not copy hundreds of tiles at once. Only
 * valid while nothing else changes tiles (no commit or Undo restore in flight).
 */
let earlyBefore: TileSnapshot | null = null;
const EARLY_COPIES_PER_MOVE = 16;

function captureEarlyBefore(stroke: DrawStroke): void {
  earlyBefore = captureStrokeBefore(stroke, earlyBefore);
}

/** Incrementally snapshot tiles before a long live stroke reaches them. */
export function captureStrokeBefore(stroke: DrawStroke, current: TileSnapshot | null): TileSnapshot | null {
  if (!current || !stroke.bounds) return current;
  if (commitsInFlight > 0 || !drawingHistoryIdle()) return null;
  const bounds = stroke.bounds;
  const keys = affectedTileKeys(rasterRectToWorld(bounds.x, bounds.y, bounds.width, bounds.height, stroke.level), stroke.level, "paint");
  const missing: TileKey[] = [];
  for (const key of keys) {
    if (current.has(key)) continue;
    missing.push(key);
    if (missing.length >= EARLY_COPIES_PER_MOVE) break;
  }
  if (missing.length) for (const [key, copy] of drawingTileStore.snapshotNow(missing)) current.set(key, copy);
  return current;
}

/** Begin a brush gesture; the actual paint is committed as one action on endStroke. */
export function beginStroke(settings: BrushSettings, world: StrokePoint, zoom: number, pressure = 0.5): void {
  cancelStroke();
  activeSettings = { ...settings };
  activeStroke = createStroke(activeSettings, zoom);
  earlyBefore = commitsInFlight === 0 && drawingHistoryIdle() ? new Map() : null;
  activeStroke.add(world, pressure);
  captureEarlyBefore(activeStroke);
  publishPreview();
}

export function extendStroke(world: StrokePoint, pressure = 0.5): void {
  if (!activeStroke) return;
  activeStroke.add(world, pressure);
  captureEarlyBefore(activeStroke);
  publishPreview();
}

export async function endStroke(): Promise<void> {
  const stroke = activeStroke;
  const settings = activeSettings;
  activeStroke = null;
  activeSettings = null;
  if (!stroke || !settings) {
    clearPreview();
    return;
  }

  const finished = stroke.finish();
  if (!finished) {
    hideStrokePreview(stroke);
    stroke.dispose();
    return;
  }
  const early = earlyBefore;
  earlyBefore = null;
  await commitFinishedStroke(stroke, finished, settings, "Draw", drawingSelection.area, early);
}

/** Commit brush or spray output through the same queue so rapid tool switches keep Undo ordered. */
export async function commitFinishedStroke(
  stroke: DrawStroke,
  finished: NonNullable<ReturnType<DrawStroke["finish"]>>,
  settings: BrushSettings,
  label: string,
  selection: typeof drawingSelection.area,
  early: TileSnapshot | null = null,
): Promise<void> {
  const rect = rasterRectToWorld(finished.rasterX, finished.rasterY, finished.width, finished.height, finished.level);
  commitsInFlight += 1;
  const operation = commitQueue.then(async () => {
    try {
      await waitForDrawingHistoryRestore();
      // Keys are taken after earlier commits landed: a previous stroke may have created tiles here.
      const keys = affectedTileKeys(rect, finished.level, "paint");
      const before: TileSnapshot = new Map();
      const missing: TileKey[] = [];
      for (const key of keys) {
        const copy = early?.get(key);
        if (early && early.has(key)) before.set(key, copy ?? null);
        else missing.push(key);
      }
      for (const [key, copy] of drawingTileStore.snapshotNow(missing)) before.set(key, copy);
      const changed = applyAcrossLevels(finished.source, finished.rasterX, finished.rasterY, finished.level, "paint", settings.opacity, selection);
      // The live preview stays until the paint is in the tiles, so the stroke never blinks out.
      hideStrokePreview(stroke);
      if (changed.length > 0) pushDrawingHistory(label, before, changed);
    } catch (error) {
      console.error("Could not finish drawing stroke", error);
      throw error;
    } finally {
      commitsInFlight -= 1;
      hideStrokePreview(stroke);
      stroke.dispose();
    }
  });
  commitQueue = operation.catch(() => undefined);
  await operation;
}

export function cancelStroke(): void {
  earlyBefore = null;
  if (activeStroke) hideStrokePreview(activeStroke);
  activeStroke?.dispose();
  activeStroke = null;
  activeSettings = null;
}

function publishPreview(): void {
  if (!activeStroke || !activeSettings) return;
  showStrokePreview(activeStroke, { opacity: activeSettings.opacity });
}

function clearPreview(): void {
  previewedStroke = null;
  drawingStrokePreview.revision += 1;
}

function toPoint(event: DrawPointerEvent): StrokePoint {
  return event.world;
}

let delegatedBrushHandler: DrawToolHandler | null = null;

registerDrawTool("brush", {
  down(event) {
    delegatedBrushHandler?.cancel();
    delegatedBrushHandler = null;
    if (drawingTools.brush.tip === "spray") {
      cancelStroke();
      delegatedBrushHandler = sprayToolHandler;
      delegatedBrushHandler.down(event);
      return;
    }
    beginStroke(drawingTools.brush, toPoint(event), event.zoom, event.pressure);
  },
  move(event) {
    if (delegatedBrushHandler) delegatedBrushHandler.move(event);
    else extendStroke(toPoint(event), event.pressure);
  },
  up(event) {
    if (delegatedBrushHandler) {
      const handler = delegatedBrushHandler;
      delegatedBrushHandler = null;
      handler.up(event);
      return;
    }
    extendStroke(toPoint(event), event.pressure);
    void endStroke().catch((error: unknown) => console.error("Drawing stroke failed", error));
  },
  cancel() {
    const handler = delegatedBrushHandler;
    delegatedBrushHandler = null;
    handler?.cancel();
    cancelStroke();
  },
});
