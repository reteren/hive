import { camera, viewport } from "../board/camera.svelte";
import { IMAGE_MIME_TYPES, type ImageRef } from "../attachments/types";
import {
  clipboardImageFiles,
  importImageFile,
  importImagePath,
  registerFileDropHandler,
  reportImportError,
  type FileDropHandler,
  type ImportResult,
} from "../attachments/service";
import { dispatchImagePaste, registerImagePasteHandler } from "../attachments/pasteDispatch";
import { screenToWorld, type Point } from "../board/cameraMath";
import { createImageNotes } from "../notes/noteCommands";

const IMAGE_EXTENSION: Record<(typeof IMAGE_MIME_TYPES)[number], string> = {
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function importImagePaths(paths: readonly string[], center: Point): Promise<boolean> {
  return runImageImportBatch(paths, importImagePath, center);
}

export async function importImageFiles(files: readonly File[], center: Point): Promise<boolean> {
  return runImageImportBatch(files, importImageFile, center);
}

/** Import the entire gesture first, then create one undoable batch only if every import succeeded. */
export async function runImageImportBatch<T>(
  inputs: readonly T[],
  importer: (input: T) => Promise<ImportResult>,
  center: Point,
  create: (images: readonly ImageRef[], center: Point) => unknown = createImageNotes,
  onError: (error: string) => void = reportImportError,
): Promise<boolean> {
  if (inputs.length === 0) return false;
  let results: ImportResult[];
  try {
    results = await Promise.all(inputs.map((input) => importer(input)));
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error));
    return false;
  }
  const failed = results.find((result) => !result.ok);
  if (failed && !failed.ok) {
    onError(failed.error);
    return false;
  }
  const images = results.flatMap((result) => result.ok ? [result.image] : []);
  if (images.length !== inputs.length) return false;
  create(images, center);
  return true;
}

export async function importClipboardItems(items: readonly ClipboardItem[]): Promise<File[]> {
  const files: File[] = [];
  for (const item of items) {
    const mime = IMAGE_MIME_TYPES.find((candidate) => item.types.includes(candidate));
    if (!mime) continue;
    try {
      const blob = await item.getType(mime);
      files.push(new File([blob], `Image.${IMAGE_EXTENSION[mime]}`, { type: mime }));
    } catch {
      // A browser may advertise an image format but refuse to expose its bytes.
    }
  }
  return files;
}

export function imageDropHandler(paths: string[], target: Element | null, client: Point): boolean {
  if (paths.length === 0 || target?.closest("[data-note-id]")) return false;
  const boardElement = document.querySelector<HTMLElement>(".board");
  if (!boardElement) return false;
  const bounds = boardElement.getBoundingClientRect();
  const point = screenToWorld(camera, viewport, { x: client.x - bounds.left, y: client.y - bounds.top });
  void importImagePaths(paths, point);
  return true;
}

/** Board fallback (priority 0) for image paste; Tierlist rows and the text editor take precedence. */
export function registerImagePasteToBoard(): () => void {
  return registerImagePasteHandler(0, (files) => {
    void importImageFiles(files, viewportCenter());
    return true;
  });
}

export function registerImageDropHandler(): () => void {
  return registerFileDropHandler(0, imageDropHandler satisfies FileDropHandler);
}

/** Native paste surfaces that bypass the keyboard command still use the same image import path. */
export function handleBoardImagePaste(event: ClipboardEvent): void {
  const activeElement = document.activeElement;
  if (activeElement instanceof Element && activeElement.closest("input, textarea, [contenteditable='true'], .cm-editor")) return;
  const files = clipboardImageFiles(event);
  if (files.length === 0) return;
  event.preventDefault();
  dispatchImagePaste(files);
}

export function viewportCenter(): Point {
  return { x: camera.x, y: camera.y };
}
