import { defaultMessageData } from "../messages/data";
import { registerCommand } from "../commands/registry.svelte";
import { nodeBodyFor } from "./nodeBodies";
import { execute } from "../history/history.svelte";
import { addNote, board, removeNote } from "../model/board.svelte";
import { BEACON_SIZE, DEFAULT_NOTE_WIDTH, newId, R5_BASE_WIDTHS, type Note, type NoteKind } from "../model/note";
import { pointer } from "../board/camera.svelte";
import { grid } from "../board/grid.svelte";
import {
  creationObstacleForNote,
  estimatedCreationHeight,
  randomFreeNoteCenter,
  notePositionAt,
} from "./creationPosition";
import type { Point } from "../board/cameraMath";
import { editing } from "./editing.svelte";
import { measuredHeights } from "./layout.svelte";
import { closeCreationMenu, creationMenu, creationMenuTrigger, openCreationMenu } from "./creation.svelte";
import { uniqueName } from "./naming";
import { registerNoteMenuItem } from "./noteMenu";
import {
  captureSelectionSnapshot,
  clearSelection,
  includeSelected,
  restoreSelectionSnapshot,
  selectOnly,
  selection,
} from "../selection/selection.svelte";
import { clearSelectedLink } from "../links/selection.svelte";
import { formatNoteMarkdownLink, formatPointAddress } from "../links-in-text/format";
import { closeLinkContextMenu, linkContext, showLinkStatus } from "../links-in-text/contextMenu.svelte";
import { MODULE_NOTE_HEIGHT, MODULE_NOTE_WIDTH } from "../modules/moduleLogic";
import { beaconPaletteColor } from "../beacons/beaconPalette";
import { restartTimeNode } from "../time/runtime.svelte";
import { defaultAtTimeSchedule } from "../time/uiSchedule";
import type { ImageRef, MediaRef } from "../attachments/types";
import { imageNodeName, initialImageSize } from "../images/imageLogic";
import { openPdfExternally, registerFormatDropHandler } from "../formats/formatActions";

export const DEFAULT_MINI_NOTE_WIDTH = 18;

registerFormatDropHandler();

export function toggleCreationMenu(): void {
  if (creationMenu.open) {
    closeCreationMenu();
  } else {
    openCreationMenu(creationMenuTrigger());
  }
}

export function createNote(): string {
  return createNoteKind("note");
}

/** Create a normal editable note with its task flag in the same Undo command. */
export function createTaskNote(): string {
  return createNoteKind("note", true);
}

/** Create a note, plus/minus, or standalone module at the current creation origin. */
export function createNoteKind(kind: NoteKind, task = false): string {
  const isModule = kind === "importance" || kind === "purpose" || kind === "mood";
  const width = kind === "beacon" ? BEACON_SIZE : kind in R5_BASE_WIDTHS ? R5_BASE_WIDTHS[kind as keyof typeof R5_BASE_WIDTHS] : kind === "note" ? DEFAULT_NOTE_WIDTH : isModule ? MODULE_NOTE_WIDTH : DEFAULT_MINI_NOTE_WIDTH;
  const height = estimatedCreationHeight({
    type: kind,
    width,
    height: kind === "beacon" ? BEACON_SIZE : kind === "calendar" ? 34 : kind === "importance" ? MODULE_NOTE_HEIGHT : kind === "trash" || kind === "archive" ? 40 : kind === "map" ? 30 : kind === "source" ? 24 : null,
    text: "",
  });
  const id = newId();
  const freeCenter = randomFreeNoteCenter(
    creationMenu.origin,
    width,
    height,
    Object.values(board.notes).map((note) => creationObstacleForNote(note, measuredHeights[note.id])),
    grid.snap,
    grid.step,
  );
  const position = notePositionAt(
    freeCenter,
    width,
    height,
    false,
    grid.step,
  );
  const note = makeNote(kind, id, position, Date.now(), task);
  const index = board.order.length;
  const previousEditing = editing.noteId;
  const previousSelection = captureSelectionSnapshot();

  execute({
    label: `Create ${kindLabel(kind).toLowerCase()}`,
    target: note.name,
    do: () => {
      addNote(note, index);
      if (kind === "time") restartTimeNode(id);
      clearSelection();
      clearSelectedLink();
      selectOnly(id);
      if (!isModule && kind !== "beacon" && kind !== "calendar" && !nodeBodyFor(kind)) editing.noteId = id;
    },
    undo: () => {
      removeNote(id);
      restoreSelectionSnapshot(previousSelection);
      if (editing.noteId === id) editing.noteId = previousEditing;
    },
  });

  return id;
}

/** Add imported pictures as independent image nodes with one history entry per import action. */
export function createImageNotes(images: readonly ImageRef[], center: Point): string[] {
  if (images.length === 0) return [];
  const occupiedNames = Object.values(board.notes).map((note) => note.name);
  const notes = images.map((image, index): Note => {
    const size = initialImageSize(image);
    const name = uniqueName(imageNodeName(image.name), occupiedNames);
    occupiedNames.push(name);
    const cascade = index * 2.2;
    return {
      id: newId(),
      type: "image",
      name,
      text: "",
      x: center.x + cascade - size.width / 2,
      y: center.y + cascade - size.height / 2,
      width: size.width,
      height: size.height,
      createdAt: Date.now(),
      headerHidden: true,
      image: { ...image },
    };
  });
  const ids = notes.map((note) => note.id);
  const startIndex = board.order.length;
  const previousSelection = captureSelectionSnapshot();

  execute({
    label: "Import images",
    target: `${notes.length} ${notes.length === 1 ? "image" : "images"}`,
    do: () => {
      notes.forEach((note, index) => addNote(note, startIndex + index));
      clearSelection();
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

/** Add imported audio files as independent nodes in one undoable import action. */
export function createAudioNotes(files: readonly MediaRef[], center: Point): string[] {
  const audioFiles = files.filter((media) => media.kind === "audio");
  if (audioFiles.length === 0) return [];
  const occupiedNames = Object.values(board.notes).map((note) => note.name);
  const width = R5_BASE_WIDTHS.audio;
  const notes = audioFiles.map((media, index): Note => {
    const baseName = media.name?.replace(/\.[^.\\/]+$/, "") || "Audio";
    const name = uniqueName(baseName, occupiedNames);
    occupiedNames.push(name);
    const cascade = index * 2.2;
    return {
      id: newId(),
      type: "audio",
      name,
      text: "",
      x: center.x + cascade - width / 2,
      y: center.y + cascade - 8,
      width,
      height: null,
      createdAt: Date.now(),
      media: { ...media },
    };
  });
  const ids = notes.map((note) => note.id);
  const startIndex = board.order.length;
  const previousSelection = captureSelectionSnapshot();

  execute({
    label: "Import audio",
    target: `${notes.length} ${notes.length === 1 ? "audio file" : "audio files"}`,
    do: () => {
      notes.forEach((note, index) => addNote(note, startIndex + index));
      clearSelection();
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

/** Construct a node with the same kind defaults used by the Q creation menu. */
export function makeNote(kind: NoteKind, id: string, position: Point, createdAt: number, task = false): Note {
  const baseName = kindLabel(kind);
  return {
    id,
    type: kind,
    name: uniqueName(baseName, Object.values(board.notes).map((existing) => existing.name)),
    text: "",
    x: position.x,
    y: position.y,
    width: kind === "beacon"
      ? BEACON_SIZE
      : kind in R5_BASE_WIDTHS
      ? R5_BASE_WIDTHS[kind as keyof typeof R5_BASE_WIDTHS]
      : kind === "note"
      ? DEFAULT_NOTE_WIDTH
      : kind === "importance" || kind === "purpose" || kind === "mood"
        ? MODULE_NOTE_WIDTH
        : DEFAULT_MINI_NOTE_WIDTH,
    height: kind === "beacon" ? BEACON_SIZE : kind === "calendar" ? 34 : kind === "importance" ? MODULE_NOTE_HEIGHT : kind === "trash" || kind === "archive" ? 40 : kind === "map" ? 30 : kind === "source" ? 24 : null,
    createdAt,
    ...(task ? { task: { done: false, doneAt: null } } : {}),
    ...(kind === "importance" ? { importance: "basic" as const } : {}),
    ...(kind === "purpose" ? { purposes: [] } : {}),
    ...(kind === "mood" ? { moods: [] } : {}),
    ...(kind === "beacon" ? { color: beaconPaletteColor(Object.values(board.notes).filter((existing) => existing.type === "beacon").length) } : {}),
    ...(kind === "time" ? { time: { schedule: defaultAtTimeSchedule(createdAt), enabled: true } } : {}),
    ...(kind === "message" ? { message: defaultMessageData() } : {}),
  };
}

function kindLabel(kind: NoteKind): string {
  if (kind === "pro") return "Plus";
  if (kind === "con") return "Minus";
  if (kind === "importance") return "Importance";
  if (kind === "purpose") return "Purpose";
  if (kind === "mood") return "Mood";
  if (kind === "beacon") return "Beacon";
  if (kind === "goal") return "Goal";
  if (kind === "progress") return "Progress";
  if (kind === "calculator") return "Calculator";
  if (kind === "tierlist") return "Tierlist";
  if (kind === "stats") return "Statistics";
  if (kind === "archive") return "Archive";
  if (kind === "trash") return "Trash";
  if (kind === "inbox") return "Inbox";
  if (kind === "list") return "List";
  if (kind === "source") return "Source";
  if (kind === "glossary") return "Dictionary";
  if (kind === "map") return "Map";
  if (kind === "random") return "Random Choice";
  if (kind === "markas") return "Mark as";
  if (kind === "time") return "Time";
  if (kind === "message") return "Message";
  if (kind === "calendar") return "Calendar";
  return "Note";
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

registerNoteMenuItem({
  id: "notes.copyLink",
  label: (noteId) => {
    const note = board.notes[noteId];
    if (note?.type === "image") return note.image?.mime === "image/gif" ? "Copy link to gif" : "Copy link to image";
    return "Copy link to note";
  },
  run: (noteId) => { void copyNoteLink(noteId); },
  visible: (noteId) => Boolean(board.notes[noteId]),
  order: 10,
});

registerNoteMenuItem({
  id: "formats.openExternally",
  label: () => "Open externally",
  run: (noteId) => { void openPdfExternally(noteId); },
  visible: (noteId) => board.notes[noteId]?.type === "pdf",
  order: 30,
});
