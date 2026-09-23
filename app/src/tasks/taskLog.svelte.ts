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
