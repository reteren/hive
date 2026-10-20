import { camera, pointer, viewport } from "../board/camera.svelte";
import { IMAGE_MIME_TYPES, type ImageRef } from "../attachments/types";
import {
  clipboardImageFiles,
  importImageFile,
  importImagePathBatch,
  importWasCancelled,
  addImportProgress,
  registerFileDropHandler,
  reportImportError,
  withImportProgress,
  mapConcurrent,
  type FileDropHandler,
  type ImportResult,
} from "../attachments/service";
import { dispatchImagePaste, registerImagePasteHandler } from "../attachments/pasteDispatch";
import { screenToWorld, type Point } from "../board/cameraMath";
import { createImageNotesAsync } from "../notes/noteCommands";
import { t } from "../i18n/i18n.svelte";

const IMAGE_EXTENSION: Record<(typeof IMAGE_MIME_TYPES)[number], string> = {
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function importImagePaths(paths: readonly string[], center: Point): Promise<boolean> {
  if (paths.length === 0) return false;
  try {
    return await withImportProgress(t("Import images"), paths.length, async (run) => {
      const images: ImageRef[] = [];
      const errors: string[] = [];
      for (let offset = 0; offset < paths.length; offset += 200) {
        if (importWasCancelled(run.id)) break;
        const chunk = paths.slice(offset, offset + 200);
        const results = await importImagePathBatch(chunk, run.id);
        for (const result of results) {
          if (result.ok) images.push(result.image);
          else errors.push(result.error);
        }
        if (importWasCancelled(run.id) || results.length < chunk.length) break;
        await yieldToUi();
      }
      if (errors.length > 0 && !importWasCancelled(run.id)) {
        reportImportError(errors[0]!);
        return false;
      }
      if (images.length === 0) {
        if (errors[0]) reportImportError(errors[0]);
        return false;
      }
      await createImageNotesAsync(images, center);
      return true;
    });
  } catch (error) {
    reportImportError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function importImageFiles(files: readonly File[], center: Point): Promise<boolean> {
  return runImageImportBatch(files, importImageFile, center);
}

/** Import the entire gesture first, then create one undoable batch only if every import succeeded. */
export async function runImageImportBatch<T>(
  inputs: readonly T[],
  importer: (input: T) => Promise<ImportResult>,
  center: Point,
  create: (images: readonly ImageRef[], center: Point) => unknown = createImageNotesAsync,
  onError: (error: string) => void = reportImportError,
): Promise<boolean> {
  if (inputs.length === 0) return false;
  try {
    return await withImportProgress(t("Import images"), inputs.length, async (run) => {
      const images: ImageRef[] = [];
      const errors: string[] = [];
      for (let offset = 0; offset < inputs.length; offset += 200) {
        if (importWasCancelled(run.id)) break;
        const chunk = inputs.slice(offset, offset + 200);
        const results = await mapConcurrent(chunk, 8, async (input): Promise<ImportResult> => {
          try { return await importer(input); }
          catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
        });
        const successes = results.flatMap((result) => result.ok ? [result.image] : []);
        const failures = results.flatMap((result) => result.ok ? [] : [result.error]);
        images.push(...successes);
        errors.push(...failures);
        addImportProgress(run.id, results.length, successes.length, failures.length);
        await yieldToUi();
      }
      if (errors.length > 0 && !importWasCancelled(run.id)) {
        onError(errors[0]!);
        return false;
      }
      if (images.length === 0) return false;
      await create(images, center);
      return true;
    });
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function yieldToUi(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
    void importImageFiles(files, imagePasteOrigin(pointer.world, viewportCenter()));
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

/** Place pasted images under the last in-board pointer, otherwise at the viewport centre. */
export function imagePasteOrigin(pointerWorld: Point | null, fallback: Point): Point {
  return pointerWorld ? { ...pointerWorld } : { ...fallback };
}
