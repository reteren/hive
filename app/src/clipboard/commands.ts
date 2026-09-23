import { camera, pointer } from "../board/camera.svelte";
import { DEFAULT_NOTE_WIDTH, newId, type Note } from "../model/note";
import { board, addNote, removeNote } from "../model/board.svelte";
import { execute, historyFeedback, type HistoryCommand } from "../history/history.svelte";
import { MIN_NOTE_HEIGHT } from "../notes/layout.svelte";
import { uniqueName } from "../notes/naming";
import { clearSelection, includeSelected, selection, setPrimary } from "../selection/selection.svelte";
import { registerCommand, runCommand } from "../commands/registry.svelte";
import { isTextEditingTarget } from "../commands/focus";
import {
  HIVE_CLIPBOARD_MIME,
  HIVE_CLIPBOARD_WEB_MIME,
  notesAsPlainText,
  parseNotesPayload,
  placeNotes,
  serializeNotes,
  uniqueCopyNames,
} from "./payload";

interface SelectionSnapshot {
  ids: string[];
  primaryId: string | null;
}

interface IndexedNote {
  note: Note;
  index: number;
}

type ClipboardWriteResult = "hive" | "text";

const MIME_FORMATS = [HIVE_CLIPBOARD_WEB_MIME, HIVE_CLIPBOARD_MIME] as const;
let clipboardBusy = false;
let feedbackSequence = 0;
let feedbackTimer: number | undefined;

export async function copySelection(): Promise<void> {
  const notes = selectedNotes();
  if (notes.length === 0) {
    showClipboardFeedback("Nothing selected to copy");
    return;
  }
  if (clipboardBusy) return;

  clipboardBusy = true;
  try {
    const result = await writeNotesToClipboard(notes);
    showClipboardFeedback(result === "hive"
      ? `Copied ${notes.length} ${noteNoun(notes.length)}`
      : "Copied as text; Hive clipboard format is unavailable");
  } catch (error) {
    showClipboardFeedback(clipboardErrorMessage(error));
  } finally {
    clipboardBusy = false;
  }
}

export async function cutSelection(): Promise<void> {
  const notes = selectedNotes();
  if (notes.length === 0) {
    showClipboardFeedback("Nothing selected to cut");
    return;
  }
  if (clipboardBusy) return;

  const selectionAtStart = notes.map((note) => note.id);
  clipboardBusy = true;
  try {
    const result = await writeNotesToClipboard(notes);
    if (result !== "hive") {
      showClipboardFeedback("Cut cancelled; Hive clipboard format is unavailable");
      return;
    }

    const currentNotes = selectedNotes();
    if (!sameNotes(notes, currentNotes) || !sameStrings(selectionAtStart, currentNotes.map((note) => note.id))) {
      showClipboardFeedback("Cut cancelled because the selection changed");
      return;
    }
    deleteNotes(notes, "Cut");
  } catch (error) {
    showClipboardFeedback(clipboardErrorMessage(error));
  } finally {
    clipboardBusy = false;
  }
}

export function deleteSelection(): void {
  const notes = selectedNotes();
  if (notes.length === 0) {
    showClipboardFeedback("Nothing selected to delete");
    return;
  }
  deleteNotes(notes, "Delete");
}

export function duplicateSelection(): void {
  const originals = selectedNotes();
  if (originals.length === 0) {
    showClipboardFeedback("Nothing selected to duplicate");
    return;
  }

  const copies = createCopies(originals, pointer.world ? { ...pointer.world } : null);
  addCopies(copies, "Duplicate", originals.length === 1 ? copies[0]?.name : `${copies.length} notes`);
  runCommand("select.move");
}

export async function pasteFromClipboard(): Promise<void> {
  if (isNoteEditingFocus()) return;
  if (clipboardBusy) return;
  const destination = pointer.world ? { ...pointer.world } : null;
  const fallbackCenter = { x: camera.x, y: camera.y };
  clipboardBusy = true;

  try {
    const source = await readClipboard();
    if (source.kind === "hive") {
      const notes = createCopies(source.payload.nodes, destination);
      addCopies(notes, "Paste", notes.length === 1 ? notes[0]?.name : `${notes.length} notes`);
      return;
    }

    if (!source.text.trim()) {
      showClipboardFeedback("Clipboard is empty");
      return;
    }

    const name = uniqueName("Note", Object.values(board.notes).map((note) => note.name));
    const center = destination ?? fallbackCenter;
    const note: Note = {
      id: newId(),
      type: "note",
      name,
      text: source.text,
      x: center.x - DEFAULT_NOTE_WIDTH / 2,
      y: center.y - MIN_NOTE_HEIGHT / 2,
      width: DEFAULT_NOTE_WIDTH,
      height: null,
    };
    addCopies([note], "Paste", note.name);
  } catch (error) {
    showClipboardFeedback(clipboardErrorMessage(error));
  } finally {
    clipboardBusy = false;
  }
}

function selectedNotes(): Note[] {
  return selection.ids.flatMap((id) => {
    const note = board.notes[id];
    return note ? [{ ...note }] : [];
  });
}

function selectionSnapshot(): SelectionSnapshot {
  const ids = selection.ids.filter((id) => Boolean(board.notes[id]));
  return {
    ids,
    primaryId: selection.primaryId && ids.includes(selection.primaryId) ? selection.primaryId : ids.at(-1) ?? null,
  };
}

function restoreSelection(snapshot: SelectionSnapshot): void {
  const ids = snapshot.ids.filter((id) => Boolean(board.notes[id]));
  clearSelection();
  for (const id of ids) includeSelected(id);
  if (snapshot.primaryId && ids.includes(snapshot.primaryId)) setPrimary(snapshot.primaryId);
}

function selectIds(ids: readonly string[]): void {
  clearSelection();
  for (const id of ids) includeSelected(id);
  if (ids.length > 0) setPrimary(ids[ids.length - 1]);
}

type CopySource = Pick<Note, "name" | "text" | "x" | "y" | "width" | "height">;

function createCopies(sourceNotes: readonly CopySource[], destination: { x: number; y: number } | null): Note[] {
  const existingNames = Object.values(board.notes).map((note) => note.name);
  const names = uniqueCopyNames(sourceNotes.map((note) => note.name), existingNames);
  const positioned = placeNotes(sourceNotes, destination);

  return positioned.map((note, index) => ({
    id: newId(),
    type: "note",
    name: names[index],
    text: note.text,
    x: note.x,
    y: note.y,
    width: note.width,
    height: note.height,
  }));
}

function addCopies(notes: readonly Note[], label: "Paste" | "Duplicate", target?: string): void {
  if (notes.length === 0) return;
  const previousSelection = selectionSnapshot();
  const startIndex = board.order.length;
  const ids = notes.map((note) => note.id);

  const command: HistoryCommand = {
    label,
    target,
    do: () => {
      notes.forEach((note, index) => addNote(note, startIndex + index));
      selectIds(ids);
    },
    undo: () => {
      for (const id of ids) removeNote(id);
      restoreSelection(previousSelection);
    },
  };
  execute(command);
}

function deleteNotes(notes: readonly Note[], label: "Cut" | "Delete"): void {
  const indexed: IndexedNote[] = notes.flatMap((note) => {
    const index = board.order.indexOf(note.id);
    return index < 0 ? [] : [{ note: { ...note }, index }];
  });
  if (indexed.length === 0) return;

  const previousSelection = selectionSnapshot();
  const target = indexed.length === 1 ? indexed[0].note.name : `${indexed.length} notes`;
  const command: HistoryCommand = {
    label,
    target,
    do: () => {
      for (const { note } of indexed) removeNote(note.id);
      clearSelection();
    },
    undo: () => {
      for (const { note, index } of [...indexed].sort((first, second) => first.index - second.index)) {
        addNote({ ...note }, index);
      }
      restoreSelection(previousSelection);
    },
  };
  execute(command);
}

async function writeNotesToClipboard(notes: readonly Note[]): Promise<ClipboardWriteResult> {
  const clipboard = navigator.clipboard;
  const plainText = notesAsPlainText(notes);
  if (!clipboard) throw new Error("Clipboard access is unavailable in this window.");

  const serialized = serializeNotes(notes);
  if (!clipboard.write || typeof ClipboardItem === "undefined") {
    await clipboard.writeText(plainText);
    return "text";
  }

  let supportsCustom = true;
  if (typeof ClipboardItem.supports === "function") {
    try {
      supportsCustom = MIME_FORMATS.some((type) => ClipboardItem.supports(type));
    } catch {
      supportsCustom = false;
    }
  }
  if (!supportsCustom) {
    await clipboard.writeText(plainText);
    return "text";
  }

  try {
    const item = new ClipboardItem({
      [HIVE_CLIPBOARD_WEB_MIME]: new Blob([serialized], { type: HIVE_CLIPBOARD_MIME }),
      "text/plain": new Blob([plainText], { type: "text/plain" }),
    });
    await clipboard.write([item]);
    return "hive";
  } catch (error) {
    try {
      await clipboard.writeText(plainText);
      return "text";
    } catch {
      throw error;
    }
  }
}

type ClipboardSource = { kind: "hive"; payload: NonNullable<ReturnType<typeof parseNotesPayload>> } | { kind: "text"; text: string };

async function readClipboard(): Promise<ClipboardSource> {
  const clipboard = navigator.clipboard;
  if (!clipboard) throw new Error("Clipboard access is unavailable in this window.");

  let plainText: string | null = null;
  let readError: unknown;
  if (clipboard.read) {
    try {
      const items = await clipboard.read();
      for (const item of items) {
        const customType = item.types.find((type) => MIME_FORMATS.includes(type as typeof MIME_FORMATS[number]));
        if (customType) {
          try {
            const serialized = await (await item.getType(customType)).text();
            const payload = parseNotesPayload(serialized);
            if (payload) return { kind: "hive", payload };
          } catch {
            // A damaged custom representation can still have a usable text/plain fallback.
          }
        }

        if (plainText === null && item.types.includes("text/plain")) {
          try {
            plainText = await (await item.getType("text/plain")).text();
          } catch {
            // Try readText() below, which may expose a platform's normalized text representation.
          }
        }
      }
    } catch (error) {
      readError = error;
    }
  }

  if (plainText === null) {
    try {
      plainText = await clipboard.readText();
    } catch (error) {
      throw readError ?? error;
    }
  }
  return { kind: "text", text: plainText };
}

function sameNotes(first: readonly Note[], second: readonly Note[]): boolean {
  return first.length === second.length && first.every((note, index) => {
    const other = second[index];
    return other && note.id === other.id && note.name === other.name && note.text === other.text &&
      note.x === other.x && note.y === other.y && note.width === other.width && note.height === other.height;
  });
}

function sameStrings(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function isNoteEditingFocus(): boolean {
  const activeElement = document.activeElement;
  return activeElement instanceof Element && isTextEditingTarget(activeElement) &&
    activeElement.closest("[data-note-id]") !== null;
}

function noteNoun(count: number): string {
  return count === 1 ? "note" : "notes";
}

function showClipboardFeedback(message: string): void {
  if (typeof window === "undefined") return;
  if (feedbackTimer !== undefined) window.clearTimeout(feedbackTimer);
  const id = Date.now() * 100 + (++feedbackSequence % 100);
  historyFeedback.current = { id, message, tone: "muted" };
  feedbackTimer = window.setTimeout(() => {
    if (historyFeedback.current?.id === id) historyFeedback.current = null;
    feedbackTimer = undefined;
  }, 2_000);
}

function clipboardErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Clipboard permission denied";
  return "Clipboard unavailable";
}

function runAsync(operation: () => Promise<void>): () => void {
  return () => { void operation(); };
}

registerCommand({
  id: "edit.copy",
  label: "Copy",
  keys: ["Ctrl+KeyC"],
  run: runAsync(copySelection),
  isActive: () => selection.ids.length > 0,
});

registerCommand({
  id: "edit.cut",
  label: "Cut",
  keys: ["Ctrl+KeyX"],
  run: runAsync(cutSelection),
  isActive: () => selection.ids.length > 0,
});

registerCommand({
  id: "edit.paste",
  label: "Paste",
  keys: ["Ctrl+KeyV"],
  run: runAsync(pasteFromClipboard),
  isActive: () => selection.ids.length > 0,
});

registerCommand({
  id: "edit.delete",
  label: "Delete",
  keys: ["Delete", "Backspace"],
  run: deleteSelection,
  isActive: () => selection.ids.length > 0,
});

registerCommand({
  id: "edit.duplicate",
  label: "Duplicate",
  keys: ["Shift+KeyD"],
  run: duplicateSelection,
  isActive: () => selection.ids.length > 0,
});
