import { IMAGE_MIME_TYPES, type ImageRef } from "../attachments/types";
import { PX_PER_UNIT } from "../board/cameraMath";
import type { Note } from "../model/note";

export const MIN_INITIAL_IMAGE_SIDE = 6;
export const MAX_INITIAL_IMAGE_SIDE = 40;
export const MIN_RESIZED_IMAGE_SIDE = 4;

export interface ImageSize {
  width: number;
  height: number;
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

  const match = /^([0-9a-f]{64})\.([a-z0-9]{1,8})$/.exec(value.file);
  if (!match || EXTENSION_MIME[match[2]] !== value.mime) return null;
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
