import {
  AUDIO_MIME_TYPES,
  MEDIA_LIMIT_BYTES,
  PDF_MIME_TYPES,
  TEXT_FORMAT_LANGUAGES,
  VIDEO_MIME_TYPES,
  type MediaRef,
} from "../attachments/types";

export type FormatNodeKind = "pdf" | "format";

/** PDF files and the explicitly supported editable text formats this feature accepts. */
export function isFormatMediaKind(kind: unknown): kind is "pdf" | "text" {
  return kind === "pdf" || kind === "text";
}

export function formatNodeKind(media: Pick<MediaRef, "kind">): FormatNodeKind | null {
  if (media.kind === "pdf") return "pdf";
  return media.kind === "text" ? "format" : null;
}

export function mediaExtension(media: Pick<MediaRef, "file" | "name">): string {
  const candidate = media.name?.trim().replaceAll("\\", "/").split("/").at(-1) ?? media.file;
  const extension = candidate.split(".").at(-1)?.toLowerCase() ?? "";
  return /^[a-z0-9]{1,8}$/.test(extension) ? extension : "";
}

export function formatLanguageForExtension(extension: string): "markdown" | "javascript" | "css" | "html" | "plain" {
  const normalized = extension.toLowerCase().replace(/^\./, "");
  const language = TEXT_FORMAT_LANGUAGES[normalized as keyof typeof TEXT_FORMAT_LANGUAGES];
  if (language === "markdown") return "markdown";
  if (language === "javascript" || language === "typescript") return "javascript";
  if (language === "css") return "css";
  if (language === "html") return "html";
  // Other file types deliberately stay plain until their CodeMirror package is installed.
  return "plain";
}

export function hasUnsavedFormatChanges(draft: string, saved: string): boolean {
  return draft !== saved;
}

export interface PdfFrameMetrics {
  /** Fixed CSS dimensions used to rasterize the PDF above the node's normal resolution. */
  width: number;
  height: number;
  /** Constant raster oversampling factor, independent of camera zoom and note scale. */
  scale: number;
  /** Applied to the frame so its final node-space size remains unchanged. */
  inverseScale: number;
}

export const PDF_RENDER_OVERSAMPLE = 2;
export const PDF_ZOOM_MIN = 50;
export const PDF_ZOOM_MAX = 300;
export const PDF_ZOOM_STEP = 10;
export const PDF_ZOOM_DEFAULT = 100;

/** An absent zoom means the viewer should fit the document to the node width. */
export function normalizePdfZoom(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const clamped = Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, value));
  return Math.round(clamped / PDF_ZOOM_STEP) * PDF_ZOOM_STEP;
}

export function pdfZoomLabel(value: unknown): string {
  const normalized = normalizePdfZoom(value);
  return normalized === undefined ? "Fit" : `${normalized}%`;
}

export function stepPdfZoom(value: unknown, direction: -1 | 1): number {
  const current = normalizePdfZoom(value) ?? PDF_ZOOM_DEFAULT;
  return normalizePdfZoom(current + direction * PDF_ZOOM_STEP) ?? PDF_ZOOM_DEFAULT;
}

/** Fit width and fixed PDF zoom depend only on the PDF control, never the board camera. */
export function pdfViewerSource(source: string, zoom: unknown): string {
  const base = source.split("#", 1)[0] ?? "";
  if (!base) return "";
  const normalized = normalizePdfZoom(zoom);
  return `${base}#toolbar=0&navpanes=0&zoom=${normalized ?? "page-width"}`;
}

/**
 * Rasterize PDF content at a fixed oversampled size, then counter-scale it
 * inside the node. Board and note transforms scale the iframe like any other
 * node, so camera movement never changes its internal zoom or layout.
 */
export function pdfFrameMetrics(width: number, height: number): PdfFrameMetrics {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const scale = PDF_RENDER_OVERSAMPLE;

  return {
    width: safeWidth * scale,
    height: safeHeight * scale,
    scale,
    inverseScale: 1 / scale,
  };
}

/** Validate media references at persistence boundaries before they reach the board model. */
export function parseMediaRef(value: unknown): MediaRef | null {
  if (!isRecord(value) || typeof value.file !== "string" || typeof value.mime !== "string" ||
    !Number.isSafeInteger(value.size) || (value.size as number) < 0 ||
    value.name !== undefined && (typeof value.name !== "string" || value.name.length > 1024)) return null;

  const match = /^([0-9a-f]{64})\.([a-z0-9]{1,8})$/.exec(value.file);
  if (!match || !isMediaKind(value.kind) || (value.size as number) > MEDIA_LIMIT_BYTES[value.kind]) return null;
  const extension = match[2];

  if (value.kind === "pdf" && (extension !== "pdf" || !PDF_MIME_TYPES.includes(value.mime as (typeof PDF_MIME_TYPES)[number]))) return null;
  if (value.kind === "text" && !(extension in TEXT_FORMAT_LANGUAGES)) return null;
  if (value.kind === "audio" && !AUDIO_MIME_TYPES.includes(value.mime as (typeof AUDIO_MIME_TYPES)[number])) return null;
  if (value.kind === "video" && !VIDEO_MIME_TYPES.includes(value.mime as (typeof VIDEO_MIME_TYPES)[number])) return null;
  if (value.duration !== undefined && (typeof value.duration !== "number" || !Number.isFinite(value.duration) || value.duration < 0)) return null;
  if (value.naturalWidth !== undefined && (!Number.isSafeInteger(value.naturalWidth) || (value.naturalWidth as number) <= 0)) return null;
  if (value.naturalHeight !== undefined && (!Number.isSafeInteger(value.naturalHeight) || (value.naturalHeight as number) <= 0)) return null;

  return {
    file: value.file,
    mime: value.mime,
    size: value.size as number,
    kind: value.kind,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.duration === "number" ? { duration: value.duration } : {}),
    ...(typeof value.naturalWidth === "number" ? { naturalWidth: value.naturalWidth } : {}),
    ...(typeof value.naturalHeight === "number" ? { naturalHeight: value.naturalHeight } : {}),
  };
}

function isMediaKind(value: unknown): value is MediaRef["kind"] {
  return value === "pdf" || value === "text" || value === "audio" || value === "video";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
