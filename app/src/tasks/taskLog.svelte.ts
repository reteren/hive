import { markProjectChanged } from "../project/changeSignal.svelte";

/**
 * Completion history of tasks (R3.1/R3.2) — separate from Undo and from activity statistics.
 * An entry is written when a task is completed; toggling the task flag alone writes nothing (H13).
 */
export interface TaskLogEntry {
  noteId: string;
  /** Note name at completion time. */
  name: string;
  doneAt: number;
}

export const taskLog = $state({ entries: [] as TaskLogEntry[] });

let changeRevision = 0;
const mutationListeners = new Set<(revision: number) => void>();

export function taskLogRevision(): number {
  return changeRevision;
}

export function onTaskLogMutation(listener: (revision: number) => void): () => void {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
}

export function addTaskLogEntry(entry: TaskLogEntry): boolean {
  if (taskLog.entries.some((item) => item.noteId === entry.noteId && item.doneAt === entry.doneAt)) return false;
  taskLog.entries.push(entry);
  notifyChanged();
  return true;
}

export function removeTaskLogEntry(entry: TaskLogEntry): boolean {
  for (let index = taskLog.entries.length - 1; index >= 0; index -= 1) {
    const item = taskLog.entries[index];
    if (item?.noteId === entry.noteId && item.name === entry.name && item.doneAt === entry.doneAt) {
      taskLog.entries.splice(index, 1);
      notifyChanged();
      return true;
    }
  }
  return false;
}

export function replaceTaskLog(entries: TaskLogEntry[]): void {
  taskLog.entries = entries;
  notifyChanged();
}

function notifyChanged(): void {
  changeRevision += 1;
  markProjectChanged();
  for (const listener of mutationListeners) listener(changeRevision);
}
