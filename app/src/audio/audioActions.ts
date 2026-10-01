import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { camera, pointer, viewport } from "../board/camera.svelte";
import { screenToWorld, type Point } from "../board/cameraMath";
import { dispatchImagePaste, registerImagePasteHandler } from "../attachments/pasteDispatch";
import {
  importMediaFile,
  importMediaPath,
  mediaKindForFile,
  mediaKindForPath,
  registerFileDropHandler,
  reportImportError,
  type MediaImportResult,
} from "../attachments/service";
import { AUDIO_MIME_TYPES, IMAGE_MIME_TYPES } from "../attachments/types";
import { createAudioNotes } from "../notes/noteCommands";
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
  return importResults(paths.map((path) => () => importMediaPath(path)), center);
}

async function importAudioFiles(files: readonly File[], center: Point): Promise<boolean> {
  return importResults(files.map((file) => () => importMediaFile(file)), center);
}

async function importResults(
  importers: readonly (() => Promise<MediaImportResult>)[],
  center: Point,
): Promise<boolean> {
  if (importers.length === 0) return false;
  const results = await Promise.all(importers.map(async (importer): Promise<MediaImportResult> => {
    try {
      return await importer();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  const media = results.flatMap((result) => result.ok && result.media.kind === "audio" ? [result.media] : []);
  const errors = results.flatMap((result) => result.ok
    ? result.media.kind === "audio" ? [] : ["The selected file is not audio."]
    : [result.error]);
  if (media.length > 0) createAudioNotes(media, center);
  for (const error of errors) reportImportError(error);
  return media.length > 0;
}
