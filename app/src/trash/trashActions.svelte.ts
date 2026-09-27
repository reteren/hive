import { addNote, board, removeNote } from "../model/board.svelte";
import { addLink, linkBetween, links, removeLink } from "../model/links.svelte";
import { ME_OBJECT_ID, type Link } from "../model/link";
import { newId } from "../model/note";
import { trash, type TrashEntry } from "../model/retention.svelte";
import { addZone, removeZone, zones } from "../model/zones.svelte";
import { execute } from "../history/history.svelte";
import {
  captureSelectionSnapshot,
  clearSelection,
  restoreSelectionSnapshot,
  selection,
  type SelectionSnapshot,
} from "../selection/selection.svelte";
import { clearSelectedLink } from "../links/selection.svelte";
import { editing } from "../notes/editing.svelte";
import { calculatorKey } from "../model/nodeData";
import { calculators, deleteCalculatorData, setCalculatorData } from "../calculator/calculators.svelte";
import {
  copyTrashEntry,
  copyTrashCalculatorData,
  copyTrashLink,
  copyTrashNote,
  copyTrashZone,
  planTrashRestore,
  trashEntrySummary,
  type TrashListItem,
  type TrashRestorePreview,
} from "./trash";

export type { TrashListItem, TrashRestorePreview } from "./trash";

const historyInvalidators = new Map<string, () => void>();

export interface MoveToTrashOptions {
  label?: string;
  target?: string;
}

/** Move each selected object to its own recoverable entry in one Undo step. */
export function moveToTrash(
  noteIds: readonly string[],
  zoneIds: readonly string[] = [],
  options: MoveToTrashOptions = {},
): TrashEntry[] | null {
  const requestedNotes = new Set(noteIds);
  const requestedZones = new Set(zoneIds);
  const indexedNotes = board.order.flatMap((id, index) => {
    const note = board.notes[id];
    return note && requestedNotes.has(id) ? [{ note, index }] : [];
  });
  const indexedZones = zones.order.flatMap((id, index) => {
    const zone = zones.byId[id];
    return zone && requestedZones.has(id) ? [{ zone, index }] : [];
  });
  if (indexedNotes.length === 0 && indexedZones.length === 0) return null;

  const removedNoteIds = new Set(indexedNotes.map(({ note }) => note.id));
  const attachedLinks = Object.values(links.byId).filter((link) =>
    removedNoteIds.has(link.from) || removedNoteIds.has(link.to),
  );
  const deletedAt = Date.now();
  const entries = [
    ...indexedNotes.map(({ note }) => {
      const key = note.type === "calculator" ? calculatorKey(note.name) : "";
      const calculatorData = key ? calculators.byKey[key] : undefined;
      return copyTrashEntry({
        id: newId(),
        deletedAt,
        notes: [note],
        zones: [],
        links: attachedLinks.filter((link) => link.from === note.id || link.to === note.id),
        ...(calculatorData ? { calculators: { [key]: copyTrashCalculatorData(calculatorData) } } : {}),
      });
    }),
    ...indexedZones.map(({ zone }) => copyTrashEntry({
      id: newId(),
      deletedAt,
      notes: [],
      zones: [zone],
      links: [],
    })),
  ];
  const insertionIndex = trash.entries.length;
  const previousSelection = captureSelectionSnapshot();
  const previousEditing = editing.noteId;
  const permanentlyDeletedEntryIds = new Set<string>();
  const entryIdByNoteId = new Map(entries.flatMap((entry) => entry.notes.map((note) => [note.id, entry.id] as const)));
  const entryIdByZoneId = new Map(entries.flatMap((entry) => entry.zones.map((zone) => [zone.id, entry.id] as const)));
  for (const entry of entries) {
    historyInvalidators.set(entry.id, () => permanentlyDeletedEntryIds.add(entry.id));
  }

  execute({
    label: options.label ?? "Delete",
    target: options.target ?? entries.map(trashEntrySummary).join(", "),
    do: () => {
      const activeEntries = entries.filter((entry) => !permanentlyDeletedEntryIds.has(entry.id));
      let offset = 0;
      for (const entry of activeEntries) {
        if (!trash.entries.some((candidate) => candidate.id === entry.id)) {
          trash.entries.splice(Math.min(insertionIndex + offset, trash.entries.length), 0, copyTrashEntry(entry));
        }
        offset += 1;
      }
      const activeNoteIds = new Set(activeEntries.flatMap((entry) => entry.notes.map((note) => note.id)));
      attachedLinks
        .filter((link) => activeNoteIds.has(link.from) || activeNoteIds.has(link.to))
        .forEach((link) => removeLink(link.id));
      indexedNotes
        .filter(({ note }) => entryIdByNoteId.has(note.id) && !permanentlyDeletedEntryIds.has(entryIdByNoteId.get(note.id)!))
        .forEach(({ note }) => removeNote(note.id));
      indexedZones
        .filter(({ zone }) => entryIdByZoneId.has(zone.id) && !permanentlyDeletedEntryIds.has(entryIdByZoneId.get(zone.id)!))
        .forEach(({ zone }) => removeZone(zone.id));
      if (previousEditing && activeNoteIds.has(previousEditing)) editing.noteId = null;
      clearSelection();
      clearSelectedLink();
    },
    undo: () => {
      const restorableEntryIds = new Set(entries
        .filter((entry) => !permanentlyDeletedEntryIds.has(entry.id) && trash.entries.some((candidate) => candidate.id === entry.id))
        .map((entry) => entry.id));
      trash.entries = trash.entries.filter((candidate) => !restorableEntryIds.has(candidate.id));
      const restorableNotes = indexedNotes.filter(({ note }) => restorableEntryIds.has(entryIdByNoteId.get(note.id) ?? ""));
      const restorableZones = indexedZones.filter(({ zone }) => restorableEntryIds.has(entryIdByZoneId.get(zone.id) ?? ""));
      const restorableNoteIds = new Set(restorableNotes.map(({ note }) => note.id));
      restorableNotes
        .slice()
        .sort((first, second) => first.index - second.index)
        .forEach(({ note, index }) => addNote(copyTrashNote(note), index));
      restorableZones
        .slice()
        .sort((first, second) => first.index - second.index)
        .forEach(({ zone, index }) => addZone(copyTrashZone(zone), index));
      attachedLinks.forEach((link) => {
        if (canRestoreLink(link, restorableNoteIds)) addLink(copyTrashLink(link));
      });
      restoreSelectionSnapshot(selectionAvailableOnBoard(previousSelection));
      editing.noteId = previousEditing && board.notes[previousEditing] ? previousEditing : null;
    },
  });

  return entries.map(copyTrashEntry);
}

/** Project-wide trash entries, newest first, with a concise object-name summary. */
export function listTrashEntries(): TrashListItem[] {
  return [...trash.entries]
    .sort((first, second) => second.deletedAt - first.deletedAt || first.id.localeCompare(second.id))
    .map((entry) => ({ ...copyTrashEntry(entry), summary: trashEntrySummary(entry) }));
}

/** Preview broken links and name collisions before restoring an entry. */
export function previewRestore(entryId: string): TrashRestorePreview | null {
  const entry = trash.entries.find((candidate) => candidate.id === entryId);
  if (!entry) return null;
  const plan = planTrashRestore(entry, Object.values(board.notes), Object.values(links.byId));
  return {
    linksRestored: plan.linksRestored,
    linksBroken: plan.linksBroken,
    renamed: plan.renamed,
    idConflicts: plan.idConflicts,
  };
}

/** Restore a trash entry in one Undo step, leaving any missing-end links broken. */
export function restoreTrashEntry(entryId: string): TrashRestorePreview | null {
  const entryIndex = trash.entries.findIndex((candidate) => candidate.id === entryId);
  if (entryIndex < 0) return null;
  const originalEntry = copyTrashEntry(trash.entries[entryIndex]);
  const plan = planTrashRestore(originalEntry, Object.values(board.notes), Object.values(links.byId));
  if (plan.idConflicts.length > 0) {
    return {
      linksRestored: plan.linksRestored,
      linksBroken: plan.linksBroken,
      renamed: plan.renamed,
      idConflicts: plan.idConflicts,
    };
  }

  const indexedZones = originalEntry.zones.map((zone, offset) => ({ zone, index: zones.order.length + offset }));
  const previousSelection = captureSelectionSnapshot();
  const previousEditing = editing.noteId;
  const existingCalculatorKeys = new Set(Object.values(board.notes)
    .filter((note) => note.type === "calculator")
    .map((note) => calculatorKey(note.name)));
  let restoredLinkIds = new Set<string>();

  execute({
    label: "Restore from trash",
    target: trashEntrySummary(originalEntry),
    do: () => {
      const currentIndex = trash.entries.findIndex((candidate) => candidate.id === entryId);
      if (currentIndex >= 0) trash.entries.splice(currentIndex, 1);
      plan.notes.forEach((note) => addNote(copyTrashNote(note)));
      indexedZones.forEach(({ zone }) => addZone(copyTrashZone(zone)));
      const restoredNotesById = new Map(plan.notes.map((note) => [note.id, note]));
      for (const originalNote of originalEntry.notes) {
        if (originalNote.type !== "calculator") continue;
        const targetNote = restoredNotesById.get(originalNote.id);
        const data = originalEntry.calculators?.[calculatorKey(originalNote.name)];
        if (!targetNote || !data) continue;
        const targetKey = calculatorKey(targetNote.name);
        if (!existingCalculatorKeys.has(targetKey) && !calculators.byKey[targetKey]) {
          setCalculatorData(targetNote.name, copyTrashCalculatorData(data));
        }
      }
      restoredLinkIds = new Set();
      for (const link of plan.linksRestored) {
        if (!canRestoreLink(link, new Set(plan.notes.map((note) => note.id)))) continue;
        addLink(copyTrashLink(link));
        restoredLinkIds.add(link.id);
      }
      selection.ids = plan.notes.map((note) => note.id);
      selection.zoneIds = indexedZones.map(({ zone }) => zone.id);
      selection.primaryId = plan.notes.at(-1)?.id ?? null;
      selection.marquee = null;
      selection.contextPick = null;
      clearSelectedLink();
      if (previousEditing && !board.notes[previousEditing]) editing.noteId = null;
    },
    undo: () => {
      for (const id of restoredLinkIds) removeLink(id);
      plan.notes.forEach((note) => removeNote(note.id));
      indexedZones.forEach(({ zone }) => removeZone(zone.id));
      trash.entries.splice(Math.min(entryIndex, trash.entries.length), 0, copyTrashEntry(originalEntry));
      restoreSelectionSnapshot(previousSelection);
      editing.noteId = previousEditing;
    },
  });

  return {
    linksRestored: plan.linksRestored,
    linksBroken: plan.linksBroken,
    renamed: plan.renamed,
    idConflicts: plan.idConflicts,
  };
}

/** Permanently forget one confirmed trash entry; this is deliberately not undoable. */
export function deletePermanently(entryId: string): TrashEntry | null {
  const index = trash.entries.findIndex((candidate) => candidate.id === entryId);
  if (index < 0) return null;
  const [removed] = trash.entries.splice(index, 1);
  historyInvalidators.get(entryId)?.();
  historyInvalidators.delete(entryId);
  pruneUnusedCalculatorData();
  return removed ? copyTrashEntry(removed) : null;
}

/** Permanently remove all entries after the UI has confirmed the action. */
export function emptyTrash(): TrashEntry[] {
  const removed = trash.entries.map(copyTrashEntry);
  for (const entry of removed) {
    historyInvalidators.get(entry.id)?.();
    historyInvalidators.delete(entry.id);
  }
  trash.entries = [];
  pruneUnusedCalculatorData();
  return removed;
}

/** Called when the project changes, because history is cleared with its trash actions. */
export function resetTrashHistoryInvalidators(): void {
  historyInvalidators.clear();
}

function pruneUnusedCalculatorData(): void {
  const retainedKeys = new Set(
    [...Object.values(board.notes), ...trash.entries.flatMap((entry) => entry.notes)]
      .filter((note) => note.type === "calculator")
      .map((note) => calculatorKey(note.name)),
  );
  for (const key of Object.keys(calculators.byKey)) {
    if (!retainedKeys.has(calculatorKey(key))) deleteCalculatorData(key);
  }
}

function canRestoreLink(link: Link, restoringNoteIds: ReadonlySet<string>): boolean {
  const hasEndpoint = (id: string, isFrom: boolean): boolean =>
    (isFrom && id === ME_OBJECT_ID) || Boolean(board.notes[id]) || restoringNoteIds.has(id);
  return hasEndpoint(link.from, true) && hasEndpoint(link.to, false) && !linkBetween(link.from, link.to);
}

function selectionAvailableOnBoard(snapshot: SelectionSnapshot): SelectionSnapshot {
  const ids = snapshot.ids.filter((id) => Boolean(board.notes[id]));
  const zoneIds = snapshot.zoneIds.filter((id) => Boolean(zones.byId[id]));
  const primaryId = snapshot.primaryId === null
    ? null
    : ids.includes(snapshot.primaryId) ? snapshot.primaryId : ids.at(-1) ?? null;
  const extensions = { ...snapshot.extensions };
  const linkSelection = extensions.links;
  if (isRecord(linkSelection)) {
    const linkIds = Array.isArray(linkSelection.ids)
      ? linkSelection.ids.filter((id): id is string => typeof id === "string" && Boolean(links.byId[id]))
      : [];
    extensions.links = {
      id: typeof linkSelection.id === "string" && linkIds.includes(linkSelection.id)
        ? linkSelection.id
        : linkIds.at(-1) ?? null,
      ids: linkIds,
    };
  }
  return { ...snapshot, ids, zoneIds, primaryId, extensions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
