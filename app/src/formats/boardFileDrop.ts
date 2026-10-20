import { invoke, isTauri } from "@tauri-apps/api/core";
import { camera, viewport } from "../board/camera.svelte";
import { screenToWorld, type Point } from "../board/cameraMath";
import {
  addImportProgress,
  boardDropKindForPath,
  importMediaPathBatch,
  importWasCancelled,
  registerFileDropHandler,
  reportImportError,
  setImportProgressDetails,
  withImportProgress,
  type BoardDropKind,
  type FileDropHandler,
} from "../attachments/service";
import { importImagePaths } from "../images/imageActions";
import { importAudioPaths } from "../audio/audioActions";
import { createVideoNotesForImportAsync } from "../notes/noteCommands";
import { createSourceNotes } from "../source/creation";
import { importFormatPaths } from "./formatActions";
import { importMarkdownPaths } from "./textDrop";
import type { MediaRef } from "../attachments/types";
import { t } from "../i18n/i18n.svelte";

export const BOARD_DROP_ORDER: readonly BoardDropKind[] = [
  "image", "pdf", "audio", "video", "markdown", "format", "source",
];

/** Group a mixed OS drop so no supported path is silently swallowed by another handler. */
export function groupBoardDropPaths(paths: readonly string[]): { kind: BoardDropKind; paths: string[] }[] {
  const groups = new Map<BoardDropKind, string[]>();
  for (const path of paths) {
    const kind = boardDropKindForPath(path);
    const group = groups.get(kind) ?? [];
    group.push(path);
    groups.set(kind, group);
  }
  return BOARD_DROP_ORDER.flatMap((kind) => {
    const group = groups.get(kind);
    return group ? [{ kind, paths: group }] : [];
  });
}

async function importBoardDrop(paths: readonly string[], center: Point): Promise<void> {
  await withImportProgress(t("Import files"), paths.length, async (run) => {
    let files = [...paths];
    if (isTauri()) {
      setImportProgressDetails(run.id, t("Scanning folders…"), paths.length);
      const expanded = await invoke<{ paths: string[]; skipped: number; truncated: boolean; cancelled: boolean }>(
        "attachment_expand_paths",
        { importId: run.id, paths, maxFiles: 100_000 },
      );
      files = expanded.paths;
      setImportProgressDetails(run.id, t("Import files"), files.length);
      if (expanded.skipped > 0) reportImportError(t("{skipped} unsupported or inaccessible paths were skipped.", { skipped: expanded.skipped }));
      if (expanded.truncated) reportImportError(t("Import was limited to the first 100,000 files."));
      if (expanded.cancelled || importWasCancelled(run.id)) return;
    }
    for (const group of groupBoardDropPaths(files)) {
      if (importWasCancelled(run.id)) break;
      switch (group.kind) {
        case "image": await importImagePaths(group.paths, center); break;
        case "pdf": await importFormatPaths(group.paths, center, "pdf"); break;
        case "audio": await importAudioPaths(group.paths, center); break;
        case "video": await importVideoPathBatch(group.paths, center, run.id); break;
        case "markdown": await importMarkdownPaths(group.paths, center); break;
        case "format": await importFormatPaths(group.paths, center, "text"); break;
        case "source": {
          const ids = await createSourceNotes(group.paths, center);
          addImportProgress(run.id, group.paths.length, ids.length, group.paths.length - ids.length);
          break;
        }
      }
    }
  });
}

async function importVideoPathBatch(paths: readonly string[], center: Point, importId: string): Promise<void> {
  const media: MediaRef[] = [];
  const errors: string[] = [];
  for (let offset = 0; offset < paths.length; offset += 200) {
    if (importWasCancelled(importId)) break;
    const chunk = paths.slice(offset, offset + 200);
    const results = await importMediaPathBatch(chunk, importId, "video");
    for (const result of results) {
      if (result.ok && result.media.kind === "video") media.push(result.media);
      else errors.push(result.ok ? t("Only supported MP4 and WebM videos can be imported here.") : result.error);
    }
    if (importWasCancelled(importId) || results.length < chunk.length) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (errors.length > 0 && !importWasCancelled(importId)) reportImportError(errors[0]!);
  if (media.length > 0 && (errors.length === 0 || importWasCancelled(importId))) {
    await createVideoNotesForImportAsync(media, center);
  }
}

export const boardFileDropHandler: FileDropHandler = (paths, target, client) => {
  if (paths.length === 0 || !target?.closest(".board") || target.closest("[data-note-id]")) return false;
  const boardElement = document.querySelector<HTMLElement>(".board");
  if (!boardElement) return false;
  const bounds = boardElement.getBoundingClientRect();
  const center = screenToWorld(camera, viewport, { x: client.x - bounds.left, y: client.y - bounds.top });
  void importBoardDrop(paths, center).catch((error: unknown) => {
    reportImportError(error instanceof Error ? error.message : String(error));
  });
  return true;
};

/** Priority 10: below target-specific handlers, above all legacy empty-board media handlers. */
export function registerBoardFileDropHandler(): () => void {
  return registerFileDropHandler(10, boardFileDropHandler);
}
