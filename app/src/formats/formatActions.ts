import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { camera, viewport } from "../board/camera.svelte";
import { screenToWorld, type Point } from "../board/cameraMath";
import {
  importMediaPath,
  mediaKindForPath,
  registerFileDropHandler,
  reportImportError,
  saveTextAttachment,
  type FileDropHandler,
  type MediaImportResult,
} from "../attachments/service";
import type { MediaRef } from "../attachments/types";
import { execute } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import { TEXT_FORMAT_LANGUAGES } from "../attachments/types";
import { createFormatNotes } from "./formatCreation";
import { isFormatMediaKind } from "./formatLogic";

export type FormatPickerKind = "pdf" | "text";
export type FormatSaveResult = { ok: true; previous: MediaRef; media: MediaRef } | { ok: false; error: string };

/** Open the OS picker for one of the two node types and create all selected files in one Undo step. */
export async function pickFormatFiles(kind: FormatPickerKind, center: Point): Promise<boolean> {
  try {
    const selection = await open({
      title: kind === "pdf" ? "Choose PDF files" : "Choose text files",
      multiple: true,
      filters: [{
        name: kind === "pdf" ? "PDF documents" : "Text files",
        extensions: kind === "pdf" ? ["pdf"] : Object.keys(TEXT_FORMAT_LANGUAGES),
      }],
    });
    const paths = Array.isArray(selection) ? selection : typeof selection === "string" ? [selection] : [];
    if (paths.length === 0) return false;
    return importFormatPaths(paths, center, kind);
  } catch (error) {
    reportImportError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function importFormatPaths(paths: readonly string[], center: Point, expected?: FormatPickerKind): Promise<boolean> {
  if (paths.length === 0) return false;
  const kinds = paths.map(mediaKindForPath);
  if (kinds.some((kind) => !isFormatMediaKind(kind)) || expected && kinds.some((kind) => kind !== expected)) return false;

  try {
    const results = await Promise.all(paths.map((path) => importMediaPath(path)));
    const failed = results.find((result) => !result.ok);
    if (failed && !failed.ok) {
      reportImportError(failed.error);
      return false;
    }
    const media = results.flatMap((result) => result.ok ? [result.media] : []);
    if (media.length !== paths.length || media.some((ref) => !isFormatMediaKind(ref.kind) || expected && ref.kind !== expected)) {
      reportImportError("Choose a supported PDF or text file.");
      return false;
    }
    createFormatNotes(media, center);
    return true;
  } catch (error) {
    reportImportError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** Native drop handler: leave every other media kind to the higher-priority task handlers. */
export function formatDropHandler(paths: string[], target: Element | null, client: Point): boolean {
  if (paths.length === 0 || target?.closest("[data-note-id]")) return false;
  if (paths.some((path) => !isFormatMediaKind(mediaKindForPath(path)))) return false;
  const boardElement = document.querySelector<HTMLElement>(".board");
  if (!boardElement) return false;
  const bounds = boardElement.getBoundingClientRect();
  const center = screenToWorld(camera, viewport, { x: client.x - bounds.left, y: client.y - bounds.top });
  void importFormatPaths(paths, center);
  return true;
}

export function registerFormatDropHandler(): () => void {
  return registerFileDropHandler(5, formatDropHandler satisfies FileDropHandler);
}

/** Replace only the media reference; the immutable attachment write itself is outside Undo. */
export async function saveFormatText(
  noteId: string,
  text: string,
  save: (text: string, previous: MediaRef) => Promise<MediaImportResult> = saveTextAttachment,
): Promise<FormatSaveResult> {
  const note = board.notes[noteId];
  const current = note?.media;
  if (note?.type !== "format" || !current || current.kind !== "text") {
    return { ok: false, error: "This node has no editable text file." };
  }
  const previous: MediaRef = { ...current };
  let result: MediaImportResult;
  try {
    result = await save(text, previous);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!result.ok) return result;
  if (result.media.kind !== "text") return { ok: false, error: "The saved attachment is not a text file." };
  if (board.notes[noteId]?.media?.file !== previous.file) {
    return { ok: false, error: "The file changed while it was being saved; try again." };
  }

  const next: MediaRef = { ...result.media };
  execute({
    label: "Save file",
    target: previous.name || note.name,
    do: () => updateNote(noteId, { media: next }),
    undo: () => updateNote(noteId, { media: previous }),
  });
  return { ok: true, previous, media: next };
}

export async function openPdfExternally(noteId: string): Promise<void> {
  const note = board.notes[noteId];
  if (note?.type !== "pdf" || note.media?.kind !== "pdf") return;
  try {
    const directory = await invoke<string>("attachment_directory");
    const separator = directory.includes("\\") ? "\\" : "/";
    const filePath = `${directory.replace(/[\\/]+$/, "")}${separator}${note.media.file}`;
    await invoke("source_open_path", { filePath });
  } catch (error) {
    reportImportError(error instanceof Error ? error.message : String(error));
  }
}
