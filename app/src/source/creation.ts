import type { Point } from "../board/cameraMath";
import { importSourceFilePath, reportImportError } from "../attachments/service";
import { execute } from "../history/history.svelte";
import { clearSelectedLink } from "../links/selection.svelte";
import { addNote, board, removeNote } from "../model/board.svelte";
import { newId, R5_BASE_WIDTHS, type Note } from "../model/note";
import { uniqueName } from "../notes/naming";
import { captureSelectionSnapshot, clearSelection, includeSelected, restoreSelectionSnapshot, selectOnly } from "../selection/selection.svelte";
import { sourceFileLabel } from "./logic";

/** Unsupported OS files are copied into attachments and linked by a project-relative basename. */
export async function createSourceNotes(paths: readonly string[], center: Point): Promise<string[]> {
  const files = paths.filter((path) => path.trim().length > 0);
  if (files.length === 0) return [];
  let imported: Array<{ file: string; name?: string }>;
  try {
    imported = await Promise.all(files.map((path) => importSourceFilePath(path)));
  } catch (error) {
    reportImportError(error instanceof Error ? error.message : String(error));
    return [];
  }
  return createSourceNotesFromAttachments(imported, center);
}

/** Create nodes from attachment results once an entire import batch has succeeded. */
export function createSourceNotesFromAttachments(
  imported: readonly { file: string; name?: string }[],
  center: Point,
): string[] {
  if (imported.length === 0) return [];
  const names = Object.values(board.notes).map((note) => note.name);
  const width = R5_BASE_WIDTHS.source;
  const height = 24;
  const notes: Note[] = imported.map((stored, index) => {
    const name = uniqueName(sourceFileLabel(stored.name ?? stored.file).name || "Source", names);
    names.push(name);
    const cascade = index * 2.2;
    return {
      id: newId(), type: "source", name, text: "",
      x: center.x + cascade - width / 2, y: center.y + cascade - height / 2,
      width, height, createdAt: Date.now(),
      source: { url: null, filePath: null, file: stored.file, description: "" },
    };
  });
  const ids = notes.map((note) => note.id);
  const index = board.order.length;
  const previousSelection = captureSelectionSnapshot();
  execute({
    label: imported.length === 1 ? "Link source file" : "Link source files",
    target: imported.length === 1 ? notes[0]?.name : `${imported.length} files`,
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
