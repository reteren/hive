import { IMAGE_MIME_TYPES, isSafeAttachmentName, type ImageRef } from "../attachments/types";
import { PX_PER_UNIT } from "../board/cameraMath";
import type { Note } from "../model/note";

export const MIN_INITIAL_IMAGE_SIDE = 6;
export const MAX_INITIAL_IMAGE_SIDE = 40;
export const MIN_RESIZED_IMAGE_SIDE = 4;
export const MIN_IMAGE_OPACITY = 0.1;
export const MAX_IMAGE_OPACITY = 1;
export const IMAGE_OPACITY_STEP = 0.05;

export interface ImageSize {
  width: number;
  height: number;
}

/** Snap UI changes to the opacity slider's 5% steps and keep the supported range. */
export function clampImageOpacity(value: number): number {
  const finite = Number.isFinite(value) ? value : MAX_IMAGE_OPACITY;
  const bounded = Math.min(MAX_IMAGE_OPACITY, Math.max(MIN_IMAGE_OPACITY, finite));
  return Number((Math.round(bounded / IMAGE_OPACITY_STEP) * IMAGE_OPACITY_STEP).toFixed(2));
}

/** Normalize a persisted value; invalid types are ignored and out-of-range values are clamped. */
export function normalizeImageOpacity(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? clampImageOpacity(value) : undefined;
}

/** MediaSlider's 0–90 range maps to image opacity from 10% through 100%. */
export function imageOpacityFromSliderValue(value: number): number {
  const sliderValue = Number.isFinite(value) ? Math.min(90, Math.max(0, Math.round(value / 5) * 5)) : 90;
  return clampImageOpacity((sliderValue + 10) / 100);
}

export function imageOpacitySliderValue(value: number): number {
  return Math.round(clampImageOpacity(value) * 100) - 10;
}

/** Keep the imported aspect ratio, using native pixel dimensions as board units at 10 px/u. */
export function initialImageSize(
  image: Pick<ImageRef, "naturalWidth" | "naturalHeight">,
  pxPerUnit = PX_PER_UNIT,
): ImageSize {
  const scale = Number.isFinite(pxPerUnit) && pxPerUnit > 0 ? pxPerUnit : PX_PER_UNIT;
  const naturalWidth = Number.isFinite(image.naturalWidth) && image.naturalWidth > 0 ? image.naturalWidth / scale : 1;
  const naturalHeight = Number.isFinite(image.naturalHeight) && image.naturalHeight > 0 ? image.naturalHeight / scale : 1;
  const longestSide = Math.max(naturalWidth, naturalHeight);
  const factor = longestSide < MIN_INITIAL_IMAGE_SIDE
    ? MIN_INITIAL_IMAGE_SIDE / longestSide
    : longestSide > MAX_INITIAL_IMAGE_SIDE
      ? MAX_INITIAL_IMAGE_SIDE / longestSide
      : 1;
  return { width: naturalWidth * factor, height: naturalHeight * factor };
}

/** Strip the path and final extension; clipboard images without an original name become "Image". */
export function imageNodeName(name?: string): string {
  const fileName = name?.trim().replaceAll("\\", "/").split("/").at(-1)?.trim() ?? "";
  const withoutExtension = fileName.replace(/\.[^.]*$/, "").trim();
  return withoutExtension || "Image";
}

export function imageFirstOrder<T extends Pick<Note, "type">>(
  order: readonly string[],
  notes: Readonly<Record<string, T | undefined>>,
): string[] {
  const images: string[] = [];
  const others: string[] = [];
  for (const id of order) {
    (notes[id]?.type === "image" ? images : others).push(id);
  }
  return [...images, ...others];
}

const EXTENSION_MIME: Record<string, (typeof IMAGE_MIME_TYPES)[number]> = {
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Validate and clone persisted image metadata before it reaches board state. */
export function parseImageRef(value: unknown): ImageRef | null {
  if (!isRecord(value) || typeof value.file !== "string" || typeof value.mime !== "string" ||
    !IMAGE_MIME_TYPES.includes(value.mime as (typeof IMAGE_MIME_TYPES)[number]) ||
    !Number.isSafeInteger(value.size) || (value.size as number) < 0 ||
    !Number.isSafeInteger(value.naturalWidth) || (value.naturalWidth as number) <= 0 ||
    !Number.isSafeInteger(value.naturalHeight) || (value.naturalHeight as number) <= 0 ||
    value.name !== undefined && (typeof value.name !== "string" || value.name.length > 1024)) return null;

  if (!isSafeAttachmentName(value.file)) return null;
  const extension = value.file.slice(value.file.lastIndexOf(".") + 1).toLowerCase();
  if (EXTENSION_MIME[extension] !== value.mime) return null;
  return {
    file: value.file,
    mime: value.mime,
    size: value.size as number,
    naturalWidth: value.naturalWidth as number,
    naturalHeight: value.naturalHeight as number,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
