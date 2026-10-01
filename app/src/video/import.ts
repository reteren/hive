import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { camera, viewport } from "../board/camera.svelte";
import { screenToWorld, type Point } from "../board/cameraMath";
import { importMediaFile, importMediaPath, mediaKindForPath, registerFileDropHandler, reportImportError } from "../attachments/service";
import { createVideoNotes } from "./actions.svelte";

export async function pickVideoFiles(): Promise<string[]> {
  if (!isTauri()) {
    reportImportError("The video picker is available in the desktop app.");
    return [];
  }
  try {
    const selected = await open({
      title: "Choose video files",
      multiple: true,
      filters: [{ name: "Video files", extensions: ["mp4", "webm"] }],
    });
    return Array.isArray(selected) ? selected.filter((path) => typeof path === "string" && path.length > 0) : [];
  } catch (error) {
    reportImportError(error instanceof Error ? error.message : String(error));
    return [];
  }
}

/** Import a picker/drop batch first so an error never leaves a partial set of nodes. */
export async function importVideoPaths(paths: readonly string[], center: Point): Promise<string[]> {
  if (paths.length === 0) return [];
  const results = await Promise.all(paths.map((path) => importMediaPath(path)));
  const failed = results.find((result) => !result.ok);
  if (failed && !failed.ok) {
    reportImportError(failed.error);
    return [];
  }
  const media = results.flatMap((result) => result.ok ? [result.media] : []);
  if (media.length !== paths.length || media.some((item) => item.kind !== "video")) {
    reportImportError("Only supported MP4 and WebM videos can be imported here.");
    return [];
  }
  return createVideoNotes(media, center);
}

/** Browser picker path used by Vite, where native path dialogs are unavailable. */
export async function importVideoFiles(files: readonly File[], center: Point): Promise<string[]> {
  if (files.length === 0) return [];
  const results = await Promise.all(files.map((file) => importMediaFile(file)));
  const failed = results.find((result) => !result.ok);
  if (failed && !failed.ok) {
    reportImportError(failed.error);
    return [];
  }
  const media = results.flatMap((result) => result.ok ? [result.media] : []);
  if (media.length !== files.length || media.some((item) => item.kind !== "video")) {
    reportImportError("Only supported MP4 and WebM videos can be imported here.");
    return [];
  }
  return createVideoNotes(media, center);
}

export function registerVideoDropHandler(): () => void {
  return registerFileDropHandler(5, (paths, target, client) => {
    if (paths.length === 0 || target?.closest("[data-note-id]")) return false;
    const videoPaths = paths.filter((path) => mediaKindForPath(path) === "video");
    if (videoPaths.length === 0) return false;

    const boardElement = document.querySelector<HTMLElement>(".board");
    if (!boardElement) return false;
    const bounds = boardElement.getBoundingClientRect();
    const center = screenToWorld(camera, viewport, { x: client.x - bounds.left, y: client.y - bounds.top });
    void importVideoPaths(videoPaths, center);
    if (videoPaths.length !== paths.length) {
      reportImportError("Non-video files in this drop were skipped.");
    }
    return true;
  });
}
