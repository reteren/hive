import { DRAW_PX_PER_UNIT, type BrushSettings, type DrawPointerEvent, type WorldRect } from "./types";
import { createStroke, type DrawStroke, type StrokePoint, type StrokeRasterRect } from "./brush";
import { drawingTools } from "./tools.svelte";
import { registerDrawTool } from "./toolRegistry";
import { drawingTileStore } from "./tileStore.svelte";
import { paintIntoTiles, pushDrawingHistory, waitForDrawingHistoryRestore } from "./history";

/** Live, raster-positioned preview consumed by DrawingLayer. */
export const drawingStrokePreview = $state({
  source: null as HTMLCanvasElement | null,
  rasterX: 0,
  rasterY: 0,
  dirtyRect: null as StrokeRasterRect | null,
  revision: 0,
});

let activeStroke: DrawStroke | null = null;
let activeSettings: BrushSettings | null = null;
let commitQueue = Promise.resolve();

/** Begin a brush gesture; the actual paint is committed as one action on endStroke. */
export function beginStroke(settings: BrushSettings, world: StrokePoint, zoom: number, pressure = 0.5): void {
  cancelStroke();
  activeSettings = { ...settings };
  activeStroke = createStroke(activeSettings, zoom);
  activeStroke.add(world, pressure);
  publishPreview();
}

export function extendStroke(world: StrokePoint, pressure = 0.5): void {
  if (!activeStroke) return;
  activeStroke.add(world, pressure);
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
    clearPreviewOf(stroke);
    stroke.dispose();
    return;
  }
  const rect: WorldRect = {
    x: finished.rasterX / DRAW_PX_PER_UNIT,
    y: finished.rasterY / DRAW_PX_PER_UNIT,
    width: finished.source.width / DRAW_PX_PER_UNIT,
    height: finished.source.height / DRAW_PX_PER_UNIT,
  };
  const keys = drawingTileStore.keysInRect(rect, true);
  const operation = commitQueue.then(async () => {
    let before: Awaited<ReturnType<typeof drawingTileStore.snapshot>> | null = null;
    let attemptedPaint = false;
    try {
      await waitForDrawingHistoryRestore();
      before = await drawingTileStore.snapshot(keys);
      attemptedPaint = true;
      const changed = paintIntoTiles(finished.source, finished.rasterX, finished.rasterY, "source-over", settings.opacity);
      // The live preview stays until the paint is in the tiles, so the stroke never blinks out after pointer-up.
      clearPreviewOf(stroke);
      const after = await drawingTileStore.snapshot(keys);
      if (changed.length > 0) pushDrawingHistory("Draw", before, after);
    } catch (error) {
      if (before && attemptedPaint) await drawingTileStore.restore(before).catch((restoreError: unknown) => {
        console.error("Could not roll back an incomplete drawing stroke", restoreError);
      });
      console.error("Could not finish drawing stroke", error);
      throw error;
    } finally {
      clearPreviewOf(stroke);
      stroke.dispose();
    }
  });
  commitQueue = operation.catch(() => undefined);
  await operation;
}

export function cancelStroke(): void {
  activeStroke?.dispose();
  activeStroke = null;
  activeSettings = null;
  clearPreview();
}

function publishPreview(): void {
  if (!activeStroke) return;
  drawingStrokePreview.source = activeStroke.preview;
  drawingStrokePreview.rasterX = activeStroke.rasterX;
  drawingStrokePreview.rasterY = activeStroke.rasterY;
  drawingStrokePreview.dirtyRect = activeStroke.lastDirtyRect;
  drawingStrokePreview.revision += 1;
}

/** Clear the preview only if it still shows this stroke (a newer stroke may already be drawing). */
function clearPreviewOf(stroke: DrawStroke): void {
  if (drawingStrokePreview.source === stroke.preview) clearPreview();
}

function clearPreview(): void {
  drawingStrokePreview.source = null;
  drawingStrokePreview.dirtyRect = null;
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
