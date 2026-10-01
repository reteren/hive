import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { project } from "../project/project.svelte";
import { showLinkStatus } from "../links-in-text/contextMenu.svelte";
import {
  AUDIO_MIME_TYPES,
  IMAGE_MIME_TYPES,
  MEDIA_LIMIT_BYTES,
  PDF_MIME_TYPES,
  TEXT_FORMAT_LANGUAGES,
  VIDEO_MIME_TYPES,
  type AttachmentRef,
  type ImageRef,
  type MediaKind,
  type MediaRef,
  type TextFormatExtension,
} from "./types";

export type ImportResult = { ok: true; image: ImageRef } | { ok: false; error: string };
export type MediaImportResult = { ok: true; media: MediaRef } | { ok: false; error: string };

export type FileDropHandler = (
  paths: string[],
  target: Element | null,
  client: { x: number; y: number },
) => boolean;

const MAX_IMAGE_BYTES = 200 * 1024 * 1024;
const FORMATS = ["PNG", "JPEG", "GIF", "WebP", "BMP"] as const;
const EXTENSION_BY_MIME: Record<(typeof IMAGE_MIME_TYPES)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
};

interface StoredAttachment {
  file: string;
  mime: string;
  size: number;
  name?: string;
  kind?: MediaKind | "image";
}

const browserAttachments = new Map<string, string>();
const dropHandlers: { priority: number; sequence: number; handler: FileDropHandler }[] = [];
let nextHandlerSequence = 0;

/** Store an image from clipboard or browser File input and read dimensions before exposing it. */
export async function importImageFile(file: File): Promise<ImportResult> {
  try {
    if (!file || typeof file.arrayBuffer !== "function") return { ok: false, error: "The image file could not be read." };
    if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "Image exceeds the 200 MB limit." };

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, error: "Image exceeds the 200 MB limit." };
    const mime = detectImageMime(bytes) ?? null;
    if (!mime) return { ok: false, error: unsupportedType(file.name) };

    // Decode these exact bytes before asking the backend to persist them. A corrupt image never
    // produces a usable ImageRef or a partially created board node.
    const natural = await readNaturalSize(new Blob([bytes], { type: mime }));
    const name = file.name?.trim() || undefined;

    if (isTauri()) {
      const stored = await invoke<StoredAttachment>("attachment_import_bytes", {
        bytes: Array.from(bytes),
        name: name ?? null,
        mime,
      });
      return { ok: true, image: { ...stored, ...natural } };
    }

    const hash = await sha256(bytes);
    const extension = EXTENSION_BY_MIME[mime];
    const storedName = `${hash}.${extension}`;
    if (!browserAttachments.has(storedName)) {
      browserAttachments.set(storedName, URL.createObjectURL(new Blob([bytes], { type: mime })));
    }
    return {
      ok: true,
      image: { file: storedName, mime, size: bytes.byteLength, ...(name ? { name } : {}), ...natural },
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Import a dropped or selected desktop path through Hive's validated, content-addressed store. */
export async function importImagePath(path: string): Promise<ImportResult> {
  if (!isTauri()) return { ok: false, error: "Importing an image path is available in the desktop app." };
  try {
    const stored = await invoke<StoredAttachment>("attachment_import_path", { path });
    const directory = await invoke<string>("attachment_directory");
    const source = convertFileSrc(joinPath(directory, stored.file));
    const natural = await readNaturalSizeFromUrl(source);
    return { ok: true, image: { ...stored, ...natural } };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Import PDF, supported text, audio, or video from a native file path. */
export async function importMediaPath(path: string): Promise<MediaImportResult> {
  if (!isTauri()) return { ok: false, error: "Importing a file path is available in the desktop app." };
  try {
    const kindHint = mediaKindForPath(path);
    const stored = await invoke<StoredAttachment>("attachment_import_path", { path, kindHint });
    const kind = stored.kind ?? kindHint;
    if (!kind || kind === "image") return { ok: false, error: "The selected file is not a supported media file." };
    return { ok: true, media: await makeMediaRef(stored, kind) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Import supported non-image media from a browser File or clipboard file. */
export async function importMediaFile(file: File): Promise<MediaImportResult> {
  try {
    if (!file || typeof file.arrayBuffer !== "function") return { ok: false, error: "The file could not be read." };
    const hintedKind = mediaKindForFile(file);
    if (hintedKind && file.size > MEDIA_LIMIT_BYTES[hintedKind]) {
      return { ok: false, error: mediaLimitError(hintedKind) };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return await importMediaBytes(bytes, file.name, file.type);
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Store the recorder output as an immutable audio attachment. */
export async function importRecording(bytes: Uint8Array, mime: string, name: string): Promise<MediaImportResult> {
  return importMediaBytes(bytes, name, mime, "audio");
}

/** Save a Format node's edited text as a new immutable project attachment. */
export async function saveTextAttachment(text: string, previous: MediaRef): Promise<MediaImportResult> {
  if (previous.kind !== "text") return { ok: false, error: "Only text attachments can be saved as text." };
  const extension = textExtension(previous.file) ?? textExtension(previous.name ?? "");
  if (!extension) return { ok: false, error: "The text file extension is not supported." };

  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MEDIA_LIMIT_BYTES.text) return { ok: false, error: "Text file exceeds the 200 MB limit." };

  try {
    const name = previous.name ?? `Copy.${extension}`;
    if (isTauri()) {
      const stored = await invoke<StoredAttachment>("attachment_write_text", {
        text,
        extension,
        name,
      });
      return { ok: true, media: await makeMediaRef(stored, "text") };
    }

    return { ok: true, media: await browserMediaAttachment(bytes, name, "text", textMime(extension), extension) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Export an immutable attachment through the system save dialog. */
export async function exportAttachmentAs(ref: AttachmentRef, suggestedName: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}\.[a-z0-9]{1,8}$/.test(ref.file)) {
    reportImportError("The attachment reference is invalid.");
    return false;
  }
  try {
    if (!isTauri()) {
      const url = attachmentUrl(ref.file);
      if (!url || typeof document === "undefined") {
        reportImportError("This attachment is not available in the browser preview.");
        return false;
      }
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeSuggestedName(suggestedName, ref.file);
      anchor.click();
      return true;
    }

    const filename = safeSuggestedName(suggestedName, ref.file);
    const extension = filename.split(".").at(-1) ?? "";
    const destination = await save({
      title: "Export attachment",
      defaultPath: filename,
      filters: extension ? [{ name: "Attachment", extensions: [extension] }] : undefined,
    });
    if (!destination) return false;
    await invoke("attachment_export", { file: ref.file, destination });
    return true;
  } catch (error) {
    reportImportError(errorMessage(error));
    return false;
  }
}

/** Synchronous extension/MIME hint for file-drop routing. Contents are verified by the importer. */
export function mediaKindForPath(path: string): MediaKind | null {
  return mediaKindForName(path, "");
}

/** Synchronous extension/MIME hint for file-drop routing. Contents are verified by the importer. */
export function mediaKindForFile(file: File): MediaKind | null {
  const type = file.type.toLowerCase();
  if (AUDIO_MIME_TYPES.includes(type as (typeof AUDIO_MIME_TYPES)[number])) return "audio";
  if (VIDEO_MIME_TYPES.includes(type as (typeof VIDEO_MIME_TYPES)[number])) return "video";
  if (PDF_MIME_TYPES.includes(type as (typeof PDF_MIME_TYPES)[number])) return "pdf";
  return mediaKindForName(file.name, type);
}

/** Open the desktop image picker; cancellation is an empty list. */
export async function pickImageFiles(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    const selected = await open({
      title: "Choose image files",
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }],
    });
    return Array.isArray(selected) ? selected.filter((path) => typeof path === "string" && path.length > 0) : [];
  } catch (error) {
    reportImportError(errorMessage(error));
    return [];
  }
}

/** Convert the project-relative immutable name into a loadable asset URL. */
export function attachmentUrl(file: string): string {
  if (!/^[0-9a-f]{64}\.[a-z0-9]{1,8}$/i.test(file)) return "";
  if (!isTauri()) return browserAttachments.get(file) ?? "";
  if (!project.path) return "";
  return convertFileSrc(joinPath(project.path, `attachments/${file}`));
}

/** Show import errors in the existing board status surface. */
export function reportImportError(error: string): void {
  if (error.trim()) showLinkStatus(error.trim());
}

/** Register a file drop consumer. Higher priorities run first; returning true stops dispatch. */
export function registerFileDropHandler(priority: number, handler: FileDropHandler): () => void {
  const entry = { priority: Number.isFinite(priority) ? priority : 0, sequence: nextHandlerSequence++, handler };
  dropHandlers.push(entry);
  dropHandlers.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
  return () => {
    const index = dropHandlers.indexOf(entry);
    if (index >= 0) dropHandlers.splice(index, 1);
  };
}

/** Internal seam used by the single native drop listener. */
export function dispatchFileDrop(
  paths: string[],
  target: Element | null,
  client: { x: number; y: number },
): boolean {
  for (const { handler } of [...dropHandlers]) {
    try {
      if (handler(paths, target, client)) return true;
    } catch (error) {
      reportImportError(errorMessage(error));
    }
  }
  return false;
}

/** Return image files from a native paste event, preserving their clipboard order. */
export function clipboardImageFiles(event: ClipboardEvent): File[] {
  const files = event.clipboardData?.files;
  if (!files) return [];
  return Array.from(files).filter((file) => IMAGE_MIME_TYPES.includes(file.type as (typeof IMAGE_MIME_TYPES)[number]));
}

function detectImageMime(bytes: Uint8Array): (typeof IMAGE_MIME_TYPES)[number] | undefined {
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ascii(bytes, 0, 2) === "BM") return "image/bmp";
  return undefined;
}

function unsupportedType(name: string): string {
  const extension = name.split(/[./\\]/).at(-1)?.toLowerCase() || "unknown";
  return `Unsupported file type: ${extension}. Supported: ${FORMATS.join(", ")}`;
}

function matches(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

async function readNaturalSize(blob: Blob): Promise<{ naturalWidth: number; naturalHeight: number }> {
  if (typeof createImageBitmap !== "function") throw new Error("This image could not be decoded in this browser.");
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error("This image has invalid dimensions.");
    return { naturalWidth: bitmap.width, naturalHeight: bitmap.height };
  } finally {
    bitmap.close();
  }
}

function readNaturalSizeFromUrl(url: string): Promise<{ naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) reject(new Error("This image has invalid dimensions."));
      else resolve({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight });
    };
    image.onerror = () => reject(new Error("This image could not be decoded."));
    image.src = url;
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface MediaDescriptor {
  kind: MediaKind | "image";
  mime: string;
  extension: string;
}

async function importMediaBytes(
  bytes: Uint8Array,
  name: string,
  mimeHint: string,
  kindHint?: MediaKind,
): Promise<MediaImportResult> {
  const descriptor = detectMediaDescriptor(bytes, name, mimeHint, kindHint);
  if (!descriptor || descriptor.kind === "image") {
    return { ok: false, error: unsupportedMediaType(name) };
  }
  if (bytes.byteLength > MEDIA_LIMIT_BYTES[descriptor.kind]) {
    return { ok: false, error: `${descriptor.kind === "audio" || descriptor.kind === "video" ? "Media" : "File"} exceeds the ${descriptor.kind === "audio" || descriptor.kind === "video" ? "2 GB" : "200 MB"} limit.` };
  }
  if (descriptor.kind === "text" && !isValidUtf8(bytes)) {
    return { ok: false, error: "Text files must be valid UTF-8." };
  }

  try {
    const safeName = name.trim() || `Attachment.${descriptor.extension}`;
    if (isTauri()) {
      const stored = await invoke<StoredAttachment>("attachment_import_bytes", {
        bytes: Array.from(bytes),
        name: safeName,
        mime: mimeHint || descriptor.mime,
        kindHint: descriptor.kind,
      });
      const kind = stored.kind && stored.kind !== "image" ? stored.kind : descriptor.kind;
      return { ok: true, media: await makeMediaRef(stored, kind) };
    }

    return {
      ok: true,
      media: await browserMediaAttachment(bytes, safeName, descriptor.kind, descriptor.mime, descriptor.extension),
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function detectMediaDescriptor(
  bytes: Uint8Array,
  name: string,
  mimeHint: string,
  kindHint?: MediaKind,
): MediaDescriptor | undefined {
  const imageMime = detectImageMime(bytes);
  if (imageMime) return imageDescriptor(imageMime);
  if (startsWithAscii(bytes, "%PDF-")) return { kind: "pdf", mime: "application/pdf", extension: "pdf" };

  if (bytes.length >= 12 && startsWithAscii(bytes, "RIFF") && startsWithAscii(bytes.subarray(8), "WAVE")) {
    return { kind: "audio", mime: "audio/wav", extension: "wav" };
  }
  if (startsWithAscii(bytes, "OggS")) return { kind: "audio", mime: "audio/ogg", extension: "ogg" };
  if (startsWithAscii(bytes, "fLaC")) return { kind: "audio", mime: "audio/flac", extension: "flac" };
  if (startsWithAscii(bytes, "ID3") || isMp3FrameSync(bytes)) {
    return { kind: "audio", mime: "audio/mpeg", extension: "mp3" };
  }

  const extension = extensionFromName(name);
  const hintedKind = kindHint ?? kindFromMime(mimeHint) ?? mediaKindForName(name, "");
  if (hasMp4Ftyp(bytes)) {
    const brand = ascii(bytes, 8, 4);
    const audioBrand = ["M4A ", "M4B ", "M4P ", "F4A ", "F4B ", "mp4a"].includes(brand);
    if (audioBrand || hintedKind === "audio" || extension === "m4a" || extension === "m4b") {
      return { kind: "audio", mime: "audio/mp4", extension: extension === "m4b" ? "m4b" : "m4a" };
    }
    return { kind: "video", mime: "video/mp4", extension: "mp4" };
  }

  if (isEbml(bytes)) {
    if (hintedKind === "audio" || extension === "mka") {
      return { kind: "audio", mime: "audio/webm", extension: "webm" };
    }
    return { kind: "video", mime: "video/webm", extension: "webm" };
  }

  const supportedExtension = textExtension(name);
  if (supportedExtension) {
    return { kind: "text", mime: textMime(supportedExtension), extension: supportedExtension };
  }
  return undefined;
}

function imageDescriptor(mime: (typeof IMAGE_MIME_TYPES)[number]): MediaDescriptor {
  const extension: Record<(typeof IMAGE_MIME_TYPES)[number], string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
  };
  return { kind: "image", mime, extension: extension[mime] };
}

async function browserMediaAttachment(
  bytes: Uint8Array,
  name: string,
  kind: MediaKind,
  mime: string,
  extension: string,
): Promise<MediaRef> {
  const file = `${await sha256(bytes)}.${extension}`;
  if (!browserAttachments.has(file)) {
    browserAttachments.set(file, URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime })));
  }
  return { file, mime, size: bytes.byteLength, name, kind };
}

async function makeMediaRef(stored: StoredAttachment, kind: MediaKind): Promise<MediaRef> {
  const media: MediaRef = {
    file: stored.file,
    mime: stored.mime,
    size: stored.size,
    ...(stored.name ? { name: stored.name } : {}),
    kind,
  };
  if (kind !== "audio" && kind !== "video") return media;
  const metadata = await readMediaMetadata(attachmentUrl(stored.file), kind);
  return { ...media, ...metadata };
}

function readMediaMetadata(url: string, kind: "audio" | "video"): Promise<Pick<MediaRef, "duration" | "naturalWidth" | "naturalHeight">> {
  if (!url || typeof document === "undefined" || typeof window === "undefined") return Promise.resolve({});
  return new Promise((resolve) => {
    const element = document.createElement(kind);
    const finish = () => {
      const metadata = {
        ...(Number.isFinite(element.duration) && element.duration > 0 ? { duration: element.duration } : {}),
        ...(kind === "video" && (element as HTMLVideoElement).videoWidth > 0 && (element as HTMLVideoElement).videoHeight > 0
          ? { naturalWidth: (element as HTMLVideoElement).videoWidth, naturalHeight: (element as HTMLVideoElement).videoHeight }
          : {}),
      };
      element.removeAttribute("src");
      element.load();
      resolve(metadata);
    };
    const timeout = window.setTimeout(finish, 4_000);
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      finish();
    };
    element.onerror = () => {
      window.clearTimeout(timeout);
      finish();
    };
    element.src = url;
  });
}

function mediaKindForName(name: string, mime: string): MediaKind | null {
  const hinted = kindFromMime(mime);
  if (hinted) return hinted;
  const extension = extensionFromName(name);
  if (extension === "pdf") return "pdf";
  if (textExtension(name)) return "text";
  if (["mp3", "wav", "ogg", "oga", "flac", "m4a", "m4b", "mka"].includes(extension)) return "audio";
  if (["mp4", "mov", "mkv", "webm"].includes(extension)) return "video";
  return null;
}

function kindFromMime(mime: string): MediaKind | null {
  const normalized = mime.toLowerCase().split(";", 1)[0].trim();
  if (PDF_MIME_TYPES.includes(normalized as (typeof PDF_MIME_TYPES)[number])) return "pdf";
  if (AUDIO_MIME_TYPES.includes(normalized as (typeof AUDIO_MIME_TYPES)[number])) return "audio";
  if (VIDEO_MIME_TYPES.includes(normalized as (typeof VIDEO_MIME_TYPES)[number])) return "video";
  return null;
}

function textExtension(name: string): TextFormatExtension | null {
  const extension = extensionFromName(name) as TextFormatExtension;
  return Object.prototype.hasOwnProperty.call(TEXT_FORMAT_LANGUAGES, extension) ? extension : null;
}

function extensionFromName(name: string): string {
  return name.split(/[./\\]/).at(-1)?.toLowerCase() ?? "";
}

function textMime(extension: TextFormatExtension): string {
  return extension === "json" ? "application/json" : "text/plain";
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function startsWithAscii(bytes: Uint8Array, signature: string): boolean {
  if (bytes.length < signature.length) return false;
  for (let index = 0; index < signature.length; index++) {
    if (bytes[index] !== signature.charCodeAt(index)) return false;
  }
  return true;
}

function hasMp4Ftyp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && startsWithAscii(bytes.subarray(4), "ftyp");
}

function isEbml(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

function isMp3FrameSync(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

function unsupportedMediaType(name: string): string {
  const extension = extensionFromName(name) || "unknown";
  return `Unsupported file type: ${extension}. Supported: PDF, text formats, MP3, WAV, OGG, FLAC, M4A, MP4, WebM`;
}

function mediaLimitError(kind: MediaKind): string {
  return `${kind === "audio" || kind === "video" ? "Media" : "File"} exceeds the ${kind === "audio" || kind === "video" ? "2 GB" : "200 MB"} limit.`;
}

function safeSuggestedName(name: string, fallback: string): string {
  const leaf = name.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim();
  return leaf || fallback;
}

function joinPath(directory: string, child: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory.replace(/[\\/]+$/, "")}${separator}${child.replace(/[\\/]+/g, separator)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
