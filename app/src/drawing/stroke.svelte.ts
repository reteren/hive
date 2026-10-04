import type { BrushSettings, DrawPointerEvent } from "./types";
import { createStroke, type DrawStroke, type StrokePoint, type StrokeRasterRect } from "./brush";
import { drawingTools } from "./tools.svelte";
import { registerDrawTool } from "./toolRegistry";
import { drawingTileStore } from "./tileStore.svelte";
import { affectedTileKeys, applyAcrossLevels, pushDrawingHistory, rasterRectToWorld, waitForDrawingHistoryRestore } from "./history";
import { drawingSelection } from "./selection.svelte";
import { clipRasterDataToSelection } from "./selectionClip";

/** Live, raster-positioned preview consumed by DrawingLayer. */
export const drawingStrokePreview = $state({
  source: null as HTMLCanvasElement | null,
  rasterX: 0,
  rasterY: 0,
  /** Raster px per world unit of the stroke's level. */
  pixelsPerUnit: 20,
  /** CSS opacity of the live stroke (the brush opacity; erasing shows a translucent mark). */
  opacity: 1,
  erase: false,
  dirtyRect: null as StrokeRasterRect | null,
  revision: 0,
});

/** Show a live stroke (brush or eraser) on the drawing layer. */
export function showStrokePreview(stroke: DrawStroke, options: { opacity: number; erase?: boolean }): void {
  const selection = drawingSelection.area;
  if (selection) {
    clippedPreviewCanvas ??= document.createElement("canvas");
    clippedPreviewCanvas.width = stroke.preview.width;
    clippedPreviewCanvas.height = stroke.preview.height;
    const context = clippedPreviewCanvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not prepare a clipped stroke preview.");
    context.drawImage(stroke.preview, 0, 0);
    const image = context.getImageData(0, 0, clippedPreviewCanvas.width, clippedPreviewCanvas.height);
    clipRasterDataToSelection(image.data, image.width, image.height, stroke.rasterX, stroke.rasterY, stroke.level, selection);
    context.putImageData(image, 0, 0);
    drawingStrokePreview.source = clippedPreviewCanvas;
  } else {
    drawingStrokePreview.source = stroke.preview;
  }
  previewOwner = stroke;
  drawingStrokePreview.rasterX = stroke.rasterX;
  drawingStrokePreview.rasterY = stroke.rasterY;
  drawingStrokePreview.pixelsPerUnit = stroke.pixelsPerUnit;
  drawingStrokePreview.opacity = options.opacity;
  drawingStrokePreview.erase = options.erase === true;
  drawingStrokePreview.dirtyRect = stroke.lastDirtyRect;
  drawingStrokePreview.revision += 1;
}

/** Hide the live stroke if it still belongs to this stroke (a newer one may already be drawing). */
export function hideStrokePreview(stroke: DrawStroke): void {
  if (previewOwner === stroke) clearPreview();
}

let activeStroke: DrawStroke | null = null;
let activeSettings: BrushSettings | null = null;
let commitQueue = Promise.resolve();
let previewOwner: DrawStroke | null = null;
let clippedPreviewCanvas: HTMLCanvasElement | null = null;

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
  const rect = rasterRectToWorld(finished.rasterX, finished.rasterY, finished.source.width, finished.source.height, finished.level);
  const selection = drawingSelection.area;
  const operation = commitQueue.then(async () => {
    let before: Awaited<ReturnType<typeof drawingTileStore.snapshot>> | null = null;
    let attemptedPaint = false;
    try {
      await waitForDrawingHistoryRestore();
      // Keys are taken after earlier commits landed: a previous stroke may have created tiles here.
      const keys = affectedTileKeys(rect, finished.level, "paint");
      before = await drawingTileStore.snapshot(keys);
      attemptedPaint = true;
      const changed = applyAcrossLevels(finished.source, finished.rasterX, finished.rasterY, finished.level, "paint", settings.opacity, selection);
      // The live preview stays until the paint is in the tiles, so the stroke never blinks out after pointer-up.
      clearPreviewOf(stroke);
      const after = await drawingTileStore.snapshot([...new Set([...keys, ...changed])]);
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
  if (!activeStroke || !activeSettings) return;
  showStrokePreview(activeStroke, { opacity: activeSettings.opacity });
}

function clearPreviewOf(stroke: DrawStroke): void {
  hideStrokePreview(stroke);
}

function clearPreview(): void {
  drawingStrokePreview.source = null;
  drawingStrokePreview.dirtyRect = null;
  previewOwner = null;
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
