import { camera } from "../board/camera.svelte";
import { grid } from "../board/grid.svelte";
import { calculators, calculatorData, deleteCalculatorData, setCalculatorData } from "../calculator/calculators.svelte";
import { execute, type HistoryCommand } from "../history/history.svelte";
import { addNote, board, removeNote, updateNote } from "../model/board.svelte";
import { addLink, links, linksOf, removeLink } from "../model/links.svelte";
import { ME_OBJECT_ID } from "../model/link";
import { calculatorKey, parseCalculatorData, type CalculatorData } from "../model/nodeData";
import { newId, type Note } from "../model/note";
import { archive, type ArchiveEntry } from "../model/retention.svelte";
import { creationObstacleForNote, estimatedCreationHeight, nearestFreeNoteCenter } from "../notes/creationPosition";
import { measuredHeights } from "../notes/layout.svelte";
import { uniqueName } from "../notes/naming";
import { captureSelectionSnapshot, restoreSelectionSnapshot, selectOnly, selection } from "../selection/selection.svelte";
import { canArchiveNote, copyArchivedLink, copyArchivedNote, planArchiveRestore, type ArchiveRestorePlan, type RestorePlacement } from "./logic";
import { linkedTimeStatesForTask } from "../time/taskLink";
import { restartTimeNode } from "../time/runtime.svelte";

/** Permanent removal must stay permanent when an older Archive/Restore step is traversed. */
const permanentlyDeleted = new Set<string>();

export function resetArchiveHistoryTombstones(): void {
  permanentlyDeleted.clear();
}

/** Archiving removes the board note and its links; reminder scheduling will hook here in R8. */
export function archiveNotes(noteIds: readonly string[]): number {
  const uniqueIds = [...new Set(noteIds)].filter((id) => canArchiveNote(board.notes[id]));
  if (uniqueIds.length === 0) return 0;
  const originals = uniqueIds.map((id) => ({ note: copyArchivedNote(board.notes[id]), index: board.order.indexOf(id) }));
  const archivedTaskIds = uniqueIds.filter((id) => Boolean(board.notes[id]?.task));
  const linkedTimes = [...new Map(archivedTaskIds.flatMap((id) =>
    linkedTimeStatesForTask(id, Object.values(links.byId), board.notes),
  ).map((state) => [state.noteId, state])).values()];
  const removedLinks = [...new Map(uniqueIds.flatMap((id) => linksOf(id)).map((link) => [link.id, copyArchivedLink(link)])).values()];
  const now = Date.now();
  const entries: ArchiveEntry[] = originals.map(({ note }) => ({
    id: newId(), archivedAt: now, note,
    links: removedLinks.filter((link) => link.from === note.id || link.to === note.id).map(copyArchivedLink),
    ...(note.type === "calculator" ? { calculatorData: copyCalculatorData(calculatorData(note.name)) } : {}),
  }));
  const archivedTimeIds = new Set(uniqueIds);
  for (const time of linkedTimes) {
    if (!archivedTimeIds.has(time.noteId)) continue;
    const entry = entries.find((item) => item.note.id === time.noteId);
    if (entry?.note.time) entry.note.time = { ...entry.note.time, enabled: false };
  }
  const beforeSelection = captureSelectionSnapshot();
  const selectedIds = new Set(uniqueIds);
  const entryByNoteId = new Map(entries.map((entry) => [entry.note.id, entry]));
  const command: HistoryCommand = {
    label: "Archive",
    target: entries.length === 1 ? entries[0].note.name : `${entries.length} nodes`,
    do: () => {
      const activeIds = new Set(entries.filter((entry) => !permanentlyDeleted.has(entry.id)).map((entry) => entry.note.id));
      linkedTimes.forEach((time) => setTimeEnabled(time.noteId, false));
      removedLinks.forEach((link) => {
        if (activeIds.has(link.from) || activeIds.has(link.to)) removeLink(link.id);
      });
      originals.forEach(({ note }) => {
        if (!permanentlyDeleted.has(entryByNoteId.get(note.id)!.id)) removeNote(note.id);
      });
      archive.entries = [...archive.entries, ...entries.filter((entry) => !permanentlyDeleted.has(entry.id))];
      for (const { note } of originals) {
        if (!permanentlyDeleted.has(entryByNoteId.get(note.id)!.id)) pruneCalculatorIfUnused(note);
      }
      selection.ids = selection.ids.filter((id) => !selectedIds.has(id));
      if (selection.primaryId && selectedIds.has(selection.primaryId)) selection.primaryId = selection.ids.at(-1) ?? null;
    },
    undo: () => {
      const restorable = new Set(entries
        .filter((entry) => !permanentlyDeleted.has(entry.id) && archive.entries.some((item) => item.id === entry.id))
        .map((entry) => entry.note.id));
      archive.entries = archive.entries.filter((entry) => !restorable.has(entry.note.id));
      originals.slice().sort((a, b) => a.index - b.index).forEach(({ note, index }) => {
        if (restorable.has(note.id)) addNote(copyArchivedNote(note), index);
      });
      linkedTimes.forEach((time) => setTimeEnabled(time.noteId, time.enabled));
      for (const entry of entries) {
        if (restorable.has(entry.note.id)) restoreCalculatorIfAbsent(entry.note, entry.calculatorData);
      }
      removedLinks.forEach((link) => {
        const fromPresent = link.from === ME_OBJECT_ID || !!board.notes[link.from];
        const toPresent = link.to === ME_OBJECT_ID || !!board.notes[link.to];
        if (fromPresent && toPresent && !links.byId[link.id]) addLink(copyArchivedLink(link));
      });
      const ids = beforeSelection.ids.filter((id) => !!board.notes[id]);
      restoreSelectionSnapshot({
        ...beforeSelection,
        ids,
        primaryId: beforeSelection.primaryId && ids.includes(beforeSelection.primaryId)
          ? beforeSelection.primaryId : ids.at(-1) ?? null,
      });
    },
  };
  execute(command);
  return entries.length;
}

/** A clicked selected note archives the eligible selection; other clicks archive only that note. */
export function archiveFromMenu(noteId: string): number {
  return archiveNotes(selection.ids.includes(noteId) ? selection.ids : [noteId]);
}

export function archiveSelected(): number {
  return archiveNotes(selection.ids);
}

export function restoreArchived(
  entryId: string,
  placement: RestorePlacement,
  resumeReminders = false,
): ArchiveRestorePlan | null {
  const entry = archive.entries.find((item) => item.id === entryId);
  if (!entry || board.notes[entry.note.id]) return null;
  const index = archive.entries.indexOf(entry);
  const plan = planArchiveRestore(entry, placement, camera, Object.values(board.notes), Object.values(links.byId),
    Object.keys(calculators.byKey));
  const timeNotes = { ...board.notes, [plan.note.id]: plan.note };
  const linkedTimes = plan.note.task
    ? linkedTimeStatesForTask(plan.note.id, plan.links, timeNotes)
    : [];
  const beforeLinkedTimes = linkedTimes.map(({ noteId }) => ({
    noteId,
    enabled: board.notes[noteId]?.time?.enabled ?? false,
  }));
  const timesToResume = resumeReminders ? linkedTimes.map(({ noteId }) => noteId) : [];
  const beforeSelection = captureSelectionSnapshot();
  const command: HistoryCommand = {
    label: "Restore from archive",
    target: plan.note.name,
    do: () => {
      if (permanentlyDeleted.has(entryId)) return;
      archive.entries = archive.entries.filter((item) => item.id !== entryId);
      addNote(copyArchivedNote(plan.note));
      restoreCalculatorIfAbsent(plan.note, entry.calculatorData);
      plan.links.forEach((link) => addLink(copyArchivedLink(link)));
      timesToResume.forEach((noteId) => {
        setTimeEnabled(noteId, true);
        restartTimeNode(noteId);
      });
      selectOnly(plan.note.id);
    },
    undo: () => {
      if (permanentlyDeleted.has(entryId)) return;
      plan.links.forEach((link) => removeLink(link.id));
      removeNote(plan.note.id);
      pruneCalculatorIfUnused(plan.note);
      beforeLinkedTimes.forEach((time) => setTimeEnabled(time.noteId, time.enabled));
      archive.entries.splice(index, 0, entry);
      restoreSelectionSnapshot(beforeSelection);
    },
  };
  execute(command);
  return plan;
}

/** Make an independent copy beside this Archive node, leaving its source in the archive. */
export function duplicateArchivedNear(entryId: string, archiveNodeId: string): Note | null {
  const entry = archive.entries.find((item) => item.id === entryId);
  const archiveNode = board.notes[archiveNodeId];
  if (!entry || archiveNode?.type !== "archive") return null;
  const copy = copyArchivedNote(entry.note);
  copy.id = newId();
  copy.name = uniqueName(`${copy.name} copy`, Object.values(board.notes).map((note) => note.name));
  copy.createdAt = Date.now();
  copy.zoneId = null;
  const height = estimatedCreationHeight(copy);
  const preferredCentre = {
    x: archiveNode.x + archiveNode.width + 3 + copy.width / 2,
    y: archiveNode.y + height / 2,
  };
  const obstacles = Object.values(board.notes).map((note) => creationObstacleForNote(note, measuredHeights[note.id]));
  const centre = nearestFreeNoteCenter(preferredCentre, copy.width, height, obstacles, grid.snap, grid.step);
  copy.x = centre.x - copy.width / 2;
  copy.y = centre.y - height / 2;
  const beforeSelection = captureSelectionSnapshot();
  const calculatorCopy = entry.calculatorData ? copyCalculatorData(entry.calculatorData) : null;
  execute({
    label: "Duplicate from archive",
    target: copy.name,
    do: () => {
      addNote(copyArchivedNote(copy));
      restoreCalculatorIfAbsent(copy, calculatorCopy);
      selectOnly(copy.id);
    },
    undo: () => {
      removeNote(copy.id);
      pruneCalculatorIfUnused(copy);
      restoreSelectionSnapshot(beforeSelection);
    },
  });
  return copy;
}

/** Caller must confirm this irreversible action in the UI. */
export function deleteArchivedPermanently(entryId: string): void {
  if (!archive.entries.some((entry) => entry.id === entryId)) return;
  permanentlyDeleted.add(entryId);
  archive.entries = archive.entries.filter((entry) => entry.id !== entryId);
}

function copyCalculatorData(data: CalculatorData): CalculatorData {
  return parseCalculatorData(data) ?? { entries: [], bank: null, rows: [] };
}

function restoreCalculatorIfAbsent(note: Note, data: CalculatorData | null | undefined): void {
  if (note.type !== "calculator" || !data) return;
  const key = calculatorKey(note.name);
  if (!Object.prototype.hasOwnProperty.call(calculators.byKey, key)) setCalculatorData(note.name, copyCalculatorData(data));
}

function pruneCalculatorIfUnused(note: Note): void {
  if (note.type !== "calculator") return;
  const key = calculatorKey(note.name);
  if (!Object.values(board.notes).some((item) => item.type === "calculator" && calculatorKey(item.name) === key)) {
    deleteCalculatorData(note.name);
  }
}

function setTimeEnabled(noteId: string, enabled: boolean): void {
  const time = board.notes[noteId]?.time;
  if (time) updateNote(noteId, { time: { ...time, enabled } });
}
