import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { project } from "../project/project.svelte";
import { showLinkStatus } from "../links-in-text/contextMenu.svelte";
import { IMAGE_MIME_TYPES, type ImageRef } from "./types";

export type ImportResult = { ok: true; image: ImageRef } | { ok: false; error: string };

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
  mime: (typeof IMAGE_MIME_TYPES)[number];
  size: number;
  name?: string;
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

function joinPath(directory: string, child: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory.replace(/[\\/]+$/, "")}${separator}${child.replace(/[\\/]+/g, separator)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
