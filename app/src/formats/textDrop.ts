import { invoke } from "@tauri-apps/api/core";
import type { Point } from "../board/cameraMath";
import { addImportOutcome, importProgress, importWasCancelled, reportImportError, setImportProgressCompleted, withImportProgress } from "../attachments/service";
import { execute } from "../history/history.svelte";
import { clearSelectedLink } from "../links/selection.svelte";
import { addNotes, board, removeNotes } from "../model/board.svelte";
import { DEFAULT_NOTE_WIDTH, newId, type Note } from "../model/note";
import { boardCreationNameAllocator, creationNameAllocator, estimatedCreationHeight, mapCreationBatch, placeCreationGrid, queryBoardCreationRightEdge, yieldCreationWork } from "../notes/creationPosition";
import { captureSelectionSnapshot, clearSelection, restoreSelectionSnapshot, selection } from "../selection/selection.svelte";
import { grid } from "../board/grid.svelte";
import { t, tp } from "../i18n/i18n.svelte";

/** A large imported note opens at most 800 CSS px high; its body can scroll thereafter. */
export const MAX_IMPORTED_NOTE_HEIGHT = 80;

export interface DroppedMarkdown {
  path: string;
  text: string;
}

export function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path);
}

export function initialMarkdownNoteHeight(text: string, width = DEFAULT_NOTE_WIDTH): number | null {
  const estimated = estimatedCreationHeight({ type: "note", width, height: null, text });
  return estimated > MAX_IMPORTED_NOTE_HEIGHT ? MAX_IMPORTED_NOTE_HEIGHT : null;
}

export function createMarkdownNotes(files: readonly DroppedMarkdown[], center: Point): string[] {
  if (files.length === 0) return [];
  const createName = creationNameAllocator(Object.values(board.notes).map((note) => note.name));
  return commitMarkdownNotes(placeMarkdownNotes(files.map((file) => markdownNote(file, center, createName)), center), files.length);
}

/** Create large Markdown drops in yielding slices before one undoable board mutation. */
export async function createMarkdownNotesAsync(files: readonly DroppedMarkdown[], center: Point): Promise<string[]> {
  if (files.length === 0) return [];
  const createName = await boardCreationNameAllocator();
  const unplaced = await mapCreationBatch(files, (file) => markdownNote(file, center, createName));
  const notes = placeMarkdownNotes(unplaced, center);
  await yieldCreationWork();
  return commitMarkdownNotes(notes, files.length);
}

function markdownNote({ path, text }: DroppedMarkdown, center: Point, createName: (name: string) => string): Note {
  const width = DEFAULT_NOTE_WIDTH;
  const leaf = path.split(/[\\/]/).at(-1) ?? "";
  const name = createName(leaf.replace(/\.md$/i, "") || "Note");
  const height = initialMarkdownNoteHeight(text, width);
  const placementHeight = height ?? Math.min(MAX_IMPORTED_NOTE_HEIGHT, estimatedCreationHeight({ type: "note", width, height: null, text }));
  return {
    id: newId(), type: "note", name, text,
    x: center.x - width / 2, y: center.y - placementHeight / 2,
    width, height, createdAt: Date.now(),
  };
}

function placeMarkdownNotes(unplacedNotes: readonly Note[], center: Point): Note[] {
  return placeCreationGrid(
    unplacedNotes.map((note) => ({
      note,
      width: note.width,
      height: note.height ?? Math.min(MAX_IMPORTED_NOTE_HEIGHT, estimatedCreationHeight(note)),
    })),
    center,
    queryBoardCreationRightEdge,
    grid.snap,
    grid.step,
  ).map(({ note, x, y }) => ({ ...note, x, y }));
}

function commitMarkdownNotes(notes: readonly Note[], fileCount: number): string[] {
  if (notes.length === 0) return [];
  const ids = notes.map((note) => note.id);
  const index = board.order.length;
  const previousSelection = captureSelectionSnapshot();
  execute({
    label: fileCount === 1 ? t("Import note") : t("Import notes"),
    target: fileCount === 1 ? notes[0]?.name : tp(notes.length, "{count} note", "{count} notes"),
    do: () => {
      addNotes(notes, index);
      clearSelection();
      clearSelectedLink();
      selection.ids = [...ids];
      selection.primaryId = ids.at(-1) ?? null;
    },
    undo: () => {
      removeNotes(ids);
      restoreSelectionSnapshot(previousSelection);
    },
  });
  return ids;
}

/** Read Markdown in bounded native batches, then add the collected notes in one board mutation. */
export async function importMarkdownPaths(paths: readonly string[], center: Point): Promise<boolean> {
  if (paths.length === 0 || paths.some((path) => !isMarkdownPath(path))) return false;
  try {
    return await withImportProgress(t("Import notes"), paths.length, async (run) => {
      let offset = 0;
      const files: DroppedMarkdown[] = [];
      const progressBase = importProgress.id === run.id ? importProgress.completed : 0;
      let firstError: string | undefined;
      while (offset < paths.length && !importWasCancelled(run.id)) {
        const batchPaths = paths.slice(offset, offset + 200);
        const batch = await invoke<{
          items: Array<{ path: string; text?: string; error?: string }>;
          processed: number;
          cancelled: boolean;
        }>("read_dropped_text_batch", {
          importId: run.id,
          paths: batchPaths,
          progressOffset: progressBase + offset,
          totalCount: paths.length,
        });
        const successes = batch.items.flatMap((item) => item.text === undefined ? [] : [{ path: item.path, text: item.text }]);
        const failures = batch.items.length - successes.length;
        addImportOutcome(run.id, successes.length, failures, batch.items.at(-1)?.path.split(/[\\/]/).at(-1) ?? "");
        setImportProgressCompleted(run.id, progressBase + offset + batch.processed);
        files.push(...successes);
        firstError ??= batch.items.find((item) => item.error)?.error;
        offset += batch.processed;
        if (batch.cancelled || importWasCancelled(run.id)) break;
        if (batch.processed === 0) {
          firstError ??= t("The text import batch made no progress.");
          break;
        }
      }
      if (firstError && !importWasCancelled(run.id)) {
        reportImportError(firstError);
        return false;
      }
      const imported = files.length > 0 ? (await createMarkdownNotesAsync(files, center)).length : 0;
      return imported === paths.length;
    });
  } catch (error) {
    reportImportError(error instanceof Error ? error.message : String(error));
    return false;
  }
}
