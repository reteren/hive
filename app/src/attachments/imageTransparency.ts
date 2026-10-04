import { attachmentUrl } from "./service";
import type { ImageRef } from "./types";

const transparencyByFile = new Map<string, Promise<boolean>>();
const SCAN_ROWS = 64;

/** Check an immutable image attachment once so an erased, invisible image can still be found. */
export function attachmentIsFullyTransparent(image: ImageRef): Promise<boolean> {
  const cached = transparencyByFile.get(image.file);
  if (cached) return cached;

  const pending = inspectAttachment(image).catch(() => false);
  transparencyByFile.set(image.file, pending);
  return pending;
}

/** Pure alpha check used by the attachment probe and its tests. */
export function hasVisibleAlpha(pixels: Uint8ClampedArray): boolean {
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset]! > 0) return true;
  }
  return false;
}

async function inspectAttachment(image: ImageRef): Promise<boolean> {
  const url = attachmentUrl(image.file);
  if (!url) return false;
  const response = await fetch(url);
  if (!response.ok) return false;

  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  try {
    canvas.width = bitmap.width;
    canvas.height = Math.min(bitmap.height, SCAN_ROWS);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || bitmap.width <= 0 || bitmap.height <= 0) return false;

    for (let top = 0; top < bitmap.height; top += SCAN_ROWS) {
      const rows = Math.min(SCAN_ROWS, bitmap.height - top);
      if (canvas.height !== rows) canvas.height = rows;
      context.clearRect(0, 0, canvas.width, rows);
      context.drawImage(bitmap, 0, top, bitmap.width, rows, 0, 0, bitmap.width, rows);
      if (hasVisibleAlpha(context.getImageData(0, 0, bitmap.width, rows).data)) return false;
    }
    return true;
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
