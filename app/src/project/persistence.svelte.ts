import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { registerCloseFlush } from "../lifecycle/closeFlush";
import { replaceBoard, board, updateNote } from "../model/board.svelte";
import type { Note } from "../model/note";
import { clear as clearHistory, execute } from "../history/history.svelte";
import { clearSelection } from "../selection/selection.svelte";
import { editing } from "../notes/editing.svelte";
import {
  mergeLoadedNotes,
  parseProjectIndex,
  serializeProjectIndex,
  type LoadedProjectNote,
  type ProjectIndex,
} from "./index";
import { decideExternalNoteChange } from "./externalChanges";
import { sanitizeNoteName } from "./fileNames";
import { project, type ProjectConflict } from "./project.svelte";

const SAVE_DEBOUNCE_MS = 500;

interface ProjectLoad {
  path: string;
  name: string;
  indexJson: string;
  notes: LoadedProjectNote[];
  warnings: string[];
  missingFiles: string[];
}

interface SavedNote {
  file: string;
  text: string;
}

interface ProjectSnapshot {
  indexJson: string;
  notes: Note[];
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
let lastSavedIndex = "";
let lastSavedById = new Map<string, SavedNote>();
let missingFileIds = new Set<string>();
let externalDeleteWarnings = new Map<string, string>();
let writeQueue: Promise<void> = Promise.resolve();
let projectFileEventUnlisten: UnlistenFn | undefined;
let projectFileEventQueue: Promise<void> = Promise.resolve();

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

  try {
    const loaded = await invoke<ProjectLoad>("initialize_project");
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
  $effect.root(() => {
    $effect(() => {
      if (loading || !project.ready || !project.path) return;
      const snapshot = makeSnapshot();
      if (isDirty(snapshot)) scheduleSave(snapshot);
    });
  });
}

function applyProject(loaded: ProjectLoad): void {
  const parsedIndex = parseProjectIndex(loaded.indexJson);
  const notes = mergeLoadedNotes(parsedIndex, loaded.notes);
  const missingFiles = new Set(loaded.missingFiles ?? []);

  // A different project must not inherit the previous one's editor, selection or Undo steps.
  editing.noteId = null;
  clearSelection();
  clearHistory();

  loading = true;
  indexTemplate = parsedIndex;
  lastSavedById = new Map(
    loaded.notes
      .filter((note) => !missingFiles.has(note.file))
      .map((note) => [note.id, { file: note.file, text: note.text }]),
  );
  missingFileIds = new Set(
    loaded.notes.filter((note) => missingFiles.has(note.file)).map((note) => note.id),
  );
  externalDeleteWarnings = new Map();
  lastSavedIndex = serializeProjectIndex(notes, parsedIndex);
  project.path = loaded.path;
  project.name = loaded.name;
  project.error = "";
  project.warnings = [...loaded.warnings];
  project.conflicts = [];
  project.ready = true;
  replaceBoard(notes);
  loading = false;
}

function makeSnapshot(): ProjectSnapshot {
  const notes = board.order.flatMap((id) => {
    const note = board.notes[id];
    return note ? [{ ...note }] : [];
  });
  return {
    indexJson: serializeProjectIndex(notes, indexTemplate),
    notes,
  };
}

function changedFiles(snapshot: ProjectSnapshot): ChangedFile[] {
  const fileById = new Map(parseProjectIndex(snapshot.indexJson).notes.map((entry) => [entry.id, entry.file]));
  const conflictedIds = new Set(project.conflicts.map((conflict) => conflict.noteId));
  return snapshot.notes.flatMap((note) => {
    if (conflictedIds.has(note.id)) return [];
    const saved = lastSavedById.get(note.id);
    const file = fileById.get(note.id);
    if (!file) return [];
    if (!saved || saved.file !== file || saved.text !== note.text
      || missingFileIds.has(note.id)) {
      return [{ file, text: note.text }];
    }
    return [];
  });
}

function isDirty(snapshot: ProjectSnapshot): boolean {
  return snapshot.indexJson !== lastSavedIndex || changedFiles(snapshot).length > 0;
}

function scheduleSave(snapshot: ProjectSnapshot): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void persistSnapshot(snapshot).catch(() => undefined);
  }, SAVE_DEBOUNCE_MS);
}

function persistSnapshot(snapshot: ProjectSnapshot): Promise<void> {
  const queued = writeQueue.catch(() => undefined).then(async () => {
    if (!isDirty(snapshot)) return;
    const files = changedFiles(snapshot);
    project.saving = true;
    try {
      const result = await invoke<{ warnings: string[] }>("save_project", {
        request: { indexJson: snapshot.indexJson, changedFiles: files },
      });
      indexTemplate = parseProjectIndex(snapshot.indexJson);
      lastSavedIndex = snapshot.indexJson;
      const savedById = new Map(snapshot.notes.map((note) => {
        const entry = indexTemplate?.notes.find((item) => item.id === note.id);
        return [note.id, { file: entry?.file ?? `${note.name}.md`, text: note.text }];
      }));
      for (const conflict of project.conflicts) {
        const previous = lastSavedById.get(conflict.noteId);
        if (previous) savedById.set(conflict.noteId, previous);
      }
      lastSavedById = savedById;
      const currentIds = new Set(snapshot.notes.map((note) => note.id));
      for (const id of missingFileIds) {
        if (!currentIds.has(id)) {
          missingFileIds.delete(id);
          externalDeleteWarnings.delete(id);
        }
      }
      for (const note of snapshot.notes) {
        const entry = indexTemplate.notes.find((item) => item.id === note.id);
        if (entry && files.some((file) => file.file === entry.file)) {
          missingFileIds.delete(note.id);
          externalDeleteWarnings.delete(note.id);
        }
      }
      project.error = "";
      project.warnings = [...new Set([...result.warnings, ...externalDeleteWarnings.values()])];
    } catch (error) {
      project.error = errorMessage(error);
      throw error;
    } finally {
      project.saving = false;
    }
  });
  writeQueue = queued.catch(() => undefined);
  return queued;
}

async function flushProject(): Promise<void> {
  if (!project.path) return;
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  await writeQueue;
  const snapshot = makeSnapshot();
  if (isDirty(snapshot)) await persistSnapshot(snapshot);
  await writeQueue;
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

  missingFileIds.add(note.id);
  const warning = "Note file " + file + " was deleted outside Hive; it will be recreated on the next save.";
  externalDeleteWarnings.set(note.id, warning);
  if (!project.warnings.includes(warning)) project.warnings = [...project.warnings, warning];
  await acknowledgeExternalChange(file, undefined);
}

function noteForFile(file: string): Note | undefined {
  const key = file.toLowerCase();
  return board.order
    .map((id) => board.notes[id])
    .find((note) => {
      if (!note) return false;
      const currentFile = sanitizeNoteName(note.name) + ".md";
      const savedFile = lastSavedById.get(note.id)?.file;
      return currentFile.toLowerCase() === key || savedFile?.toLowerCase() === key;
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
  const snapshot = makeSnapshot();
  if (isDirty(snapshot)) scheduleSave(snapshot);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
