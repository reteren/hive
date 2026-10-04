import { reportImportError } from "../attachments/service";
import { board, updateNote } from "../model/board.svelte";
import { drawingTools } from "./tools.svelte";
import { createStroke, type DrawStroke } from "./brush";
import { affectedTileKeys, applyAcrossLevels, pushDrawingHistory, rasterRectToWorld, readCompositeRect } from "./history";
import { hideStrokePreview, showStrokePreview } from "./stroke.svelte";
import { drawingStore } from "./tileStore.svelte";
import { registerDrawTool } from "./toolRegistry";
import {
  levelPxPerUnit,
  type BrushSettings,
  type DrawPointerEvent,
  type DrawToolHandler,
  type TileSnapshot,
} from "./types";
import {
  erasablePhotosInRasterRect,
  ERASER_GIF_TOOLTIP,
  eraserCompositeOptions,
  rasterMaskTouchesPhoto,
  type PhotoEraseGeometry,
  type RasterRect,
} from "./photoErase";
import { erasePhotoCopyOnWrite } from "./photoErase";

export { ERASER_GIF_TOOLTIP, eraserCompositeOptions } from "./photoErase";

/** Translucent live mark of the eraser path (the real erase lands on pointer-up as one Undo step). */
const ERASER_PREVIEW_OPACITY = 0.45;

/** The overlay badge used by toolbar/help UI; never route non-image objects into the photo path. */
export function erasablePhotoTargets(
  notes: Iterable<import("../model/note").Note>,
  stroke: RasterRect,
  pixelsPerUnit?: number,
): { note: import("../model/note").Note; geometry: PhotoEraseGeometry }[] {
  return erasablePhotosInRasterRect(notes, stroke, pixelsPerUnit);
}

export function createEraserHandler(getSettings: () => BrushSettings = () => drawingTools.brush): DrawToolHandler {
  let stroke: DrawStroke | null = null;
  let strokeSettings: BrushSettings | null = null;
  let committing = false;

  function abandonStroke(): void {
    if (stroke) {
      hideStrokePreview(stroke);
      stroke.dispose();
    }
    stroke = null;
    strokeSettings = null;
  }

  return {
    down(event: DrawPointerEvent) {
      if (committing) return;
      abandonStroke();
      strokeSettings = { ...getSettings() };
      stroke = createStroke({ ...strokeSettings, color: "#ffffff" }, event.zoom);
      stroke.add(event.world, event.pressure);
      showStrokePreview(stroke, { opacity: ERASER_PREVIEW_OPACITY, erase: true });
    },
    move(event: DrawPointerEvent) {
      if (!stroke) return;
      stroke.add(event.world, event.pressure);
      showStrokePreview(stroke, { opacity: ERASER_PREVIEW_OPACITY, erase: true });
    },
    up(event: DrawPointerEvent) {
      if (!stroke || !strokeSettings) return;
      const current = stroke;
      const settings = strokeSettings;
      current.add(event.world, event.pressure);
      const finished = current.finish();
      stroke = null;
      strokeSettings = null;
      if (!finished) {
        hideStrokePreview(current);
        current.dispose();
        return;
      }

      committing = true;
      void commitErase(finished.source, finished.rasterX, finished.rasterY, finished.level, settings)
        .catch((error: unknown) => reportImportError(error instanceof Error ? error.message : String(error)))
        .finally(() => {
          hideStrokePreview(current);
          current.dispose();
          committing = false;
        });
    },
    cancel: abandonStroke,
    deactivate: abandonStroke,
  };
}

/** Register separately from the Draw mode input router; the Tools task imports this module once. */
export function registerEraserTool(): () => void {
  return registerDrawTool("eraser", createEraserHandler());
}

export const unregisterEraserTool = registerEraserTool();

async function commitErase(
  source: HTMLCanvasElement,
  rasterX: number,
  rasterY: number,
  level: number,
  settings: BrushSettings,
): Promise<void> {
  const pixelsPerUnit = levelPxPerUnit(level);
  const rect = { x: rasterX, y: rasterY, width: source.width, height: source.height };
  const worldRect = rasterRectToWorld(rasterX, rasterY, source.width, source.height, level);
  let sourcePixels: Uint8ClampedArray | null = null;
  const maskPixels = (): Uint8ClampedArray => {
    if (sourcePixels) return sourcePixels;
    const context = source.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not read the eraser stroke.");
    sourcePixels = context.getImageData(0, 0, source.width, source.height).data;
    return sourcePixels;
  };
  const eraseDrawing = drawingStore.existingKeysInRect(worldRect).length > 0 &&
    maskOverlapsVisibleDrawing(maskPixels, source.width, source.height, rasterX, rasterY, level);

  const photos = erasablePhotoTargets(Object.values(board.notes), rect, pixelsPerUnit)
    .filter(({ geometry }) => rasterMaskTouchesPhoto(maskPixels(), source.width, source.height, rasterX, rasterY, geometry, pixelsPerUnit));
  const photoUpdates = await Promise.all(photos.map(async ({ note }) => ({
    note,
    before: note.image!,
    after: await erasePhotoCopyOnWrite(note, source, rasterX, rasterY, settings.opacity, pixelsPerUnit),
  })));
  const changedPhotos = photoUpdates.filter((item): item is typeof item & { after: NonNullable<typeof item.after> } => item.after !== null);
  if (!eraseDrawing && changedPhotos.length === 0) return;

  const tileKeys = eraseDrawing ? affectedTileKeys(worldRect, level, "erase") : [];
  const before: TileSnapshot = tileKeys.length ? await drawingStore.snapshot(tileKeys) : new Map();
  let after: TileSnapshot = before;
  if (eraseDrawing) {
    const options = eraserCompositeOptions(settings);
    try {
      applyAcrossLevels(source, rasterX, rasterY, level, "erase", options.opacity);
      after = await drawingStore.snapshot(tileKeys);
    } catch (error) {
      await drawingStore.restore(before);
      throw error;
    }
  }

  for (const { note, after: nextImage } of changedPhotos) {
    updateNote(note.id, { image: nextImage });
  }
  pushDrawingHistory("Erase", before, after, changedPhotos.length ? {
    undo() {
      for (const { note, before: oldImage } of changedPhotos) {
        if (board.notes[note.id]?.type === "image") updateNote(note.id, { image: oldImage });
      }
    },
    redo() {
      for (const { note, after: nextImage } of changedPhotos) {
        if (board.notes[note.id]?.type === "image") updateNote(note.id, { image: nextImage! });
      }
    },
  } : undefined);
}

/** Does the eraser mask cover any visible drawing pixel? (Avoids empty "Erase" Undo steps.) */
function maskOverlapsVisibleDrawing(
  mask: () => Uint8ClampedArray,
  width: number,
  height: number,
  rasterX: number,
  rasterY: number,
  level: number,
): boolean {
  let drawing: Uint8ClampedArray;
  try {
    drawing = readCompositeRect(rasterX, rasterY, width, height, level).data;
  } catch {
    // Too large to check cheaply: erase anyway; untouched tiles stay identical.
    return true;
  }
  const alpha = mask();
  for (let offset = 3; offset < drawing.length; offset += 4) {
    if (drawing[offset]! > 0 && alpha[offset]! > 0) return true;
  }
  return false;
}
