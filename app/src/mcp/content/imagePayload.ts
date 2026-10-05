import { attachmentUrl } from "../../attachments/service";
import { IMAGE_MIME_TYPES, isSafeAttachmentName, type ImageRef } from "../../attachments/types";

/** Compact raster payload returned to MCP clients. */
export interface ImagePayload {
  file: string;
  mime: "image/png" | "image/jpeg";
  /** Base64 without a data: prefix. */
  data: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  /** Present for animated sources whose first frame was sent. */
  animated?: true;
}

export interface ImagePayloadOmission {
  file: string;
  reason: string;
}

export const MAX_CONTENT_IMAGE_BYTES = 6 * 1024 * 1024;
const SUPPORTED_INPUT_MIMES: readonly string[] = IMAGE_MIME_TYPES;

/** MIME inferred from a supported project attachment name. */
export function imageMimeForFile(file: string): (typeof IMAGE_MIME_TYPES)[number] | null {
  const extension = file.split(".").at(-1)?.toLowerCase();
  switch (extension) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    default: return null;
  }
}

/** Read a project attachment through hive's normal asset URL and convert it to a bounded raster. */
export async function attachmentImagePayload(
  image: Pick<ImageRef, "file" | "mime">,
  maxImagePx: number,
): Promise<ImagePayload> {
  if (!isSafeAttachmentName(image.file)) throw new Error("Invalid attachment name.");
  if (!SUPPORTED_INPUT_MIMES.includes(image.mime)) throw new Error("Unsupported image format.");
  validateMaxPx(maxImagePx);
  const url = attachmentUrl(image.file);
  if (!url) throw new Error("The image attachment URL is unavailable.");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The image attachment could not be loaded (HTTP ${response.status}).`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    return await imagePayloadFromSource(bitmap, image.file, bitmap.width, bitmap.height, maxImagePx, image.mime === "image/gif");
  } finally {
    bitmap.close();
  }
}

/** Shared file-based entry point used by content readers that have only an attachment basename. */
export async function imagePayloadFromFile(file: string, maxPx: number): Promise<ImagePayload> {
  const mime = imageMimeForFile(file);
  if (!mime) throw new Error("Unsupported image format.");
  return attachmentImagePayload({ file, mime }, maxPx);
}

/** Encode an already-rendered canvas; callers that need a custom size can scale before calling. */
export function imagePayloadFromCanvas(
  canvas: HTMLCanvasElement,
  file: string,
  originalWidth: number,
  originalHeight: number,
): ImagePayload {
  if (!Number.isSafeInteger(canvas.width) || canvas.width < 1 || !Number.isSafeInteger(canvas.height) || canvas.height < 1) {
    throw new Error("The image has invalid dimensions.");
  }
  if (!Number.isFinite(originalWidth) || originalWidth < 1 || !Number.isFinite(originalHeight) || originalHeight < 1) {
    throw new Error("The image has invalid dimensions.");
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas image conversion is unavailable.");
  const hasAlpha = canvasHasAlpha(context, canvas.width, canvas.height);
  const mime: ImagePayload["mime"] = hasAlpha ? "image/png" : "image/jpeg";
  const dataUrl = mime === "image/jpeg" ? canvas.toDataURL(mime, 0.85) : canvas.toDataURL(mime);
  const separator = dataUrl.indexOf(",");
  if (separator < 0) throw new Error("Canvas image encoding failed.");
  return {
    file,
    mime,
    data: dataUrl.slice(separator + 1),
    width: canvas.width,
    height: canvas.height,
    originalWidth: Math.round(originalWidth),
    originalHeight: Math.round(originalHeight),
    ...(imageMimeForFile(file) === "image/gif" ? { animated: true as const } : {}),
  };
}

/** Convert an already decoded image/video frame to PNG or JPEG within the requested pixel bound. */
export async function imagePayloadFromSource(
  source: CanvasImageSource,
  file: string,
  originalWidth: number,
  originalHeight: number,
  maxImagePx: number,
  animated = false,
): Promise<ImagePayload> {
  validateMaxPx(maxImagePx);
  if (!Number.isFinite(originalWidth) || originalWidth < 1 || !Number.isFinite(originalHeight) || originalHeight < 1) {
    throw new Error("The image has invalid dimensions.");
  }
  const scale = Math.min(1, maxImagePx / Math.max(originalWidth, originalHeight));
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas image conversion is unavailable.");
  context.drawImage(source, 0, 0, width, height);

  const hasAlpha = canvasHasAlpha(context, width, height);
  const mime: ImagePayload["mime"] = hasAlpha ? "image/png" : "image/jpeg";
  const blob = await canvasBlob(canvas, mime, mime === "image/jpeg" ? 0.85 : undefined);
  const payload: ImagePayload = {
    file,
    mime,
    data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
    width,
    height,
    originalWidth: Math.round(originalWidth),
    originalHeight: Math.round(originalHeight),
    ...(animated ? { animated: true as const } : {}),
  };
  return payload;
}

/** Keep the aggregate image data within the call budget by dropping largest payloads first. */
export function enforceImagePayloadBudget<T>(value: T, budget = MAX_CONTENT_IMAGE_BYTES): ImagePayloadOmission[] {
  if (!Number.isSafeInteger(budget) || budget < 0) throw new Error("Image payload budget must be a non-negative integer.");
  const candidates: { holder: Record<string, unknown> | unknown[]; key: string | number; image: ImagePayload; bytes: number }[] = [];
  collectImages(value, candidates);
  let total = candidates.reduce((sum, candidate) => sum + base64Bytes(candidate.image.data), 0);
  const omitted: ImagePayloadOmission[] = [];
  const largestFirst = [...candidates].sort((left, right) => right.bytes - left.bytes);
  for (const candidate of largestFirst) {
    if (total <= budget) break;
    if (Array.isArray(candidate.holder)) {
      const index = candidate.holder.indexOf(candidate.image);
      if (index !== -1) candidate.holder.splice(index, 1);
    } else {
      delete candidate.holder[candidate.key as string];
    }
    total -= candidate.bytes;
    omitted.push({ file: candidate.image.file, reason: "Dropped because image payloads exceeded the 6 MiB per-call budget." });
  }
  return omitted;
}

function collectImages(
  value: unknown,
  candidates: { holder: Record<string, unknown> | unknown[]; key: string | number; image: ImagePayload; bytes: number }[],
): void {
  if (!value || typeof value !== "object") return;
  const holder = value as Record<string, unknown> | unknown[];
  for (const [key, item] of Object.entries(holder)) {
    if (isImagePayload(item)) {
      candidates.push({ holder, key: Array.isArray(holder) ? Number(key) : key, image: item, bytes: base64Bytes(item.data) });
    } else {
      collectImages(item, candidates);
    }
  }
}

function isImagePayload(value: unknown): value is ImagePayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ImagePayload>;
  return typeof candidate.file === "string" && typeof candidate.data === "string" &&
    (candidate.mime === "image/png" || candidate.mime === "image/jpeg") &&
    typeof candidate.width === "number" && typeof candidate.height === "number";
}

function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(data.length * 3 / 4) - padding);
}

function validateMaxPx(maxImagePx: number): void {
  if (!Number.isSafeInteger(maxImagePx) || maxImagePx < 256 || maxImagePx > 2048) {
    throw new Error("maxImagePx must be an integer from 256 to 2048.");
  }
}

function canvasHasAlpha(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    const pixels = context.getImageData(0, 0, width, height).data;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 255) return true;
    return false;
  } catch {
    // Preserve transparency when pixel inspection is blocked by the WebView.
    return true;
  }
}

function canvasBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas image encoding failed.")), mime, quality);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
