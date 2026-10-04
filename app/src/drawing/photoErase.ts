import { attachmentUrl, importImageFile } from "../attachments/service";
import type { ImageRef } from "../attachments/types";
import { normalizeNoteScale, type Note } from "../model/note";
import { encodeRgbaPng } from "./png";
import { DRAW_PX_PER_UNIT, type BrushSettings } from "./types";

export const ERASER_GIF_TOOLTIP = "Erases drawings only. Right-click an image → Erase for pictures.";

export interface EraserCompositeOptions {
  mode: "destination-out";
  opacity: number;
}

/** The eraser always removes at full strength (debug 23 p.6); only size and hardness come from the brush. */
export function eraserCompositeOptions(_settings: BrushSettings): EraserCompositeOptions {
  return { mode: "destination-out", opacity: 1 };
}

export interface PhotoEraseGeometry {
  /** Display-space world rectangle after applying the note's uniform scale. */
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  flipX: boolean;
  flipY: boolean;
}

export interface RasterRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isErasablePhoto(note: Note): boolean {
  return note.type === "image" && Boolean(note.image) && note.image?.mime !== "image/gif";
}

/** Image nodes are rendered stretched to their world rect, then mirrored around its center. */
export function photoEraseGeometry(note: Note): PhotoEraseGeometry | null {
  if (!isErasablePhoto(note) || !note.image) return null;
  const scale = normalizeNoteScale(note.scale);
  const naturalWidth = note.image.naturalWidth;
  const naturalHeight = note.image.naturalHeight;
  if (!(naturalWidth > 0) || !(naturalHeight > 0) || !(note.width > 0)) return null;
  const localHeight = note.height ?? note.width * naturalHeight / naturalWidth;
  if (!(localHeight > 0)) return null;
  return {
    x: note.x,
    y: note.y,
    width: note.width * scale,
    height: localHeight * scale,
    naturalWidth,
    naturalHeight,
    flipX: note.flipX === true,
    flipY: note.flipY === true,
  };
}

/** Map a world point into source-image pixels, respecting the image node's mirror flags. */
export function worldPointToPhotoPixel(
  point: { x: number; y: number },
  geometry: PhotoEraseGeometry,
): { x: number; y: number } | null {
  const u = (point.x - geometry.x) / geometry.width;
  const v = (point.y - geometry.y) / geometry.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return {
    x: (geometry.flipX ? 1 - u : u) * geometry.naturalWidth,
    y: (geometry.flipY ? 1 - v : v) * geometry.naturalHeight,
  };
}

/**
 * Canvas affine transform for drawing a global-raster stroke mask onto an image's intrinsic pixels.
 * The mask raster is 20 px per world unit; node resize/scale and flip are incorporated here.
 */
export function photoMaskTransform(
  geometry: PhotoEraseGeometry,
  rasterX: number,
  rasterY: number,
  pixelsPerUnit = DRAW_PX_PER_UNIT,
): { a: number; d: number; e: number; f: number } {
  if (!(geometry.width > 0) || !(geometry.height > 0) || !(pixelsPerUnit > 0)) {
    throw new RangeError("Image erase mapping requires positive dimensions.");
  }
  const scaleX = geometry.naturalWidth / (geometry.width * pixelsPerUnit);
  const scaleY = geometry.naturalHeight / (geometry.height * pixelsPerUnit);
  return {
    a: geometry.flipX ? -scaleX : scaleX,
    d: geometry.flipY ? -scaleY : scaleY,
    e: geometry.flipX
      ? ((geometry.x + geometry.width) * pixelsPerUnit - rasterX) * scaleX
      : (rasterX - geometry.x * pixelsPerUnit) * scaleX,
    f: geometry.flipY
      ? ((geometry.y + geometry.height) * pixelsPerUnit - rasterY) * scaleY
      : (rasterY - geometry.y * pixelsPerUnit) * scaleY,
  };
}

export function photoIntersectsRasterRect(
  geometry: PhotoEraseGeometry,
  rect: RasterRect,
  pixelsPerUnit = DRAW_PX_PER_UNIT,
): boolean {
  const left = rect.x / pixelsPerUnit;
  const top = rect.y / pixelsPerUnit;
  const right = (rect.x + rect.width) / pixelsPerUnit;
  const bottom = (rect.y + rect.height) / pixelsPerUnit;
  return geometry.x < right && geometry.x + geometry.width > left &&
    geometry.y < bottom && geometry.y + geometry.height > top;
}

/** Keep only image notes whose world bounds intersect an eraser stroke; GIFs/other nodes are excluded. */
export function erasablePhotosInRasterRect(
  notes: Iterable<Note>,
  rect: RasterRect,
  pixelsPerUnit = DRAW_PX_PER_UNIT,
): { note: Note; geometry: PhotoEraseGeometry }[] {
  const result: { note: Note; geometry: PhotoEraseGeometry }[] = [];
  for (const note of notes) {
    const geometry = photoEraseGeometry(note);
    if (geometry && photoIntersectsRasterRect(geometry, rect, pixelsPerUnit)) result.push({ note, geometry });
  }
  return result;
}

/** Avoid copy-on-write when the stroke's actual non-transparent pixels miss a photo. */
export function rasterMaskTouchesPhoto(
  alpha: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  rasterX: number,
  rasterY: number,
  geometry: PhotoEraseGeometry,
  pixelsPerUnit = DRAW_PX_PER_UNIT,
): boolean {
  if (alpha.length !== maskWidth * maskHeight * 4) return false;
  const left = Math.max(0, Math.floor(geometry.x * pixelsPerUnit) - rasterX);
  const top = Math.max(0, Math.floor(geometry.y * pixelsPerUnit) - rasterY);
  const right = Math.min(maskWidth, Math.ceil((geometry.x + geometry.width) * pixelsPerUnit) - rasterX);
  const bottom = Math.min(maskHeight, Math.ceil((geometry.y + geometry.height) * pixelsPerUnit) - rasterY);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (alpha[(y * maskWidth + x) * 4 + 3] > 0) return true;
    }
  }
  return false;
}

/**
 * Create an immutable PNG copy of an image with the completed eraser stroke applied. The original
 * attachment is never edited, so history and project snapshots can keep referring to it.
 */
export async function erasePhotoCopyOnWrite(
  note: Note,
  sourceMask: HTMLCanvasElement,
  rasterX: number,
  rasterY: number,
  opacity: number,
  pixelsPerUnit = DRAW_PX_PER_UNIT,
): Promise<ImageRef | null> {
  const geometry = photoEraseGeometry(note);
  if (!geometry || !note.image) return null;
  if (sourceMask.width <= 0 || sourceMask.height <= 0 || opacity <= 0) return null;

  const url = attachmentUrl(note.image.file);
  if (!url) throw new Error(`Could not load image attachment: ${note.image.name ?? note.name}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load image attachment (${response.status}): ${note.image.name ?? note.name}`);
  const bitmap = await createImageBitmap(await response.blob());

  try {
    const canvas = document.createElement("canvas");
    canvas.width = geometry.naturalWidth;
    canvas.height = geometry.naturalHeight;
    // CPU-backed: toBlob of a GPU canvas waits for the next rendered frame.
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not prepare the erased image.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    context.save();
    context.globalCompositeOperation = "destination-out";
    context.globalAlpha = Math.max(0, Math.min(1, opacity));
    const transform = photoMaskTransform(geometry, rasterX, rasterY, pixelsPerUnit);
    context.setTransform(transform.a, 0, 0, transform.d, transform.e, transform.f);
    context.drawImage(sourceMask, 0, 0);
    context.restore();

    const blob = await canvasPng(canvas);
    const baseName = (note.image.name ?? note.name ?? "Image").replace(/\.[^.]*$/, "") || "Image";
    const imported = await importImageFile(new File([blob], `${baseName}.png`, { type: "image/png" }));
    if (!imported.ok) throw new Error(imported.error);
    return imported.image;
  } finally {
    bitmap.close();
  }
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  // Not canvas.toBlob: it waits for a rendered frame / idle time in Chromium (see png.ts).
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return Promise.reject(new Error("Could not encode the erased image as PNG."));
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return encodeRgbaPng(pixels.data, pixels.width, pixels.height);
}
