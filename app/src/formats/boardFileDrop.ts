import { camera, viewport } from "../board/camera.svelte";
import { screenToWorld, type Point } from "../board/cameraMath";
import { boardDropKindForPath, registerFileDropHandler, type BoardDropKind, type FileDropHandler } from "../attachments/service";
import { importImagePaths } from "../images/imageActions";
import { importAudioPaths } from "../audio/audioActions";
import { importVideoPaths } from "../video/import";
import { createLockedSourceNotes } from "../source/creation";
import { importFormatPaths } from "./formatActions";
import { importMarkdownPaths } from "./textDrop";

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
  // Existing importers own their history commands; a mixed drop has one Undo per file kind.
  for (const group of groupBoardDropPaths(paths)) {
    switch (group.kind) {
      case "image": await importImagePaths(group.paths, center); break;
      case "pdf": await importFormatPaths(group.paths, center, "pdf"); break;
      case "audio": await importAudioPaths(group.paths, center); break;
      case "video": await importVideoPaths(group.paths, center); break;
      case "markdown": await importMarkdownPaths(group.paths, center); break;
      case "format": await importFormatPaths(group.paths, center, "text"); break;
      case "source": createLockedSourceNotes(group.paths, center); break;
    }
  }
}

export const boardFileDropHandler: FileDropHandler = (paths, target, client) => {
  if (paths.length === 0 || !target?.closest(".board") || target.closest("[data-note-id]")) return false;
  const boardElement = document.querySelector<HTMLElement>(".board");
  if (!boardElement) return false;
  const bounds = boardElement.getBoundingClientRect();
  const center = screenToWorld(camera, viewport, { x: client.x - bounds.left, y: client.y - bounds.top });
  void importBoardDrop(paths, center);
  return true;
};

/** Priority 10: below target-specific handlers, above all legacy empty-board media handlers. */
export function registerBoardFileDropHandler(): () => void {
  return registerFileDropHandler(10, boardFileDropHandler);
}
