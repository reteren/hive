import { invoke, isTauri } from "@tauri-apps/api/core";
import { untrack } from "svelte";
import { selection } from "../selection/selection.svelte";
import { editing } from "../notes/editing.svelte";
import {
  externalMark,
  marksOnOpen,
  parseSeenState,
  seenAfterOwnSave,
  serializeSeenState,
  type ChangeKind,
  type SeenMap,
} from "./changeLogic";
import { nodeFingerprint, type NodeRecord } from "./fingerprint";

/**
 * "new" / "changed" marks on nodes that changed outside this window since this person last looked
 * (a Git pull, a synced folder, another Windows user). Own edits never get a mark. A mark goes away
 * when the node is selected or edited.
 */
export const changeMarks = $state<{ byId: Record<string, ChangeKind>; authors: Record<string, string> }>({
  byId: {},
  authors: {},
});

const SAVE_DELAY_MS = 800;

let seen: SeenMap = {};
let projectPath = "";
let active = false;
let generation = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let records: () => NodeRecord[] = () => [];
let fileOf: (id: string) => string | undefined = () => undefined;
let watching = false;

/** Begin tracking for a freshly opened project; `opened` are its nodes in saved form. */
export async function startChangeTracking(
  path: string,
  opened: readonly NodeRecord[],
  currentRecords: () => NodeRecord[],
  noteFile: (id: string) => string | undefined,
): Promise<void> {
  stopChangeTracking();
  const run = generation;
  projectPath = path;
  records = currentRecords;
  fileOf = noteFile;
  if (!isTauri()) return;
  let stored: SeenMap | null = null;
  try {
    stored = parseSeenState(await invoke<string | null>("load_seen_state", { projectPath: path }));
  } catch (error) {
    console.warn("Could not read which changes were already seen.", error);
  }
  if (run !== generation) return;
  const result = marksOnOpen(opened, stored);
  seen = result.seen;
  changeMarks.byId = result.marks;
  active = true;
  watchAcknowledgements();
  scheduleSave();
  void loadAuthors(Object.keys(result.marks));
}

export function stopChangeTracking(): void {
  // Saved under the project it belongs to, before the next project takes over.
  flushSave();
  generation += 1;
  active = false;
  seen = {};
  changeMarks.byId = {};
  changeMarks.authors = {};
}

/** This window saved `saved`: its own edits are seen, marked nodes keep waiting for a look. */
export function recordOwnSave(saved: readonly NodeRecord[]): void {
  if (!active) return;
  seen = seenAfterOwnSave(saved, seen, changeMarks.byId);
  const present = new Set(saved.map((record) => record.id));
  const stale = Object.keys(changeMarks.byId).filter((id) => !present.has(id));
  if (stale.length > 0) {
    const next = { ...changeMarks.byId };
    for (const id of stale) delete next[id];
    changeMarks.byId = next;
  }
  scheduleSave();
}

/** Nodes that just changed from outside this window (call before the board shows the change). */
export function markExternalChanges(ids: readonly string[]): void {
  if (!active || ids.length === 0) return;
  const next = { ...changeMarks.byId };
  for (const id of ids) next[id] = externalMark(id, seen, next[id]);
  changeMarks.byId = next;
  // After the caller applied the change, so a node that just arrived already has its file name.
  const marked = [...ids];
  queueMicrotask(() => void loadAuthors(marked));
}

/** The person looked at these nodes: their current content counts as seen. */
export function acknowledgeChanges(ids: readonly string[]): void {
  const marked = ids.filter((id) => changeMarks.byId[id]);
  if (!active || marked.length === 0) return;
  const current = new Map(records().map((record) => [record.id, record]));
  const next = { ...changeMarks.byId };
  for (const id of marked) {
    const record = current.get(id);
    if (record) seen[id] = nodeFingerprint(record);
    delete next[id];
  }
  changeMarks.byId = next;
  scheduleSave();
}

export function acknowledgeAllChanges(): void {
  acknowledgeChanges(Object.keys(changeMarks.byId));
}

function watchAcknowledgements(): void {
  if (watching) return;
  watching = true;
  $effect.root(() => {
    $effect(() => {
      const looked = [...selection.ids, ...(editing.noteId ? [editing.noteId] : [])];
      // Only a new look acknowledges; a mark arriving on an already selected node stays visible.
      untrack(() => acknowledgeChanges(looked));
    });
  });
}

async function loadAuthors(ids: readonly string[]): Promise<void> {
  const nodes = ids.flatMap((id) => {
    const file = fileOf(id);
    return file ? [[id, file] as [string, string]] : [];
  });
  if (!active || nodes.length === 0) return;
  const run = generation;
  try {
    const found = await invoke<Record<string, string>>("change_authors", { nodes });
    if (run === generation && Object.keys(found).length > 0) changeMarks.authors = { ...changeMarks.authors, ...found };
  } catch {
    // Not a Git project or git is not installed: marks simply carry no name.
  }
}

function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
}

function flushSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  if (!active || !isTauri()) return;
  void invoke("save_seen_state", { projectPath, contents: serializeSeenState(seen) }).catch((error: unknown) => {
    console.warn("Could not save which changes were seen.", error);
  });
}
