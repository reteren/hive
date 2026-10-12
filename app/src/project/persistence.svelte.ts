import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Tauri 2 creates the window before the setup hook registers backend state, so a very fast first
 * call can arrive before `app.manage(...)` ran ("state not managed for field ..."). Retry briefly.
 */
async function invokeWhenStateReady<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      if (attempt >= 50 || !/state not managed/i.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { registerCloseFlush } from "../lifecycle/closeFlush";
import { replaceBoard, board, onBoardMutation, updateNote } from "../model/board.svelte";
import { links, linksRevision, onLinksMutation, replaceLinks } from "../model/links.svelte";
import type { Link } from "../model/link";
import { onZonesMutation, replaceZones, zones, zonesRevision } from "../model/zones.svelte";
import type { Zone } from "../model/zone";
import { beaconState, resetBeaconViewState } from "../beacons/beaconState.svelte";
import { calculators, calculatorsRevision, onCalculatorsMutation, replaceCalculators } from "../calculator/calculators.svelte";
import {
  archive,
  archiveRevision,
  onArchiveMutation,
  onTrashMutation,
  replaceArchive,
  replaceTrash,
  trash,
  trashRevision,
} from "../model/retention.svelte";
import { copyArchiveEntry } from "../archive/serialization";
import { copyTrashEntry } from "../trash/trash";
import { resetTrashHistoryInvalidators } from "../trash/trashActions.svelte";
import { resetArchiveHistoryTombstones } from "../archive/actions.svelte";
import type { Note } from "../model/note";
import { onTaskLogMutation, replaceTaskLog, taskLog, taskLogRevision, type TaskLogEntry } from "../tasks/taskLog.svelte";
import { resetTasksPanel } from "../tasks/tasksPanelState.svelte";
import { clear as clearHistory, execute } from "../history/history.svelte";
import { clearSelection } from "../selection/selection.svelte";
import { clearSelectedLink } from "../links/selection.svelte";
import { cancelLineDraft } from "../links/interaction.svelte";
import { clearNavigationHistory } from "../navigation/navigationHistory.svelte";
import { resetObjectsPanelSearch } from "../navigation/panelState.svelte";
import { resetSearch } from "../search/search.svelte";
import { clearModuleDropPreview } from "../modules/moduleDrop.svelte";
import { closeModulePicker } from "../modules/pickerState.svelte";
import { resetTransferNotices } from "../transfer/sync.svelte";
import { tool } from "../tools/tool.svelte";
import { editing } from "../notes/editing.svelte";
import { resolveDuplicateNames } from "../notes/naming";
import {
  currentProjectStopwatchData,
  projectCounterSave,
  setProjectStopwatchData,
} from "../time/runtime.svelte";
import {
  mergeLoadedNotes,
  parseProjectIndex,
  parseProjectIndexWithWarnings,
  projectNoteFiles,
  serializeProjectIndex,
  serializeProjectNoteEntry,
  type CachedIndexedNote,
  type IndexedNote,
  type LoadedProjectNote,
  type ProjectIndex,
} from "./index";
import { mergeBoardDocuments } from "./boardMerge";
import {
  markExternalChanges,
  recordOwnSave,
  startChangeTracking,
  stopChangeTracking,
} from "../changes/changeMarks.svelte";
import { nodeFingerprint, type NodeRecord } from "../changes/fingerprint";
import { decideExternalNoteChange } from "./externalChanges";
import { project, type ProjectConflict } from "./project.svelte";
import { ProjectDirtyTracker, type DirtyCapture } from "./dirtyTracking";
import { markProjectChanged, projectChange } from "./changeSignal.svelte";

const SAVE_DEBOUNCE_MS = 500;

interface ProjectLoad {
  path: string;
  name: string;
  indexJson: string;
  notes: LoadedProjectNote[];
  warnings: string[];
  missingFiles: string[];
  /** Board revision on disk; saves send it back so a save never undoes a pull it has not seen. */
  revision?: number;
}

/** The board after someone else changed its files (a Git pull), from board_watch.rs. */
interface BoardChange {
  indexJson: string;
  notes: LoadedProjectNote[];
  warnings: string[];
  missingFiles: string[];
  revision: number;
}

/** Rust refuses a save made from an older board revision (see board_store.rs). */
const STALE_SAVE_ERROR = "BOARD_CHANGED_ON_DISK";

interface SavedNote {
  file: string;
  text: string;
}

interface ProjectSnapshot {
  indexJson: string;
  dirty: DirtyCapture;
  noteIds: readonly string[];
  changedNoteIds: readonly string[];
  deletedNoteIds: readonly string[];
  changedRecords: readonly NodeRecord[];
  changedNotes: ReadonlyMap<string, { file: string; text: string }>;
  changedFiles: readonly ChangedFile[];
  projectIndexChanged: boolean;
  globalRevisionStamp: string;
}

interface ChangedFile {
  file: string;
  text: string;
}

interface ProjectFileEvent {
  kind: "modified" | "created" | "deleted" | "renamed";
  file: string;
  oldFile?: string;
  text?: string;
  readError?: string;
}

let initialization: Promise<void> | null = null;
let initialized = false;
let loading = false;
let timer: number | null = null;
let indexTemplate: ProjectIndex | undefined;
let savedFilesById: ReadonlyMap<string, string> = new Map();
const savedFilesState = $state({ revision: 0 });
const dirtyTracker = new ProjectDirtyTracker();
const noteRevisions = new Map<string, number>();
const noteEntryCache = new Map<string, CachedIndexedNote>();
let savedIndexedNotesById = new Map<string, IndexedNote>();
let persistedGlobalRevisions = "";
let lastSavedIndex = "";
let lastSavedById = new Map<string, SavedNote>();
let missingFileIds = new Set<string>();
let externalDeleteWarnings = new Map<string, string>();
let writeQueue: Promise<void> = Promise.resolve();
let projectFileEventUnlisten: UnlistenFn | undefined;
let projectFileEventQueue: Promise<void> = Promise.resolve();
let boardChangeUnlisten: UnlistenFn | undefined;
let boardRevision: number | undefined;

/** Load the current project before mounting the board, then begin autosaving edits. */
export function initializeProjectPersistence(): Promise<void> {
  initialization ??= initialize();
  return initialization;
}

async function initialize(): Promise<void> {
  if (!isTauri()) {
    project.ready = true;
    project.error = "Project storage is available in the desktop app.";
    startBoardObserver();
    return;
  }

  if (!projectFileEventUnlisten) {
    try {
      projectFileEventUnlisten = await listen<ProjectFileEvent>(
        "project-file-event",
        (event) => {
          projectFileEventQueue = projectFileEventQueue
            .then(() => handleProjectFileEvent(event.payload))
            .catch((error: unknown) => {
              project.error = errorMessage(error);
            });
        },
      );
    } catch (error) {
      project.warnings = ["External note monitoring could not start: " + errorMessage(error)];
    }
  }
  if (!boardChangeUnlisten) {
    try {
      const stopChanged = await listen<BoardChange>("project-board-changed", (event) => {
        // Same queue as note file events, so a pulled note body and its board entry apply in order.
        projectFileEventQueue = projectFileEventQueue
          .then(() => applyExternalBoard(event.payload))
          .catch((error: unknown) => {
            project.error = errorMessage(error);
          });
      });
      const stopFailed = await listen<string>("project-board-change-failed", (event) => {
        project.warnings = [...new Set([...project.warnings, `Board files changed on disk but could not be read: ${event.payload}`])];
      });
      boardChangeUnlisten = () => {
        stopChanged();
        stopFailed();
      };
    } catch (error) {
      project.warnings = [...project.warnings, "Changes from Git pulls will appear after reopening the project: " + errorMessage(error)];
    }
  }

  try {
    const loaded = await invokeWhenStateReady<ProjectLoad>("initialize_project");
    applyProject(loaded);
  } catch (error) {
    project.error = errorMessage(error);
    project.name = "Project unavailable";
    project.ready = true;
  }
  startBoardObserver();
  if (isTauri()) registerCloseFlush("project", flushProject);
}

function startBoardObserver(): void {
  if (initialized) return;
  initialized = true;
  const canTrack = () => !loading && project.ready && Boolean(project.path);
  onBoardMutation((ids) => {
    if (!canTrack()) return;
    markBoardMutation(ids);
    markProjectChanged();
    scheduleSave();
  });
  onLinksMutation(() => { if (canTrack()) markProjectDataChanged(); });
  onZonesMutation(() => { if (canTrack()) markProjectDataChanged(); });
  onTrashMutation(() => { if (canTrack()) markProjectDataChanged(); });
  onArchiveMutation(() => { if (canTrack()) markProjectDataChanged(); });
  onTaskLogMutation(() => { if (canTrack()) markProjectDataChanged(); });
  onCalculatorsMutation(() => { if (canTrack()) markProjectDataChanged(); });
  $effect.root(() => {
    let lastCounterRevision: number | undefined;
    let lastProjectChangeRevision: number | undefined;
    let lastMarked: readonly string[] | undefined;
    let lastMeDeleted: boolean | undefined;
    $effect(() => {
      if (loading || !project.ready || !project.path) return;
      const counterRevision = projectCounterSave.revision;
      const projectChangeRevision = projectChange.revision;
      const marked = beaconState.marked;
      const meDeleted = beaconState.meDeleted;
      if (lastCounterRevision === undefined) {
        lastCounterRevision = counterRevision;
        lastProjectChangeRevision = projectChangeRevision;
        lastMarked = marked;
        lastMeDeleted = meDeleted;
        if (hasPendingDataChanges()) scheduleSave();
        return;
      }
      const projectDataChanged = lastProjectChangeRevision !== projectChangeRevision;
      const projectMetadataChanged = lastCounterRevision !== counterRevision || lastMarked !== marked || lastMeDeleted !== meDeleted;
      lastProjectChangeRevision = projectChangeRevision;
      lastCounterRevision = counterRevision;
      lastMarked = marked;
      lastMeDeleted = meDeleted;
      if (projectMetadataChanged) markProjectDataChanged();
      else if (projectDataChanged) scheduleSave();
    });
  });
}

function applyProject(loaded: ProjectLoad): void {
  const { index: parsedIndex, warnings: indexWarnings } = parseProjectIndexWithWarnings(loaded.indexJson);
  const notes = mergeLoadedNotes(parsedIndex, loaded.notes);
  const missingFiles = new Set(loaded.missingFiles ?? []);
  const normalizedIndex = serializeProjectIndex(
    notes, parsedIndex, parsedIndex.links, parsedIndex.taskLog, parsedIndex.zones, parsedIndex.beaconMarks,
    parsedIndex.calculators, parsedIndex.archive, parsedIndex.trash,
    { createdAt: parsedIndex.createdAt, projectCounters: parsedIndex.projectCounters },
    parsedIndex.meDeleted,
  );
  // After normalizedIndex (the saved baseline), so the renames count as changes and get saved.
  const duplicateRenames = resolveDuplicateNames(notes);
  const sourceIndex = JSON.parse(loaded.indexJson) as { version?: unknown; createdAt?: unknown; projectCounters?: unknown };
  const sourceVersion = sourceIndex.version;
  const hasProjectStopwatchData = typeof sourceIndex.createdAt === "number" && Number.isFinite(sourceIndex.createdAt) &&
    sourceIndex.createdAt >= 0 && isRecord(sourceIndex.projectCounters) &&
    typeof sourceIndex.projectCounters.appMs === "number" && Number.isFinite(sourceIndex.projectCounters.appMs) && sourceIndex.projectCounters.appMs >= 0 &&
    typeof sourceIndex.projectCounters.activeMs === "number" && Number.isFinite(sourceIndex.projectCounters.activeMs) && sourceIndex.projectCounters.activeMs >= 0;

  // A different project must not inherit the previous one's editor, selection or Undo steps.
  resetProjectScopedState();
  editing.noteId = null;
  clearSelection();
  clearHistory();

  loading = true;
  dirtyTracker.reset();
  noteRevisions.clear();
  noteEntryCache.clear();
  boardRevision = loaded.revision;
  setIndexTemplate(parseProjectIndex(normalizedIndex), true);
  setProjectStopwatchData(parsedIndex.createdAt, parsedIndex.projectCounters);
  lastSavedById = new Map(
    loaded.notes
      .filter((note) => !missingFiles.has(note.file))
      .map((note) => [note.id, { file: note.file, text: note.text }]),
  );
  missingFileIds = new Set(
    loaded.notes.filter((note) => missingFiles.has(note.file)).map((note) => note.id),
  );
  externalDeleteWarnings = new Map();
  lastSavedIndex = sourceVersion === 3 && indexWarnings.length === 0 && hasProjectStopwatchData
    ? normalizedIndex
    : loaded.indexJson;
  replaceTaskLog(parsedIndex.taskLog.map((entry) => ({ ...entry })));
  replaceCalculators(parsedIndex.calculators ?? {});
  replaceArchive(parsedIndex.archive.map(copyArchiveEntry));
  replaceTrash(parsedIndex.trash.map(copyTrashEntry));
  project.path = loaded.path;
  project.name = loaded.name;
  project.error = "";
  project.warnings = [...new Set([...loaded.warnings, ...indexWarnings])];
  project.conflicts = [];
  project.ready = true;
  replaceBoard(notes);
  replaceLinks(parsedIndex.links ?? []);
  replaceZones(parsedIndex.zones.map(copyZone));
  resetBeaconViewState(parsedIndex.beaconMarks, parsedIndex.meDeleted);
  loading = false;
  persistedGlobalRevisions = globalRevisionStamp();
  if (lastSavedIndex !== normalizedIndex) dirtyTracker.markIndex();
  if (duplicateRenames.length > 0) markBoardMutation(duplicateRenames.map(({ note }) => note.id));
  const openedText = new Map(notes.map((note) => [note.id, note.text]));
  void startChangeTracking(
    loaded.path,
    nodeRecords(normalizedIndex, (id) => openedText.get(id)),
    currentNodeRecords,
    (id) => indexTemplate?.notes.find((entry) => entry.id === id)?.file,
  );
}

/** Board index entries plus note text: the saved form that "new" / "changed" marks compare. */
function nodeRecords(indexJson: string, textOf: (id: string) => string | undefined): NodeRecord[] {
  const index = JSON.parse(indexJson) as { notes?: Array<Record<string, unknown>> };
  return (index.notes ?? []).flatMap((entry) => typeof entry.id === "string"
    ? [{ ...entry, id: entry.id, text: textOf(entry.id) ?? "" }]
    : []);
}

function currentNodeRecords(): NodeRecord[] {
  return nodeRecords(makeSnapshot().indexJson, (id) => board.notes[id]?.text);
}

/** Ids whose saved entry differs between two board indexes (or is new in `after`). */
function changedNodeIds(beforeJson: string, afterJson: string): string[] {
  const before = new Map(nodeRecords(beforeJson, () => "").map((record) => [record.id, nodeFingerprint(record)]));
  return nodeRecords(afterJson, () => "")
    .filter((record) => before.get(record.id) !== nodeFingerprint(record))
    .map((record) => record.id);
}

function changedIndexedNoteIds(beforeJson: string, afterJson: string): string[] {
  const before = new Map(parseProjectIndex(beforeJson).notes.map((note) => [note.id, note]));
  const after = new Map(parseProjectIndex(afterJson).notes.map((note) => [note.id, note]));
  return [...new Set([...before.keys(), ...after.keys()])].filter((id) =>
    JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)),
  );
}

/** Reset state whose ids or navigation context belongs to the currently open project. */
export function resetProjectScopedState(): void {
  stopChangeTracking();
  cancelLineDraft();
  clearSelectedLink();
  tool.active = "select";
  clearNavigationHistory();
  resetSearch();
  resetObjectsPanelSearch();
  resetTasksPanel();
  replaceZones([]);
  replaceCalculators({});
  replaceArchive([]);
  replaceTrash([]);
  resetTrashHistoryInvalidators();
  resetArchiveHistoryTombstones();
  resetBeaconViewState();
  closeModulePicker();
  clearModuleDropPreview();
  resetTransferNotices();
}

function makeSnapshot(): ProjectSnapshot {
  const notes = board.order.flatMap((id) => board.notes[id] ? [board.notes[id]] : []);
  const filesById = projectNoteFiles(notes, savedFilesById);
  const currentLinks = Object.values(links.byId).map((link) => ({ ...link }));
  const currentTaskLog = taskLog.entries.map((entry) => ({ ...entry }));
  const currentZones = zones.order.flatMap((id) => zones.byId[id] ? [copyZone(zones.byId[id])] : []);
  const beaconMarks = [...beaconState.marked];
  const currentTrash = trash.entries.map(copyTrashEntry);
  const projectMetadata = currentProjectStopwatchData();
  const allNoteIds = dirtyTracker.allNotesPending()
    ? [...new Set([...board.order, ...lastSavedById.keys()])]
    : [];
  const dirty = dirtyTracker.capture(allNoteIds, missingFileIds);
  const indexJson = serializeProjectIndex(
    notes, indexTemplate, currentLinks, currentTaskLog, currentZones, beaconMarks, calculators.byKey,
    archive.entries, currentTrash, projectMetadata, beaconState.meDeleted,
    { filesById, noteRevisions, noteEntries: noteEntryCache },
  );
  const changedNoteIds: string[] = [];
  const deletedNoteIds: string[] = [];
  const changedRecords: NodeRecord[] = [];
  const changedNotes = new Map<string, { file: string; text: string }>();
  const files: ChangedFile[] = [];
  const changedIndexIds = new Set<string>();
  const conflictedIds = new Set(project.conflicts.map((conflict) => conflict.noteId));
  for (const id of dirty.noteIds) {
    const note = board.notes[id];
    const savedEntry = savedIndexedNotesById.get(id);
    if (!note) {
      if (savedEntry || lastSavedById.has(id)) {
        changedNoteIds.push(id);
        deletedNoteIds.push(id);
        changedIndexIds.add(id);
      }
      continue;
    }
    const indexed = noteEntryCache.get(id)?.entry;
    const indexedChanged = !savedEntry || !indexed || JSON.stringify(indexed) !== JSON.stringify(savedEntry);
    const saved = lastSavedById.get(id);
    const file = filesById.get(id);
    const fileChanged = Boolean(file && (!saved || saved.file !== file || saved.text !== note.text || missingFileIds.has(id)));
    if (indexedChanged || fileChanged) changedNoteIds.push(id);
    if (indexedChanged) changedIndexIds.add(id);
    if (!conflictedIds.has(id) && file) {
      changedNotes.set(id, { file, text: note.text });
      if (fileChanged) files.push({ file, text: note.text });
    }
    const entry = indexed;
    if ((indexedChanged || fileChanged) && entry) changedRecords.push({ ...entry, id, text: note.text });
  }
  return {
    indexJson,
    dirty,
    noteIds: dirty.noteIds,
    changedNoteIds,
    deletedNoteIds,
    changedRecords,
    changedNotes,
    changedFiles: files,
    projectIndexChanged: dirtyTracker.hasIndexChanges() || globalRevisionStamp() !== persistedGlobalRevisions || changedIndexIds.size > 0,
    globalRevisionStamp: globalRevisionStamp(),
  };
}

function changedFiles(snapshot: ProjectSnapshot): ChangedFile[] {
  return [...snapshot.changedFiles];
}

function isDirty(snapshot: ProjectSnapshot): boolean {
  return snapshot.projectIndexChanged || changedFiles(snapshot).length > 0;
}

function scheduleSave(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    if (!hasPendingDataChanges()) return;
    const snapshot = makeSnapshot();
    if (isDirty(snapshot)) void persistSnapshot(snapshot).catch(() => undefined);
  }, SAVE_DEBOUNCE_MS);
}

function hasPendingDataChanges(): boolean {
  if (dirtyTracker.hasIndexChanges() || globalRevisionStamp() !== persistedGlobalRevisions || missingFileIds.size > 0) return true;
  const allNotes = dirtyTracker.allNotesPending();
  const ids = new Set(dirtyTracker.pendingNoteIds());
  if (allNotes) {
    for (const id of board.order) ids.add(id);
    for (const id of lastSavedById.keys()) ids.add(id);
  }
  if (ids.size === 0) return false;

  const revision = dirtyTracker.currentNoteRevision();
  const validZoneIds = new Set(zones.order);
  for (const id of ids) {
    const note = board.notes[id];
    const saved = lastSavedById.get(id);
    const savedEntry = savedIndexedNotesById.get(id);
    if (!note) {
      if (saved || savedEntry) return true;
      const version = dirtyTracker.noteVersion(id);
      if (version !== undefined) dirtyTracker.discardNote(id, version);
      continue;
    }
    if (missingFileIds.has(id) || !saved || saved.text !== note.text || !savedEntry) return true;
    const file = savedFilesById.get(id) ?? saved.file;
    const entry = serializeProjectNoteEntry(note, savedEntry, file, validZoneIds);
    noteEntryCache.set(id, { revision: noteRevisions.get(id) ?? 0, file, entry });
    if (JSON.stringify(entry) !== JSON.stringify(savedEntry)) return true;
    const version = dirtyTracker.noteVersion(id);
    if (version !== undefined) dirtyTracker.discardNote(id, version);
  }
  if (allNotes) dirtyTracker.discardAllNotes(revision);
  return dirtyTracker.hasChanges(missingFileIds);
}

function persistSnapshot(snapshot: ProjectSnapshot): Promise<void> {
  const queued = writeQueue.catch(() => undefined).then(async () => {
    if (!isDirty(snapshot)) return;
    const files = changedFiles(snapshot);
    project.saving = true;
    try {
      const result = await invoke<{ warnings: string[] }>("save_project", {
        request: { indexJson: snapshot.indexJson, changedFiles: files, baseRevision: boardRevision },
      });
      setIndexTemplate(parseProjectIndex(snapshot.indexJson));
      lastSavedIndex = snapshot.indexJson;
      const conflictedIds = new Set(project.conflicts.map((conflict) => conflict.noteId));
      recordOwnSave([...new Set([...snapshot.changedNoteIds, ...snapshot.deletedNoteIds])], snapshot.changedRecords);
      const writtenFiles = new Set(files.map((file) => file.file));
      for (const id of snapshot.deletedNoteIds) {
        lastSavedById.delete(id);
        missingFileIds.delete(id);
        externalDeleteWarnings.delete(id);
      }
      for (const [id, saved] of snapshot.changedNotes) {
        if (conflictedIds.has(id)) continue;
        lastSavedById.set(id, saved);
        if (writtenFiles.has(saved.file)) {
          missingFileIds.delete(id);
          externalDeleteWarnings.delete(id);
        }
      }
      dirtyTracker.acknowledge(snapshot.dirty);
      persistedGlobalRevisions = snapshot.globalRevisionStamp;
      project.error = "";
      project.warnings = [...new Set([...result.warnings, ...externalDeleteWarnings.values()])];
    } catch (error) {
      // The board changed on disk (a pull) after this snapshot was taken: the change is merged
      // into the window first, then the observer saves the merged board again.
      if (errorMessage(error).includes(STALE_SAVE_ERROR)) return;
      project.error = errorMessage(error);
      throw error;
    } finally {
      project.saving = false;
    }
  });
  writeQueue = queued.catch(() => undefined);
  return queued;
}

/** A board index in the exact form makeSnapshot() produces (note bodies are not part of it). */
function normalizeIndexJson(indexJson: string): string {
  const { index } = parseProjectIndexWithWarnings(indexJson);
  const notes = mergeLoadedNotes(index, index.notes.map((entry) => ({
    id: entry.id, name: entry.name, file: entry.file, text: "", x: entry.x, y: entry.y, width: entry.width, height: entry.height,
  })));
  return serializeProjectIndex(
    notes, index, index.links, index.taskLog, index.zones, index.beaconMarks, index.calculators, index.archive, index.trash,
    { createdAt: index.createdAt, projectCounters: index.projectCounters }, index.meDeleted,
  );
}

/**
 * Merge a board that changed on disk (a Git pull) into the open window: objects only the pull
 * changed are taken from disk, local unsaved edits stay, and the result is saved back if needed.
 */
function applyExternalBoard(change: BoardChange): void {
  if (!project.ready || !project.path || loading) return;
  // All three in the window's own serialisation, or format differences would look like edits.
  const theirsJson = normalizeIndexJson(change.indexJson);
  const base = JSON.parse(lastSavedIndex ? normalizeIndexJson(lastSavedIndex) : theirsJson) as Record<string, unknown>;
  const mine = JSON.parse(makeSnapshot().indexJson) as Record<string, unknown>;
  const theirs = JSON.parse(theirsJson) as Record<string, unknown>;
  const { document, conflicts } = mergeBoardDocuments(base, mine, theirs);
  const merged = parseProjectIndexWithWarnings(JSON.stringify(document)).index;

  // Note bodies: a note this window already had keeps its text (body changes from disk arrive as
  // note file events); a note that came with the pull gets the text read from disk.
  const diskText = new Map(change.notes.map((note) => [note.id, note.text]));
  const loadedNotes: LoadedProjectNote[] = merged.notes.map((entry) => ({
    id: entry.id,
    name: entry.name,
    file: entry.file,
    text: board.notes[entry.id]?.text ?? diskText.get(entry.id) ?? "",
    x: entry.x,
    y: entry.y,
    width: entry.width,
    height: entry.height,
  }));
  const notes = mergeLoadedNotes(merged, loadedNotes);
  // The pulled board stays the saved baseline, so the renames count as changes and get saved.
  const duplicateRenames = resolveDuplicateNames(notes);
  const mergedIndexJson = normalizeIndexJson(JSON.stringify(document));
  const locallyChangedNoteIds = new Set(changedIndexedNoteIds(theirsJson, mergedIndexJson));
  for (const { note } of duplicateRenames) locallyChangedNoteIds.add(note.id);
  // Before the board shows them: nodes the pull added or changed get a "new" / "changed" mark.
  markExternalChanges(changedNodeIds(JSON.stringify(base), theirsJson));

  loading = true;
  try {
    boardRevision = change.revision;
    // What is on disk now is the new saved baseline; whatever differs from it is saved next.
    dirtyTracker.reset();
    setIndexTemplate(parseProjectIndexWithWarnings(theirsJson).index, true);
    lastSavedIndex = theirsJson;
    const missingFiles = new Set(change.missingFiles);
    lastSavedById = new Map(change.notes.filter((note) => !missingFiles.has(note.file))
      .map((note) => [note.id, { file: note.file, text: note.text }]));
    missingFileIds = new Set(change.notes.filter((note) => missingFiles.has(note.file)).map((note) => note.id));
    // Undo steps were recorded against the board before the pull.
    clearHistory();
    if (editing.noteId && !merged.notes.some((note) => note.id === editing.noteId)) editing.noteId = null;
    replaceTaskLog(merged.taskLog.map((entry) => ({ ...entry })));
    replaceCalculators(merged.calculators ?? {});
    replaceArchive(merged.archive.map(copyArchiveEntry));
    replaceTrash(merged.trash.map(copyTrashEntry));
    replaceBoard(notes);
    replaceLinks(merged.links ?? []);
    replaceZones(merged.zones.map(copyZone));
    resetBeaconViewState(merged.beaconMarks, merged.meDeleted);
    persistedGlobalRevisions = globalRevisionStamp();
    const notices = [...change.warnings];
    if (conflicts.length > 0) {
      notices.push(`${conflicts.length} object(s) were changed both here and in the pulled version; this window's version was kept.`);
    }
    project.warnings = [...new Set([...project.warnings, ...notices])];
  } finally {
    loading = false;
  }
  if (mergedIndexJson !== theirsJson) dirtyTracker.markIndex();
  if (locallyChangedNoteIds.size > 0) markBoardMutation([...locallyChangedNoteIds]);
  if (hasPendingDataChanges()) scheduleSave();
}

async function flushProject(): Promise<void> {
  if (!project.path) return;
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  await writeQueue;
  // A save refused because a pull arrived meanwhile is retried once the pull is merged.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await projectFileEventQueue;
    if (!hasPendingDataChanges()) break;
    const snapshot = makeSnapshot();
    if (!isDirty(snapshot)) break;
    await persistSnapshot(snapshot);
    await writeQueue;
  }
  if (project.error) throw new Error(project.error);
}

/** Pick a folder, flush the current project, and switch only after the new one loads. */
export async function chooseProject(mode: "new" | "open"): Promise<void> {
  if (!isTauri()) {
    project.error = "Project storage is available in the desktop app.";
    return;
  }
  if (project.path) {
    try {
      await flushProject();
    } catch {
      return;
    }
  }

  let selected: string | string[] | null;
  try {
    selected = await open({
      directory: true,
      multiple: false,
      title: mode === "new" ? "Choose a folder for the new project" : "Open project folder",
      defaultPath: mode === "new" ? undefined : project.path || undefined,
    });
  } catch (error) {
    project.error = errorMessage(error);
    return;
  }
  if (!selected || Array.isArray(selected)) return;

  try {
    const loaded = await invoke<ProjectLoad>(mode === "new" ? "create_project" : "open_project", { path: selected });
    applyProject(loaded);
  } catch (error) {
    project.error = errorMessage(error);
  }
}

export function closeProjectMenu(): void {
  project.menuOpen = false;
}

export function useExternalVersion(noteId: string): void {
  const conflict = project.conflicts.find((item) => item.noteId === noteId);
  const note = board.notes[noteId];
  if (!conflict || !note) return;

  const localText = note.text;
  const externalText = conflict.externalText;
  lastSavedById.set(noteId, { file: conflict.file, text: externalText });
  project.conflicts = project.conflicts.filter((item) => item.noteId !== noteId);
  if (editing.noteId === noteId) editing.noteId = null;

  // Silent reloads never touch history. This is an explicit user choice, so
  // it is undoable while preserving the history that already exists.
  execute({
    label: "Use external version",
    target: note.name,
    do: () => updateNote(noteId, { text: externalText }),
    undo: () => updateNote(noteId, { text: localText }),
  });
}

export async function keepLocalVersion(noteId: string): Promise<void> {
  const conflict = project.conflicts.find((item) => item.noteId === noteId);
  if (!conflict || !board.notes[noteId] || !conflict.externalCopyFile) return;

  lastSavedById.set(noteId, { file: conflict.file, text: conflict.externalText });
  project.conflicts = project.conflicts.filter((item) => item.noteId !== noteId);
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }

  try {
    const snapshot = makeSnapshot();
    if (isDirty(snapshot)) await persistSnapshot(snapshot);
  } catch {
    // persistSnapshot already exposes the save error in project.error.
  }
}

async function handleProjectFileEvent(event: ProjectFileEvent): Promise<void> {
  if (event.kind === "renamed" && event.oldFile) {
    await handleExternalDelete(event.oldFile);
    await handleExternalBody(event);
    return;
  }
  if (event.kind === "deleted") {
    await handleExternalDelete(event.file);
    return;
  }
  await handleExternalBody(event);
}

async function handleExternalBody(event: ProjectFileEvent): Promise<void> {
  if (event.readError || typeof event.text !== "string") {
    project.error = "Could not read external note " + event.file + ": "
      + (event.readError ?? "file contents were unavailable.");
    return;
  }

  const note = noteForFile(event.file);
  if (!note) {
    await acknowledgeExternalChange(event.file, event.text);
    return;
  }

  if (note.type === "calculator") {
    lastSavedById.set(note.id, { file: event.file, text: event.text });
    missingFileIds.delete(note.id);
    project.conflicts = project.conflicts.filter((item) => item.noteId !== note.id);
    await acknowledgeExternalChange(event.file, event.text);
    if (event.text !== note.text) scheduleIfDirty();
    return;
  }

  const previous = lastSavedById.get(note.id);
  const decision = decideExternalNoteChange({
    externalText: event.text,
    localText: note.text,
    savedText: previous?.text,
    isEditing: editing.noteId === note.id,
  });
  missingFileIds.delete(note.id);
  removeMissingFileWarning(note.id);

  if (decision === "unchanged") {
    lastSavedById.set(note.id, { file: event.file, text: event.text });
    project.conflicts = project.conflicts.filter((item) => item.noteId !== note.id);
    await acknowledgeExternalChange(event.file, event.text);
    scheduleIfDirty();
    return;
  }

  lastSavedById.set(note.id, { file: event.file, text: event.text });
  markExternalChanges([note.id]);
  if (decision === "reload") {
    project.conflicts = project.conflicts.filter((item) => item.noteId !== note.id);
    updateNote(note.id, { text: event.text });
    await acknowledgeExternalChange(event.file, event.text);
    scheduleIfDirty();
    return;
  }

  const timestamp = conflictTimestamp();
  const localText = note.text;
  const conflict: ProjectConflict = {
    noteId: note.id,
    noteName: note.name,
    file: event.file,
    localText,
    externalText: event.text,
    localCopyFile: null,
    externalCopyFile: null,
    savingCopies: true,
    copyError: "",
  };
  if (project.conflicts.some((item) => item.noteId === note.id)) {
    project.conflicts = project.conflicts.map((item) => item.noteId === note.id ? conflict : item);
  } else {
    project.conflicts = [...project.conflicts, conflict];
  }

  const errors: string[] = [];
  try {
    conflict.externalCopyFile = await writeConflictCopy(event.file, "external", timestamp, event.text);
  } catch (error) {
    errors.push("external copy: " + errorMessage(error));
  }
  try {
    conflict.localCopyFile = await writeConflictCopy(event.file, "local", timestamp, localText);
  } catch (error) {
    errors.push("local copy: " + errorMessage(error));
  }

  conflict.savingCopies = false;
  conflict.copyError = errors.join(" · ");
  project.conflicts = project.conflicts.map((item) => item.noteId === note.id ? { ...conflict } : item);
  if (errors.length > 0) {
    project.error = "Could not preserve both versions of " + note.name + ": " + errors.join("; ");
    return;
  }

  const acknowledged = await acknowledgeExternalChange(event.file, event.text);
  if (!acknowledged) {
    project.error = "The external file changed again while preserving " + note.name + ".";
    return;
  }
  scheduleIfDirty();
}

async function handleExternalDelete(file: string): Promise<void> {
  const note = noteForFile(file);
  if (!note) {
    await acknowledgeExternalChange(file, undefined);
    return;
  }

  if (note.type === "calculator") {
    missingFileIds.add(note.id);
    await acknowledgeExternalChange(file, undefined);
    scheduleIfDirty();
    return;
  }

  missingFileIds.add(note.id);
  const warning = "Note file " + file + " was deleted outside Hive; it will be recreated on the next save.";
  externalDeleteWarnings.set(note.id, warning);
  if (!project.warnings.includes(warning)) project.warnings = [...project.warnings, warning];
  await acknowledgeExternalChange(file, undefined);
}

/** Note id → Markdown file as last loaded or saved; notes keep these files while their names match. */
export function savedNoteFiles(): ReadonlyMap<string, string> {
  void savedFilesState.revision;
  return savedFilesById;
}

function setIndexTemplate(next: ProjectIndex | undefined, resetNoteCache = false): void {
  indexTemplate = next;
  savedFilesById = new Map(next?.notes.map((note) => [note.id, note.file]) ?? []);
  savedIndexedNotesById = new Map(next?.notes.map((note) => [note.id, note]) ?? []);
  if (resetNoteCache) {
    noteEntryCache.clear();
    noteRevisions.clear();
    for (const note of next?.notes ?? []) {
      const revision = 0;
      noteRevisions.set(note.id, revision);
      noteEntryCache.set(note.id, { revision, file: note.file, entry: note });
    }
  }
  savedFilesState.revision += 1;
}

function markBoardMutation(ids: readonly string[] | null): void {
  if (ids === null) {
    noteRevisions.clear();
    noteEntryCache.clear();
  } else {
    for (const id of ids) {
      noteRevisions.set(id, (noteRevisions.get(id) ?? 0) + 1);
      noteEntryCache.delete(id);
    }
  }
  dirtyTracker.markNotes(ids);
}

function markProjectDataChanged(): void {
  dirtyTracker.markIndex();
  scheduleSave();
}

function globalRevisionStamp(): string {
  return [
    linksRevision(), zonesRevision(), trashRevision(), archiveRevision(), taskLogRevision(), calculatorsRevision(),
  ].join(":");
}

function noteForFile(file: string): Note | undefined {
  const key = file.toLowerCase();
  const notes = board.order.flatMap((id) => {
    const note = board.notes[id];
    return note ? [note] : [];
  });
  const currentFiles = projectNoteFiles(notes, savedNoteFiles());
  return notes.find((note) => {
    const currentFile = currentFiles.get(note.id);
    const savedFile = lastSavedById.get(note.id)?.file;
    return currentFile?.toLowerCase() === key || savedFile?.toLowerCase() === key;
  });
}

async function acknowledgeExternalChange(file: string, text: string | undefined): Promise<boolean> {
  try {
    const acknowledged = await invoke<boolean>("acknowledge_external_file_change", {
      file,
      text: text ?? null,
    });
    return acknowledged;
  } catch (error) {
    project.error = "Could not acknowledge external note " + file + ": " + errorMessage(error);
    return false;
  }
}

async function writeConflictCopy(
  file: string,
  kind: "external" | "local",
  timestamp: string,
  text: string,
): Promise<string> {
  return invoke<string>("write_conflict_copy", {
    request: { file, kind, timestamp, text },
  });
}

function conflictTimestamp(): string {
  const now = new Date();
  const twoDigits = (value: number): string => String(value).padStart(2, "0");
  return String(now.getFullYear()) + "-" + twoDigits(now.getMonth() + 1) + "-"
    + twoDigits(now.getDate()) + " " + twoDigits(now.getHours()) + twoDigits(now.getMinutes());
}

function removeMissingFileWarning(noteId: string): void {
  const warning = externalDeleteWarnings.get(noteId);
  externalDeleteWarnings.delete(noteId);
  if (warning) project.warnings = project.warnings.filter((item) => item !== warning);
}

function scheduleIfDirty(): void {
  if (hasPendingDataChanges()) scheduleSave();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyZone(zone: Zone): Zone {
  return {
    ...zone,
    parts: zone.parts.map((part) => part.map((point) => ({ ...point }))),
    holes: zone.holes.map((hole) => hole.map((point) => ({ ...point }))),
  };
}

/** Finish pending board writes before transferring or switching project folders. */
export async function flushPendingSave(): Promise<void> {
  await flushProject();
}

/** Reload an already-written project folder; callers must flush before changing projects. */
export async function openProjectAt(path: string): Promise<void> {
  if (!isTauri()) throw new Error("Project storage is available in the desktop app.");
  try {
    const loaded = await invoke<ProjectLoad>("open_project", { path });
    applyProject(loaded);
  } catch (error) {
    project.error = errorMessage(error);
    throw error;
  }
}
