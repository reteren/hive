import { attachmentUrl } from "./service";
import type { ImageRef } from "./types";

const transparencyByFile = new Map<string, Promise<boolean>>();
const PROBE_SIDE = 64;

/** Check an immutable image attachment once so an erased, invisible image can still be found. */
export function attachmentIsFullyTransparent(image: ImageRef): Promise<boolean> {
  const url = attachmentUrl(image.file);
  const key = `${url || image.file}`;
  const cached = transparencyByFile.get(key);
  if (cached) return cached;

  const pending = inspectAttachment(image, url).catch(() => false);
  transparencyByFile.set(key, pending);
  if (transparencyByFile.size > 256) transparencyByFile.delete(transparencyByFile.keys().next().value!);
  return pending;
}

/** Pure alpha check used by the attachment probe and its tests. */
export function hasVisibleAlpha(pixels: Uint8ClampedArray): boolean {
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset]! > 0) return true;
  }
  return false;
}

async function inspectAttachment(image: ImageRef, url: string): Promise<boolean> {
  if (!url) return false;
  const response = await fetch(url);
  if (!response.ok) return false;

  const width = Number.isFinite(image.naturalWidth) && image.naturalWidth > 0 ? image.naturalWidth : PROBE_SIDE;
  const height = Number.isFinite(image.naturalHeight) && image.naturalHeight > 0 ? image.naturalHeight : PROBE_SIDE;
  const scale = Math.min(1, PROBE_SIDE / width, PROBE_SIDE / height);
  const bitmap = await createImageBitmap(await response.blob(), {
    resizeWidth: Math.max(1, Math.round(width * scale)),
    resizeHeight: Math.max(1, Math.round(height * scale)),
    resizeQuality: "low",
  });
  const canvas = document.createElement("canvas");
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || bitmap.width <= 0 || bitmap.height <= 0) return false;
    context.drawImage(bitmap, 0, 0);
    return !hasVisibleAlpha(context.getImageData(0, 0, bitmap.width, bitmap.height).data);
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
