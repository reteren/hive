import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { registerCloseFlush } from "../lifecycle/closeFlush";
import { replaceBoard, board } from "../model/board.svelte";
import type { Note } from "../model/note";
import {
  mergeLoadedNotes,
  parseProjectIndex,
  serializeProjectIndex,
  type LoadedProjectNote,
  type ProjectIndex,
} from "./index";
import { project } from "./project.svelte";

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

let initialization: Promise<void> | null = null;
let initialized = false;
let loading = false;
let timer: number | null = null;
let indexTemplate: ProjectIndex | undefined;
let lastSavedIndex = "";
let lastSavedById = new Map<string, SavedNote>();
let missingFileIds = new Set<string>();
let writeQueue: Promise<void> = Promise.resolve();

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
  lastSavedIndex = serializeProjectIndex(notes, parsedIndex);
  project.path = loaded.path;
  project.name = loaded.name;
  project.error = "";
  project.warnings = [...loaded.warnings];
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
  return snapshot.notes.flatMap((note) => {
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
      lastSavedById = new Map(snapshot.notes.map((note) => {
        const entry = indexTemplate?.notes.find((item) => item.id === note.id);
        return [note.id, { file: entry?.file ?? `${note.name}.md`, text: note.text }];
      }));
      missingFileIds = new Set();
      project.error = "";
      project.warnings = [...result.warnings];
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
