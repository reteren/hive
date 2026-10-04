import type { BrushSettings, DrawPointerEvent } from "./types";
import { createStroke, type DrawStroke, type StrokePoint } from "./brush";
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
  if (!earlyBefore || !stroke.bounds) return;
  if (commitsInFlight > 0 || !drawingHistoryIdle()) {
    earlyBefore = null;
    return;
  }
  const bounds = stroke.bounds;
  const keys = affectedTileKeys(rasterRectToWorld(bounds.x, bounds.y, bounds.width, bounds.height, stroke.level), stroke.level, "paint");
  const missing: TileKey[] = [];
  for (const key of keys) {
    if (earlyBefore.has(key)) continue;
    missing.push(key);
    if (missing.length >= EARLY_COPIES_PER_MOVE) break;
  }
  if (missing.length) for (const [key, copy] of drawingTileStore.snapshotNow(missing)) earlyBefore.set(key, copy);
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
  const selection = drawingSelection.area;
  const rect = rasterRectToWorld(finished.rasterX, finished.rasterY, finished.width, finished.height, finished.level);
  const early = earlyBefore;
  earlyBefore = null;
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
      if (changed.length > 0) pushDrawingHistory("Draw", before, changed);
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

registerDrawTool("brush", {
  down(event) { beginStroke(drawingTools.brush, toPoint(event), event.zoom, event.pressure); },
  move(event) { extendStroke(toPoint(event), event.pressure); },
  up(event) {
    extendStroke(toPoint(event), event.pressure);
    void endStroke().catch((error: unknown) => console.error("Drawing stroke failed", error));
  },
  cancel: cancelStroke,
});
