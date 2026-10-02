import { invoke } from "@tauri-apps/api/core";
import type { Point } from "../board/cameraMath";
import { reportImportError } from "../attachments/service";
import { execute } from "../history/history.svelte";
import { clearSelectedLink } from "../links/selection.svelte";
import { addNote, board, removeNote } from "../model/board.svelte";
import { DEFAULT_NOTE_WIDTH, newId, type Note } from "../model/note";
import { estimatedCreationHeight } from "../notes/creationPosition";
import { uniqueName } from "../notes/naming";
import { captureSelectionSnapshot, clearSelection, includeSelected, restoreSelectionSnapshot, selectOnly } from "../selection/selection.svelte";

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
  const names = Object.values(board.notes).map((note) => note.name);
  const width = DEFAULT_NOTE_WIDTH;
  const notes: Note[] = files.map(({ path, text }, index) => {
    const leaf = path.split(/[\\/]/).at(-1) ?? "";
    const name = uniqueName(leaf.replace(/\.md$/i, "") || "Note", names);
    names.push(name);
    const height = initialMarkdownNoteHeight(text, width);
    const placementHeight = height ?? Math.min(MAX_IMPORTED_NOTE_HEIGHT, estimatedCreationHeight({ type: "note", width, height: null, text }));
    const cascade = index * 2.2;
    return {
      id: newId(), type: "note", name, text,
      x: center.x + cascade - width / 2,
      y: center.y + cascade - placementHeight / 2,
      width, height, createdAt: Date.now(),
    };
  });
  const ids = notes.map((note) => note.id);
  const index = board.order.length;
  const previousSelection = captureSelectionSnapshot();
  execute({
    label: files.length === 1 ? "Import note" : "Import notes",
    target: files.length === 1 ? notes[0]?.name : `${files.length} notes`,
    do: () => {
      notes.forEach((note, offset) => addNote(note, index + offset));
      clearSelection();
      clearSelectedLink();
      if (ids[0]) selectOnly(ids[0]);
      for (const id of ids.slice(1)) includeSelected(id);
    },
    undo: () => {
      for (const id of [...ids].reverse()) removeNote(id);
      restoreSelectionSnapshot(previousSelection);
    },
  });
  return ids;
}

/** Read every file before adding any nodes so a failed path cannot leave a partial import. */
export async function importMarkdownPaths(paths: readonly string[], center: Point): Promise<boolean> {
  if (paths.length === 0 || paths.some((path) => !isMarkdownPath(path))) return false;
  try {
    const files = await Promise.all(paths.map(async (path) => ({
      path, text: await invoke<string>("read_dropped_text", { path }),
    })));
    return createMarkdownNotes(files, center).length === paths.length;
  } catch (error) {
    reportImportError(error instanceof Error ? error.message : String(error));
    return false;
  }
}
