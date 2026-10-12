import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { camera, pointer, viewport } from "../board/camera.svelte";
import { screenToWorld, type Point } from "../board/cameraMath";
import { dispatchImagePaste, registerImagePasteHandler } from "../attachments/pasteDispatch";
import {
  importMediaFile,
  importMediaPathBatch,
  importWasCancelled,
  addImportProgress,
  mapConcurrent,
  mediaKindForFile,
  mediaKindForPath,
  registerFileDropHandler,
  reportImportError,
  type MediaImportResult,
  withImportProgress,
} from "../attachments/service";
import { AUDIO_MIME_TYPES, IMAGE_MIME_TYPES, type MediaRef } from "../attachments/types";
import { createAudioNotesAsync } from "../notes/noteCommands";
import { createDictaphoneNote } from "./recording.svelte";

const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "oga", "flac", "m4a", "m4b", "mka", "weba"];
const AUDIO_EXTENSION_BY_MIME: Record<(typeof AUDIO_MIME_TYPES)[number], string> = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/flac": "flac",
};

export async function chooseAudioFile(center: Point): Promise<boolean> {
  if (!isTauri()) {
    reportImportError("Choose an audio file from the desktop app.");
    return false;
  }
  try {
    const path = await open({
      title: "Choose an audio file",
      multiple: false,
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    if (typeof path !== "string" || path.length === 0) return false;
    return importAudioPaths([path], center);
  } catch (error) {
    reportImportError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function importAudioFileFromBrowser(file: File, center: Point): Promise<boolean> {
  return importResults([() => importMediaFile(file)], center);
}

export function registerAudioDropHandler(): () => void {
  return registerFileDropHandler(5, (paths, target, client) => {
    if (target?.closest("[data-note-id]")) return false;
    const audioPaths = paths.filter((path) => mediaKindForPath(path) === "audio");
    if (audioPaths.length === 0) return false;

    const boardElement = document.querySelector<HTMLElement>(".board");
    if (!boardElement) return false;
    const bounds = boardElement.getBoundingClientRect();
    const point = screenToWorld(camera, viewport, { x: client.x - bounds.left, y: client.y - bounds.top });
    void importAudioPaths(audioPaths, point);
    if (audioPaths.length !== paths.length) reportImportError("Non-audio files in this drop were skipped.");
    return true;
  });
}

export function startAudioRecordingAt(center: Point): boolean {
  createDictaphoneNote(center);
  return true;
}

export async function importAudioClipboardItems(items: readonly ClipboardItem[]): Promise<File[]> {
  const files: File[] = [];
  for (const item of items) {
    const mime = AUDIO_MIME_TYPES.find((candidate) => item.types.includes(candidate));
    if (!mime) continue;
    try {
      const blob = await item.getType(mime);
      files.push(new File([blob], `Audio.${AUDIO_EXTENSION_BY_MIME[mime]}`, { type: mime }));
    } catch {
      // A clipboard may advertise a MIME type and still refuse to expose its bytes.
    }
  }
  return files;
}

export function registerAudioPasteHandler(): () => void {
  return registerImagePasteHandler(5, (files) => {
    const audioFiles = files.filter((file) => mediaKindForFile(file) === "audio");
    if (audioFiles.length === 0) return false;
    const imageFiles = files.filter((file) => IMAGE_MIME_TYPES.includes(file.type as (typeof IMAGE_MIME_TYPES)[number]));
    void importAudioFiles(audioFiles, pointer.world ? { ...pointer.world } : { x: camera.x, y: camera.y });
    if (imageFiles.length > 0) dispatchImagePaste(imageFiles);
    return true;
  });
}

export function handleBoardAudioPaste(event: ClipboardEvent): void {
  const activeElement = document.activeElement;
  if (activeElement instanceof Element && activeElement.closest("input, textarea, [contenteditable='true'], .cm-editor")) return;
  const audioFiles = Array.from(event.clipboardData?.files ?? []).filter((file) => mediaKindForFile(file) === "audio");
  if (audioFiles.length === 0) return;
  event.preventDefault();
  void importAudioFiles(audioFiles, pointer.world ? { ...pointer.world } : { x: camera.x, y: camera.y });
}

export async function importAudioPaths(paths: readonly string[], center: Point): Promise<boolean> {
  if (paths.length === 0) return false;
  try {
    return await withImportProgress("Import audio", paths.length, async (run) => {
      const media: MediaRef[] = [];
      const errors: string[] = [];
      for (let offset = 0; offset < paths.length; offset += 200) {
        if (importWasCancelled(run.id)) break;
        const chunk = paths.slice(offset, offset + 200);
        const results = await importMediaPathBatch(chunk, run.id, "audio");
        for (const result of results) {
          if (result.ok && result.media.kind === "audio") media.push(result.media);
          else errors.push(result.ok ? "The selected file is not audio." : result.error);
        }
        if (importWasCancelled(run.id) || results.length < chunk.length) break;
        await yieldToUi();
      }
      if (errors.length > 0 && !importWasCancelled(run.id)) {
        reportImportError(errors[0]!);
        return false;
      }
      if (media.length === 0) {
        if (errors[0]) reportImportError(errors[0]);
        return false;
      }
      await createAudioNotesAsync(media, center);
      return true;
    });
  } catch (error) {
    reportImportError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function importAudioFiles(files: readonly File[], center: Point): Promise<boolean> {
  return importResults(files.map((file) => () => importMediaFile(file)), center);
}

async function importResults(
  importers: readonly (() => Promise<MediaImportResult>)[],
  center: Point,
): Promise<boolean> {
  if (importers.length === 0) return false;
  try {
    return await withImportProgress("Import audio", importers.length, async (run) => {
      const media: MediaRef[] = [];
      const errors: string[] = [];
      for (let offset = 0; offset < importers.length; offset += 200) {
        if (importWasCancelled(run.id)) break;
        const chunk = importers.slice(offset, offset + 200);
        const results = await mapConcurrent(chunk, 8, async (importer): Promise<MediaImportResult> => {
          try { return await importer(); }
          catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
        });
        const succeeded = results.filter((result) => result.ok && result.media.kind === "audio").length;
        addImportProgress(run.id, results.length, succeeded, results.length - succeeded);
        for (const result of results) {
          if (result.ok && result.media.kind === "audio") media.push(result.media);
          else errors.push(result.ok ? "The selected file is not audio." : result.error);
        }
        await yieldToUi();
      }
      if (errors.length > 0 && !importWasCancelled(run.id)) {
        reportImportError(errors[0]!);
        return false;
      }
      if (media.length === 0) {
        if (errors[0]) reportImportError(errors[0]);
        return false;
      }
      await createAudioNotesAsync(media, center);
      return true;
    });
  } catch (error) {
    reportImportError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function yieldToUi(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
