import { camera, pointer } from "../board/camera.svelte";
import { grid } from "../board/grid.svelte";
import { DEFAULT_NOTE_WIDTH, newId, type Note } from "../model/note";
import { board, addNote, removeNote } from "../model/board.svelte";
import { addLink, links, removeLink } from "../model/links.svelte";
import type { Link } from "../model/link";
import { addZone, removeZone, zones } from "../model/zones.svelte";
import type { Zone } from "../model/zone";
import { execute, historyFeedback, type HistoryCommand } from "../history/history.svelte";
import { measuredHeights } from "../notes/layout.svelte";
import { uniqueName } from "../notes/naming";
import { noteFileKey } from "../project/fileNames";
import {
  captureSelectionSnapshot,
  clearSelection,
  clearZoneSelection,
  includeSelected,
  restoreSelectionSnapshot,
  selection,
  setPrimary,
  toggleZoneSelected,
} from "../selection/selection.svelte";
import { registerCommand, runCommand } from "../commands/registry.svelte";
import { isTextEditingTarget } from "../commands/focus";
import { clearSelectedLink, selectedLink } from "../links/selection.svelte";
import { unlinkSelected } from "../links/operations";
import { deleteZonesAction } from "../zones/zoneGestures";
import { translateShape } from "../zones/shape";
import { beaconPaletteColor } from "../beacons/beaconPalette";
import { removeCreatedBankRowForLink } from "../calculator/bankActions.svelte";
import { moveToTrash } from "../trash/trashActions.svelte";
import { linkedTimeStatesForTask } from "../time/taskLink";
import { restartTimeNode } from "../time/runtime.svelte";
import { copyTimeNodeData } from "../time/data";
import { copyTimeForHost } from "../combo/data";
import { importClipboardItems, importImageFiles, viewportCenter } from "../images/imageActions";
import {
  creationObstacleForNote,
  estimatedCreationHeight,
  randomFreeNoteCenter,
  type CreationObstacle,
} from "../notes/creationPosition";
import {
  HIVE_CLIPBOARD_MIME,
  HIVE_CLIPBOARD_WEB_MIME,
  notesAsPlainText,
  parseNotesPayload,
  placementOffset,
  findNonOverlappingZoneOffset,
  remapClipboardLinks,
  serializeNotes,
  taskFieldsForPaste,
  uniqueCopyNames,
  type ClipboardLink,
  type ClipboardZone,
} from "./payload";

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
  const copiedNotes = includeActiveTaskTimes(notes);
  const selectedZonesNow = selectedZones();
  if (notes.length === 0 && selectedZonesNow.length === 0) {
    showClipboardFeedback("Nothing selected to copy");
    return;
  }
  if (clipboardBusy) return;

  clipboardBusy = true;
  try {
    const result = await writeSelectionToClipboard(copiedNotes, selectedZonesNow);
    showClipboardFeedback(result === "hive" && hasActiveTaskTime(copiedNotes, linksBetween(copiedNotes))
      ? "Reminder copied with the task"
      : result === "hive" ? `Copied ${selectionNoun(copiedNotes.length, selectedZonesNow.length)}`
        : "Copied as text; Hive clipboard format is unavailable");
  } catch (error) {
    showClipboardFeedback(clipboardErrorMessage(error));
  } finally {
    clipboardBusy = false;
  }
}

export async function cutSelection(): Promise<void> {
  const notes = selectedNotes();
  const selectedZonesNow = selectedZones();
  if (notes.length === 0 && selectedZonesNow.length === 0) {
    showClipboardFeedback("Nothing selected to cut");
    return;
  }
  if (clipboardBusy) return;

  const selectionAtStart = notes.map((note) => note.id);
  const selectedZoneIdsAtStart = selectedZonesNow.map((zone) => zone.id);
  clipboardBusy = true;
  try {
    const result = await writeSelectionToClipboard(notes, selectedZonesNow);
    if (result !== "hive") {
      showClipboardFeedback("Cut cancelled; Hive clipboard format is unavailable");
      return;
    }

    const currentNotes = selectedNotes();
    const currentZones = selectedZones();
    if (!sameNotes(notes, currentNotes) || !sameZones(selectedZonesNow, currentZones) ||
      !sameStrings(selectionAtStart, currentNotes.map((note) => note.id)) ||
      !sameStrings(selectedZoneIdsAtStart, currentZones.map((zone) => zone.id))) {
      showClipboardFeedback("Cut cancelled because the selection changed");
      return;
    }
    deleteSelectionItems(notes, selectedZoneIdsAtStart, "Cut");
  } catch (error) {
    showClipboardFeedback(clipboardErrorMessage(error));
  } finally {
    clipboardBusy = false;
  }
}

export function deleteSelection(): void {
  const notes = selectedNotes();
  const selectedZoneIdsNow = selectedZones().map((zone) => zone.id);
  if (notes.length === 0 && selectedZoneIdsNow.length === 0) {
    if (unlinkSelected()) return;
    showClipboardFeedback("Nothing selected to delete");
    return;
  }
  deleteSelectionItems(notes, selectedZoneIdsNow, "Delete");
}

export function duplicateSelection(): void {
  const originals = includeActiveTaskTimes(selectedNotes());
  const originalZones = selectedZones();
  if (originals.length === 0 && originalZones.length === 0) {
    showClipboardFeedback("Nothing selected to duplicate");
    return;
  }

  const copies = createCopies(
    originals.map((note) => ({ ...note, sourceId: note.id })),
    originalZones,
    pointer.world ? { ...pointer.world } : null,
    linksBetween(originals),
  );
  if (!copies) {
    showClipboardFeedback("Can't place copied zones without overlap");
    return;
  }
  addCopies(
    copies.notes,
    copies.zones,
    copies.links,
    "Duplicate",
    selectionNoun(copies.notes.length, copies.zones.length),
    copies.placementHeights,
  );
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
    if (source.kind === "images") {
      await importImageFiles(source.files, viewportCenter());
      return;
    }
    if (source.kind === "hive") {
      const copies = createCopies(source.payload.nodes, source.payload.zones, destination, source.payload.links);
      if (!copies) {
        showClipboardFeedback("Can't place copied zones without overlap");
        return;
      }
      addCopies(
        copies.notes,
        copies.zones,
        copies.links,
        "Paste",
        selectionNoun(copies.notes.length, copies.zones.length),
        copies.placementHeights,
      );
      return;
    }

    if (!source.text.trim()) {
      showClipboardFeedback("Clipboard is empty");
      return;
    }

    const name = uniqueName("Note", Object.values(board.notes).map((note) => note.name));
    const center = destination ?? fallbackCenter;
    const height = estimatedCreationHeight({ type: "note", width: DEFAULT_NOTE_WIDTH, height: null, text: source.text });
    const note: Note = {
      id: newId(),
      type: "note",
      name,
      text: source.text,
      x: center.x - DEFAULT_NOTE_WIDTH / 2,
      y: center.y - height / 2,
      width: DEFAULT_NOTE_WIDTH,
      height: null,
      createdAt: Date.now(),
    };
    addCopies([note], [], [], "Paste", note.name);
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

function selectedZones(): Zone[] {
  return selectedZoneIds().flatMap((id) => {
    const zone = zones.byId[id];
    return zone ? [copyZone(zone)] : [];
  });
}

function selectedZoneIds(): string[] {
  return selection.zoneIds;
}

function setZoneIds(ids: readonly string[]): void {
  clearZoneSelection();
  for (const id of ids) toggleZoneSelected(id);
}

function selectIds(ids: readonly string[], zoneIds: readonly string[] = []): void {
  clearSelection();
  clearSelectedLink();
  setZoneIds([]);
  for (const id of ids) includeSelected(id);
  if (ids.length > 0) setPrimary(ids[ids.length - 1]);
  setZoneIds(zoneIds.filter((id) => Boolean(zones.byId[id])));
}

type CopySource = Omit<Pick<Note,
  "type" | "name" | "text" | "x" | "y" | "width" | "height" | "createdAt" |
  "task" | "taskMemory" | "importance" | "purposes" | "embedSections" | "headerHidden" | "image"
>, "time" | "message"> & {
  time?: Note["time"] | null;
  message?: Note["message"] | null;
  embedSections?: Note["embedSections"] | null;
  color?: string | null;
  zoneId?: string | null;
  sourceId: string;
};

function createCopies(
  sourceNotes: readonly CopySource[],
  sourceZoneValues: readonly (Zone | ClipboardZone)[],
  destination: { x: number; y: number } | null,
  sourceLinks: readonly ClipboardLink[],
): { notes: Note[]; zones: Zone[]; links: Link[]; placementHeights: Map<string, number> } | null {
  const sourceZones = sourceZoneValues.map((zone) => normalizeSourceZone(zone));
  const existingNotes = Object.values(board.notes);
  const existingNames = existingNotes.map((note) => note.name);
  const occupiedNames = [
    ...existingNames,
    ...sourceNotes.filter((note) => note.type === "calculator").map((note) => note.name),
  ];
  const nonCalculatorKeys = new Set([
    ...existingNotes.filter((note) => note.type !== "calculator"),
    ...sourceNotes.filter((note) => note.type !== "calculator"),
  ]
    .map((note) => noteFileKey(note.name)));
  const names = sourceNotes.map((note) => {
    const key = noteFileKey(note.name);
    const name = note.type === "calculator" && !nonCalculatorKeys.has(key)
      ? note.name
      : uniqueName(note.name, occupiedNames);
    occupiedNames.push(name);
    return name;
  });
  const sourceZoneNames = zones.order.flatMap((id) => zones.byId[id]?.name ?? []);
  const zoneNames = uniqueCopyNames(sourceZones.map((zone) => zone.name), sourceZoneNames);
  const offset = placementOffset(sourceNotes, sourceZones, destination);
  const idMap = new Map<string, string>();
  const zoneIdMap = new Map<string, string>();
  const placementHeights = new Map<string, number>();
  sourceZones.forEach((zone) => zoneIdMap.set(zone.id, newId()));
  const notes = sourceNotes.map((note, index) => {
    const id = newId();
    idMap.set(note.sourceId, id);
    const measuredHeight = measuredHeights[note.sourceId];
    if (note.height === null && Number.isFinite(measuredHeight) && measuredHeight > 0) {
      placementHeights.set(id, measuredHeight);
    }
    return {
      id,
      type: note.type,
      name: names[index],
      text: note.text,
      x: note.x + offset.x,
      y: note.y + offset.y,
      width: note.width,
      height: note.type === "purpose" || note.type === "mood" ? null : note.height,
      createdAt: note.createdAt ?? Date.now(),
      ...taskFieldsForPaste(note),
      ...(note.time ? { time: copyTimeForHost(note.type, note.time) } : {}),
      ...(note.message ? { message: { ...note.message } } : {}),
      ...(note.embedSections ? { embedSections: { ...note.embedSections } } : {}),
      ...(note.headerHidden ? { headerHidden: true } : {}),
      ...(note.image ? { image: { ...note.image } } : {}),
      importance: note.importance ?? null,
      purposes: [...new Set(note.purposes ?? [])],
      ...(note.type === "beacon" ? { color: note.color ?? beaconPaletteColor(0) } : note.color ? { color: note.color } : {}),
      zoneId: note.zoneId ? zoneIdMap.get(note.zoneId) ?? null : null,
    };
  });
  const translatedZones = sourceZones.map((zone, index) => ({
    ...translateZone(zone, offset),
    id: zoneIdMap.get(zone.id)!,
    name: zoneNames[index],
    createdAt: Date.now(),
  }));
  const existingZones = zones.order.flatMap((id) => zones.byId[id] ? [zones.byId[id]] : []);
  const nonOverlappingOffset = findNonOverlappingZoneOffset(translatedZones, existingZones);
  if (!nonOverlappingOffset) return null;
  const copiedZones = translatedZones.map((zone) => translateZone(zone, nonOverlappingOffset));
  const copiedNotes = nonOverlappingOffset.x === 0 && nonOverlappingOffset.y === 0
    ? notes
    : notes.map((note) => ({ ...note, x: note.x + nonOverlappingOffset.x, y: note.y + nonOverlappingOffset.y }));
  return { notes: copiedNotes, zones: copiedZones, links: remapClipboardLinks(sourceLinks, idMap), placementHeights };
}

function addCopies(
  notes: readonly Note[], copiedZones: readonly Zone[], copiedLinks: readonly Link[],
  label: "Paste" | "Duplicate", target?: string, placementHeights?: ReadonlyMap<string, number>,
): void {
  if (notes.length === 0 && copiedZones.length === 0) return;
  const placedNotes = placeNewNotesWithoutOverlap(notes, placementHeights);
  const previousSelection = captureSelectionSnapshot();
  const startIndex = board.order.length;
  const ids = placedNotes.map((note) => note.id);
  const zoneIds = copiedZones.map((zone) => zone.id);

  const command: HistoryCommand = {
    label,
    target,
    do: () => {
      placedNotes.forEach((note, index) => addNote(note, startIndex + index));
      copiedZones.forEach(addZone);
      copiedLinks.forEach(addLink);
      const reminderTimeIds = activeTaskTimeIds(placedNotes, copiedLinks);
      reminderTimeIds.forEach((noteId) => restartTimeNode(noteId));
      selectIds(ids, zoneIds);
    },
    undo: () => {
      copiedLinks.forEach((link) => {
        removeLink(link.id);
        // A pasted strong link into a calculator created a bank row; undoing the paste removes it.
        removeCreatedBankRowForLink(link);
      });
      for (const id of ids) removeNote(id);
      for (const id of zoneIds) removeZone(id);
      restoreSelectionSnapshot(previousSelection);
    },
  };
  execute(command);
  if (hasActiveTaskTime(placedNotes, copiedLinks)) showClipboardFeedback("Reminder copied with the task");
}

function includeActiveTaskTimes(notes: readonly Note[]): Note[] {
  const result = [...notes];
  const includedIds = new Set(notes.map((note) => note.id));
  for (const task of notes) {
    if (!task.task) continue;
    for (const linkedTime of linkedTimeStatesForTask(task.id, Object.values(links.byId), board.notes)) {
      const time = board.notes[linkedTime.noteId];
      if (!linkedTime.enabled || !time || includedIds.has(time.id)) continue;
      result.push({ ...time, time: time.time ? copyTimeNodeData(time.time) : undefined });
      includedIds.add(time.id);
    }
  }
  return result;
}

function activeTaskTimeIds(notes: readonly Note[], edges: readonly Pick<Link, "from" | "to" | "kind">[]): string[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const result = new Set<string>();
  for (const task of notes) {
    if (!task.task) continue;
    for (const edge of edges) {
      const time = byId.get(edge.to);
      if (edge.kind === "strong" && edge.from === task.id && time?.type === "time" && time.time?.enabled) {
        result.add(time.id);
      }
    }
  }
  return [...result];
}

function hasActiveTaskTime(notes: readonly Note[], edges: readonly Pick<Link, "from" | "to" | "kind">[]): boolean {
  return activeTaskTimeIds(notes, edges).length > 0;
}

function placeNewNotesWithoutOverlap(notes: readonly Note[], placementHeights?: ReadonlyMap<string, number>): Note[] {
  const obstacles: CreationObstacle[] = Object.values(board.notes).map((note) =>
    creationObstacleForNote(note, measuredHeights[note.id]),
  );
  return notes.map((note) => {
    const height = estimatedCreationHeight(note, placementHeights?.get(note.id));
    const center = { x: note.x + note.width / 2, y: note.y + height / 2 };
    const placedCenter = randomFreeNoteCenter(center, note.width, height, obstacles, grid.snap, grid.step);
    const placed = { ...note, x: placedCenter.x - note.width / 2, y: placedCenter.y - height / 2 };
    obstacles.push(creationObstacleForNote(placed));
    return placed;
  });
}

function deleteSelectionItems(notes: readonly Note[], zoneIds: readonly string[], label: "Cut" | "Delete"): void {
  if (label === "Delete") {
    moveToTrash(notes.map((note) => note.id), zoneIds, {
      label: "Delete",
      target: selectionNoun(notes.length, zoneIds.length),
    });
    return;
  }

  const indexed: IndexedNote[] = notes.flatMap((note) => {
    const index = board.order.indexOf(note.id);
    return index < 0 ? [] : [{ note: { ...note }, index }];
  });
  const zoneAction = deleteZonesAction(zoneIds);
  const existingZoneIds = zoneIds.filter((id) => Boolean(zones.byId[id]));
  if (indexed.length === 0 && existingZoneIds.length === 0) return;

  const previousSelection = captureSelectionSnapshot();
  const deletedIds = new Set(indexed.map(({ note }) => note.id));
  const attachedLinks = Object.values(links.byId).filter((link) => deletedIds.has(link.from) || deletedIds.has(link.to));
  const target = selectionNoun(indexed.length, existingZoneIds.length);
  const command: HistoryCommand = {
    label,
    target,
    do: () => {
      attachedLinks.forEach((link) => removeLink(link.id));
      for (const { note } of indexed) removeNote(note.id);
      zoneAction.do();
      clearSelection();
      setZoneIds([]);
      clearSelectedLink();
    },
    undo: () => {
      for (const { note, index } of [...indexed].sort((first, second) => first.index - second.index)) {
        addNote({ ...note }, index);
      }
      zoneAction.undo();
      attachedLinks.forEach(addLink);
      restoreSelectionSnapshot(previousSelection);
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

async function writeSelectionToClipboard(notes: readonly Note[], copiedZones: readonly Zone[]): Promise<ClipboardWriteResult> {
  const clipboard = navigator.clipboard;
  const noteText = notesAsPlainText(notes);
  const zoneText = copiedZones.map((zone) => `Zone: ${zone.name}`).join("\n\n");
  const plainText = [noteText, zoneText].filter(Boolean).join("\n\n");
  if (!clipboard) throw new Error("Clipboard access is unavailable in this window.");

  const serialized = serializeNotes(notes, linksBetween(notes), copiedZones);
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

type ClipboardSource =
  | { kind: "hive"; payload: NonNullable<ReturnType<typeof parseNotesPayload>> }
  | { kind: "images"; files: File[] }
  | { kind: "text"; text: string };

async function readClipboard(): Promise<ClipboardSource> {
  const clipboard = navigator.clipboard;
  if (!clipboard) throw new Error("Clipboard access is unavailable in this window.");

  let plainText: string | null = null;
  let readError: unknown;
  if (clipboard.read) {
    try {
      const items = await clipboard.read();
      const imageFiles = await importClipboardItems(items);
      if (imageFiles.length > 0) return { kind: "images", files: imageFiles };
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
      note.height === other.height && note.createdAt === other.createdAt &&
      note.headerHidden === other.headerHidden && JSON.stringify(note.image ?? null) === JSON.stringify(other.image ?? null) &&
      JSON.stringify(note.task ?? null) === JSON.stringify(other.task ?? null) &&
      JSON.stringify(note.taskMemory ?? null) === JSON.stringify(other.taskMemory ?? null) &&
      note.importance === other.importance &&
      JSON.stringify(note.purposes ?? []) === JSON.stringify(other.purposes ?? []) &&
      JSON.stringify(note.moods ?? []) === JSON.stringify(other.moods ?? []) &&
      note.color === other.color && note.zoneId === other.zoneId;
  });
}

function sameZones(first: readonly Zone[], second: readonly Zone[]): boolean {
  return first.length === second.length && first.every((zone, index) => {
    const other = second[index];
    return other && zone.id === other.id && zone.name === other.name && zone.color === other.color &&
      zone.createdAt === other.createdAt && JSON.stringify(zone.parts) === JSON.stringify(other.parts) &&
      JSON.stringify(zone.holes) === JSON.stringify(other.holes);
  });
}

function sameStrings(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function normalizeSourceZone(zone: Zone | ClipboardZone): Zone {
  if ("sourceId" in zone) {
    return {
      id: zone.sourceId,
      name: zone.name,
      color: zone.color,
      parts: zone.parts.map((part) => part.map((point) => ({ ...point }))),
      holes: zone.holes.map((hole) => hole.map((point) => ({ ...point }))),
      ...(zone.createdAt === undefined ? {} : { createdAt: zone.createdAt }),
    };
  }
  return copyZone(zone);
}

function copyZone(zone: Zone): Zone {
  return {
    ...zone,
    parts: zone.parts.map((part) => part.map((point) => ({ ...point }))),
    holes: zone.holes.map((hole) => hole.map((point) => ({ ...point }))),
  };
}

function translateZone(zone: Zone, offset: { x: number; y: number }): Zone {
  return { ...zone, ...translateShape(zone, offset) };
}

function isNoteEditingFocus(): boolean {
  const activeElement = document.activeElement;
  return activeElement instanceof Element && isTextEditingTarget(activeElement) &&
    activeElement.closest("[data-note-id]") !== null;
}

function noteNoun(count: number): string {
  return count === 1 ? "note" : "notes";
}

function selectionNoun(noteCount: number, zoneCount: number): string {
  if (noteCount === 0) return `${zoneCount} ${zoneCount === 1 ? "zone" : "zones"}`;
  if (zoneCount === 0) return `${noteCount} ${noteNoun(noteCount)}`;
  return `${noteCount} ${noteNoun(noteCount)} and ${zoneCount} ${zoneCount === 1 ? "zone" : "zones"}`;
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
  isActive: () => selection.ids.length > 0 || selectedZoneIds().length > 0,
});

registerCommand({
  id: "edit.cut",
  label: "Cut",
  keys: ["Ctrl+KeyX"],
  run: runAsync(cutSelection),
  isActive: () => selection.ids.length > 0 || selectedZoneIds().length > 0,
});

registerCommand({
  id: "edit.paste",
  label: "Paste",
  keys: ["Ctrl+KeyV"],
  run: runAsync(pasteFromClipboard),
  isActive: () => selection.ids.length > 0 || selectedZoneIds().length > 0,
});

registerCommand({
  id: "edit.delete",
  label: "Delete",
  keys: ["Delete", "Backspace"],
  run: deleteSelection,
  isActive: () => selection.ids.length > 0 || selectedZoneIds().length > 0 || selectedLink.id !== null,
});

registerCommand({
  id: "edit.duplicate",
  label: "Duplicate",
  keys: ["Shift+KeyD"],
  run: duplicateSelection,
  isActive: () => selection.ids.length > 0 || selectedZoneIds().length > 0,
});
