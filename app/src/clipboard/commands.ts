import { camera, pointer } from "../board/camera.svelte";
import { DEFAULT_NOTE_WIDTH, newId, type Note } from "../model/note";
import { board, addNote, removeNote } from "../model/board.svelte";
import { addLink, links, removeLink } from "../model/links.svelte";
import type { Link } from "../model/link";
import { execute, historyFeedback, type HistoryCommand } from "../history/history.svelte";
import { MIN_NOTE_HEIGHT } from "../notes/layout.svelte";
import { uniqueName } from "../notes/naming";
import { clearSelection, includeSelected, selection, setPrimary } from "../selection/selection.svelte";
import { registerCommand, runCommand } from "../commands/registry.svelte";
import { isTextEditingTarget } from "../commands/focus";
import { clearSelectedLink, selectedLink } from "../links/selection.svelte";
import { unlinkSelected } from "../links/operations";
import {
  HIVE_CLIPBOARD_MIME,
  HIVE_CLIPBOARD_WEB_MIME,
  notesAsPlainText,
  parseNotesPayload,
  placeNotes,
  remapClipboardLinks,
  serializeNotes,
  taskFieldsForPaste,
  uniqueCopyNames,
  type ClipboardLink,
} from "./payload";

interface SelectionSnapshot {
  ids: string[];
  primaryId: string | null;
  linkId: string | null;
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
    if (unlinkSelected()) return;
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

  const copies = createCopies(
    originals.map((note) => ({ ...note, sourceId: note.id })),
    pointer.world ? { ...pointer.world } : null,
    linksBetween(originals),
  );
  addCopies(copies.notes, copies.links, "Duplicate", originals.length === 1 ? copies.notes[0]?.name : `${copies.notes.length} notes`);
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
      const copies = createCopies(source.payload.nodes, destination, source.payload.links);
      addCopies(copies.notes, copies.links, "Paste", copies.notes.length === 1 ? copies.notes[0]?.name : `${copies.notes.length} notes`);
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
      createdAt: Date.now(),
    };
    addCopies([note], [], "Paste", note.name);
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
    linkId: selectedLink.id && links.byId[selectedLink.id] ? selectedLink.id : null,
  };
}

function restoreSelection(snapshot: SelectionSnapshot): void {
  const ids = snapshot.ids.filter((id) => Boolean(board.notes[id]));
  clearSelection();
  for (const id of ids) includeSelected(id);
  if (snapshot.primaryId && ids.includes(snapshot.primaryId)) setPrimary(snapshot.primaryId);
  selectedLink.id = snapshot.linkId && links.byId[snapshot.linkId] ? snapshot.linkId : null;
}

function selectIds(ids: readonly string[]): void {
  clearSelection();
  clearSelectedLink();
  for (const id of ids) includeSelected(id);
  if (ids.length > 0) setPrimary(ids[ids.length - 1]);
}

type CopySource = Pick<Note,
  "type" | "name" | "text" | "x" | "y" | "width" | "height" | "createdAt" |
  "task" | "taskMemory" | "importance" | "purposes"
> & { sourceId: string };

function createCopies(
  sourceNotes: readonly CopySource[],
  destination: { x: number; y: number } | null,
  sourceLinks: readonly ClipboardLink[],
): { notes: Note[]; links: Link[] } {
  const existingNames = Object.values(board.notes).map((note) => note.name);
  const names = uniqueCopyNames(sourceNotes.map((note) => note.name), existingNames);
  const positioned = placeNotes(sourceNotes, destination);
  const idMap = new Map<string, string>();
  const notes = positioned.map((note, index) => {
    const id = newId();
    idMap.set(note.sourceId, id);
    return {
      id,
      type: note.type,
      name: names[index],
      text: note.text,
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
      createdAt: note.createdAt ?? Date.now(),
      ...taskFieldsForPaste(note),
      importance: note.importance ?? null,
      purposes: [...new Set(note.purposes ?? [])],
    };
  });
  return { notes, links: remapClipboardLinks(sourceLinks, idMap) };
}

function addCopies(notes: readonly Note[], copiedLinks: readonly Link[], label: "Paste" | "Duplicate", target?: string): void {
  if (notes.length === 0) return;
  const previousSelection = selectionSnapshot();
  const startIndex = board.order.length;
  const ids = notes.map((note) => note.id);

  const command: HistoryCommand = {
    label,
    target,
    do: () => {
      notes.forEach((note, index) => addNote(note, startIndex + index));
      copiedLinks.forEach(addLink);
      selectIds(ids);
    },
    undo: () => {
      copiedLinks.forEach((link) => removeLink(link.id));
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
  const deletedIds = new Set(indexed.map(({ note }) => note.id));
  const attachedLinks = Object.values(links.byId).filter((link) => deletedIds.has(link.from) || deletedIds.has(link.to));
  const target = indexed.length === 1 ? indexed[0].note.name : `${indexed.length} notes`;
  const command: HistoryCommand = {
    label,
    target,
    do: () => {
      attachedLinks.forEach((link) => removeLink(link.id));
      for (const { note } of indexed) removeNote(note.id);
      clearSelection();
      clearSelectedLink();
    },
    undo: () => {
      for (const { note, index } of [...indexed].sort((first, second) => first.index - second.index)) {
        addNote({ ...note }, index);
      }
      attachedLinks.forEach(addLink);
      restoreSelection(previousSelection);
    },
  };
  execute(command);
}

function linksBetween(notes: readonly Note[]): ClipboardLink[] {
  const ids = new Set(notes.map((note) => note.id));
  return Object.values(links.byId).flatMap((link) => ids.has(link.from) && ids.has(link.to)
    ? [{ from: link.from, to: link.to, kind: link.kind, shape: link.shape }]
    : []);
}

async function writeNotesToClipboard(notes: readonly Note[]): Promise<ClipboardWriteResult> {
  const clipboard = navigator.clipboard;
  const plainText = notesAsPlainText(notes);
  if (!clipboard) throw new Error("Clipboard access is unavailable in this window.");

  const serialized = serializeNotes(notes, linksBetween(notes));
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
      note.type === other.type && note.x === other.x && note.y === other.y && note.width === other.width &&
      note.height === other.height && JSON.stringify(note.task ?? null) === JSON.stringify(other.task ?? null) &&
      note.importance === other.importance &&
      JSON.stringify(note.purposes ?? []) === JSON.stringify(other.purposes ?? []);
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
  isActive: () => selection.ids.length > 0 || selectedLink.id !== null,
});

registerCommand({
  id: "edit.duplicate",
  label: "Duplicate",
  keys: ["Shift+KeyD"],
  run: duplicateSelection,
  isActive: () => selection.ids.length > 0,
});
