import { reportImportError } from "../attachments/service";
import { board, updateNote } from "../model/board.svelte";
import { drawingTools } from "./tools.svelte";
import { createStroke, type DrawStroke } from "./brush";
import { pushDrawingHistory, paintIntoTiles } from "./history";
import { drawingStore } from "./tileStore.svelte";
import { registerDrawTool } from "./toolRegistry";
import {
  DRAW_PX_PER_UNIT,
  DRAW_TILE_SIZE_PX,
  parseTileKey,
  type BrushSettings,
  type DrawPointerEvent,
  type DrawToolHandler,
  type TileKey,
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

/** The overlay badge used by toolbar/help UI; never route non-image objects into the photo path. */
export function erasablePhotoTargets(
  notes: Iterable<import("../model/note").Note>,
  stroke: RasterRect,
): { note: import("../model/note").Note; geometry: PhotoEraseGeometry }[] {
  return erasablePhotosInRasterRect(notes, stroke);
}

export function createEraserHandler(getSettings: () => BrushSettings = () => drawingTools.brush): DrawToolHandler {
  let stroke: DrawStroke | null = null;
  let strokeSettings: BrushSettings | null = null;
  let committing = false;

  function abandonStroke(): void {
    stroke?.dispose();
    stroke = null;
    strokeSettings = null;
  }

  return {
    down(event: DrawPointerEvent) {
      if (committing) return;
      abandonStroke();
      strokeSettings = { ...getSettings() };
      stroke = createStroke(strokeSettings, event.zoom);
      stroke.add(event.world, event.pressure);
    },
    move(event: DrawPointerEvent) {
      stroke?.add(event.world, event.pressure);
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
        current.dispose();
        return;
      }

      committing = true;
      void commitErase(finished.source, finished.rasterX, finished.rasterY, settings)
        .catch((error: unknown) => reportImportError(error instanceof Error ? error.message : String(error)))
        .finally(() => {
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

async function commitErase(source: HTMLCanvasElement, rasterX: number, rasterY: number, settings: BrushSettings): Promise<void> {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not read the eraser stroke.");
  const sourcePixels = context.getImageData(0, 0, source.width, source.height).data;
  const rect = { x: rasterX, y: rasterY, width: source.width, height: source.height };
  const worldRect = {
    x: rasterX / DRAW_PX_PER_UNIT,
    y: rasterY / DRAW_PX_PER_UNIT,
    width: source.width / DRAW_PX_PER_UNIT,
    height: source.height / DRAW_PX_PER_UNIT,
  };
  const existingKeys = drawingStore.keysInRect(worldRect, false);
  const eraseDrawing = existingKeys.length > 0 && rasterMaskOverlapsDrawing(sourcePixels, source.width, source.height, rasterX, rasterY, existingKeys);

  const photos = erasablePhotoTargets(Object.values(board.notes), rect)
    .filter(({ geometry }) => rasterMaskTouchesPhoto(sourcePixels, source.width, source.height, rasterX, rasterY, geometry));
  const photoUpdates = await Promise.all(photos.map(async ({ note }) => ({
    note,
    before: note.image!,
    after: await erasePhotoCopyOnWrite(note, source, rasterX, rasterY, settings.opacity),
  })));
  const changedPhotos = photoUpdates.filter((item): item is typeof item & { after: NonNullable<typeof item.after> } => item.after !== null);
  if (!eraseDrawing && changedPhotos.length === 0) return;

  const tileKeys = eraseDrawing ? drawingStore.keysInRect(worldRect, true) : [];
  const before: TileSnapshot = tileKeys.length ? await drawingStore.snapshot(tileKeys) : new Map();
  let after: TileSnapshot = before;
  if (eraseDrawing) {
    const options = eraserCompositeOptions(settings);
    try {
      paintIntoTiles(source, rasterX, rasterY, options.mode, options.opacity);
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

function rasterMaskOverlapsDrawing(
  mask: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  rasterX: number,
  rasterY: number,
  keys: readonly TileKey[],
): boolean {
  const maskRight = rasterX + maskWidth;
  const maskBottom = rasterY + maskHeight;
  for (const key of keys) {
    const tile = drawingStore.tile(key, false);
    const parsed = parseTileKey(key);
    const tileContext = tile?.getContext("2d", { willReadFrequently: true });
    if (!tile || !parsed || !tileContext) continue;
    const tileX = parsed.col * DRAW_TILE_SIZE_PX;
    const tileY = parsed.row * DRAW_TILE_SIZE_PX;
    const left = Math.max(rasterX, tileX);
    const top = Math.max(rasterY, tileY);
    const right = Math.min(maskRight, tileX + DRAW_TILE_SIZE_PX);
    const bottom = Math.min(maskBottom, tileY + DRAW_TILE_SIZE_PX);
    if (right <= left || bottom <= top) continue;
    const pixels = tileContext.getImageData(left - tileX, top - tileY, right - left, bottom - top).data;
    const width = right - left;
    const maskStartX = left - rasterX;
    const maskStartY = top - rasterY;
    for (let y = 0; y < bottom - top; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const drawingOffset = (y * width + x) * 4 + 3;
        const maskOffset = ((maskStartY + y) * maskWidth + maskStartX + x) * 4 + 3;
        if (pixels[drawingOffset] > 0 && mask[maskOffset] > 0) return true;
      }
    }
  }
  return false;
}
