import { registerCommand } from "../commands/registry.svelte";
import { execute } from "../history/history.svelte";
import { addNote, board, removeNote } from "../model/board.svelte";
import { DEFAULT_NOTE_WIDTH, newId, type Note } from "../model/note";
import { camera, pointer } from "../board/camera.svelte";
import type { Point } from "../board/cameraMath";
import { editing } from "./editing.svelte";
import { MIN_NOTE_HEIGHT } from "./layout.svelte";
import { creationMenu } from "./creation.svelte";
import { uniqueName } from "./naming";
import { selection } from "../selection/selection.svelte";
import { formatNoteMarkdownLink, formatPointAddress } from "../links-in-text/format";
import { closeLinkContextMenu, linkContext, showLinkStatus } from "../links-in-text/contextMenu.svelte";

export function toggleCreationMenu(): void {
  if (creationMenu.open) {
    creationMenu.open = false;
    creationMenu.pinned = false;
  } else {
    creationMenu.open = true;
  }
}

export function createNote(): string {
  const id = newId();
  const note: Note = {
    id,
    type: "note",
    name: uniqueName("Note", Object.values(board.notes).map((existing) => existing.name)),
    text: "",
    x: camera.x - DEFAULT_NOTE_WIDTH / 2,
    y: camera.y - MIN_NOTE_HEIGHT / 2,
    width: DEFAULT_NOTE_WIDTH,
    height: null,
    createdAt: Date.now(),
  };
  const index = board.order.length;

  execute({
    label: "Create note",
    target: note.name,
    do: () => {
      addNote(note, index);
      editing.noteId = id;
    },
    undo: () => {
      removeNote(id);
      if (editing.noteId === id) editing.noteId = null;
    },
  });

  return id;
}

export async function copyCursorCoordinates(point?: Point): Promise<boolean> {
  const cursorPoint = point
    ?? (linkContext.menu?.kind === "board" ? linkContext.menu.point : linkContext.commandPoint)
    ?? pointer.world;
  linkContext.commandPoint = null;
  linkContext.commandNoteId = null;
  closeLinkContextMenu();
  if (!cursorPoint) {
    showLinkStatus("Move the cursor over the board first.");
    return false;
  }
  return copyText(formatPointAddress(cursorPoint), "Coordinates copied.");
}

export async function copyNoteLink(noteId?: string | null): Promise<boolean> {
  const id = noteId
    ?? (linkContext.menu?.kind === "note" ? linkContext.menu.noteId : linkContext.commandNoteId)
    ?? selection.primaryId;
  linkContext.commandNoteId = null;
  linkContext.commandPoint = null;
  closeLinkContextMenu();
  const note = id ? board.notes[id] : undefined;
  if (!note) {
    showLinkStatus("Select a note first.");
    return false;
  }
  return copyText(formatNoteMarkdownLink(note.name, note.id), "Note link copied.");
}

async function copyText(value: string, successMessage: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    showLinkStatus(successMessage);
    return true;
  } catch {
    showLinkStatus("Clipboard access is unavailable.");
    return false;
  }
}

registerCommand({
  id: "notes.createMenu",
  label: "New note",
  keys: ["KeyQ"],
  run: toggleCreationMenu,
  isActive: () => creationMenu.open,
});

registerCommand({
  id: "view.copyCursorPoint",
  label: "Copy Cursor Coordinates",
  keys: [],
  run: () => { void copyCursorCoordinates(); },
});

registerCommand({
  id: "notes.copyLink",
  label: "Copy Link to Note",
  keys: [],
  run: () => { void copyNoteLink(); },
});
