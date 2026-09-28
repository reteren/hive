import { defaultMessageData } from "../messages/data";
import { registerCommand } from "../commands/registry.svelte";
import { nodeBodyFor } from "./nodeBodies";
import { execute } from "../history/history.svelte";
import { addNote, board, removeNote } from "../model/board.svelte";
import { BEACON_SIZE, DEFAULT_NOTE_WIDTH, newId, R5_BASE_WIDTHS, type Note, type NoteKind } from "../model/note";
import { addLink, canLink, removeLink } from "../model/links.svelte";
import type { Link } from "../model/link";
import { pointer } from "../board/camera.svelte";
import { grid } from "../board/grid.svelte";
import { snapToGrid } from "../board/gridMath";
import { tool } from "../tools/tool.svelte";
import {
  creationObstacleForNote,
  estimatedCreationHeight,
  randomFreeNoteCenter,
  notePositionAt,
} from "./creationPosition";
import type { Point } from "../board/cameraMath";
import { editing } from "./editing.svelte";
import { measuredHeights, type Bounds } from "./layout.svelte";
import { closeCreationMenu, creationMenu, creationMenuTrigger, openCreationMenu } from "./creation.svelte";
import { uniqueName } from "./naming";
import { registerNoteMenuItem } from "./noteMenu";
import {
  captureSelectionSnapshot,
  clearSelection,
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

export const DEFAULT_MINI_NOTE_WIDTH = 18;

type MiniNoteKind = Extract<NoteKind, "pro" | "con">;

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

/** Create a note, plus/minus, or standalone module at the current creation origin. */
export function createNoteKind(kind: NoteKind): string {
  const isModule = kind === "importance" || kind === "purpose" || kind === "mood";
  const width = kind === "beacon" ? BEACON_SIZE : kind in R5_BASE_WIDTHS ? R5_BASE_WIDTHS[kind as keyof typeof R5_BASE_WIDTHS] : kind === "note" ? DEFAULT_NOTE_WIDTH : isModule ? MODULE_NOTE_WIDTH : DEFAULT_MINI_NOTE_WIDTH;
  const height = estimatedCreationHeight({
    type: kind,
    width,
    height: kind === "beacon" ? BEACON_SIZE : kind === "importance" ? MODULE_NOTE_HEIGHT : kind === "trash" || kind === "archive" ? 40 : kind === "map" ? 30 : kind === "source" ? 24 : null,
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
  const note = makeNote(kind, id, position, Date.now());
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
      if (!isModule && kind !== "beacon" && !nodeBodyFor(kind)) editing.noteId = id;
    },
    undo: () => {
      removeNote(id);
      restoreSelectionSnapshot(previousSelection);
      if (editing.noteId === id) editing.noteId = previousEditing;
    },
  });

  return id;
}

/** Add a linked mini-node beside an existing node as one undoable board operation. */
export function addMiniNode(parentId: string, kind: MiniNoteKind): string | null {
  const parent = board.notes[parentId];
  if (!parent) return null;

  const id = newId();
  const parentBounds = creationObstacleForNote(parent, measuredHeights[parent.id]);
  const position = findMiniNodePosition(
    parentBounds,
    Object.values(board.notes).map((note) => creationObstacleForNote(note, measuredHeights[note.id])),
    kind,
  );
  const note = makeNote(kind, id, position, Date.now());
  const link: Link = {
    id: newId(),
    from: parent.id,
    to: note.id,
    kind: "strong",
    shape: "base",
  };
  if (!canLink(link.from, link.to)) return null;

  const index = board.order.length;
  const previousEditing = editing.noteId;
  const previousSelection = captureSelectionSnapshot();
  execute({
    label: `Add ${kindLabel(kind).toLowerCase()}`,
    target: `${parent.name} → ${note.name}`,
    do: () => {
      addNote(note, index);
      addLink(link);
      clearSelection();
      clearSelectedLink();
      selectOnly(id);
      editing.noteId = id;
    },
    undo: () => {
      removeLink(link.id);
      removeNote(id);
      restoreSelectionSnapshot(previousSelection);
      if (editing.noteId === id) editing.noteId = previousEditing;
    },
  });
  return id;
}

function makeNote(kind: NoteKind, id: string, position: Point, createdAt: number): Note {
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
    height: kind === "beacon" ? BEACON_SIZE : kind === "importance" ? MODULE_NOTE_HEIGHT : kind === "trash" || kind === "archive" ? 40 : kind === "map" ? 30 : kind === "source" ? 24 : null,
    createdAt,
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
  return "Note";
}

function findMiniNodePosition(parent: Bounds, existing: readonly Bounds[], kind: MiniNoteKind): Point {
  const width = DEFAULT_MINI_NOTE_WIDTH;
  const height = estimatedCreationHeight({ type: kind, width, height: null, text: "" });
  const gap = 2;
  const startX = parent.x + parent.width + gap;

  // Fill a right-hand shelf first, then continue onto rows below as the board becomes busy.
  for (let row = 0; row < 128; row += 1) {
    const y = parent.y + row * (height + gap);
    for (let column = 0; column < 128; column += 1) {
      const raw = { x: startX + column * (width + gap), y };
      const center = grid.snap
        ? snapToGrid({ x: raw.x + width / 2, y: raw.y + height / 2 }, grid.step)
        : { x: raw.x + width / 2, y: raw.y + height / 2 };
      const candidate = { x: center.x - width / 2, y: center.y - height / 2 };
      const bounds = { ...candidate, width, height };
      if (existing.every((other) => !overlaps(bounds, other))) return candidate;
    }
  }

  return { x: startX, y: parent.y };
}

function overlaps(first: Bounds, second: Bounds): boolean {
  return first.x < second.x + second.width && first.x + first.width > second.x &&
    first.y < second.y + second.height && first.y + first.height > second.y;
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
  id: "notes.addPlus",
  label: () => "Add plus",
  order: 40,
  run: (noteId) => {
    addMiniNode(noteId, "pro");
    closeLinkContextMenu();
  },
});

registerNoteMenuItem({
  id: "notes.addMinus",
  label: () => "Add minus",
  order: 41,
  run: (noteId) => {
    addMiniNode(noteId, "con");
    closeLinkContextMenu();
  },
});
