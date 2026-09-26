import type { HistoryCommand } from "../history/historyStack";
import type { Note, TaskState } from "../model/note";
import type { TaskLogEntry } from "./taskLog.svelte";

export interface TaskTransitionStore {
  getTask(noteId: string): TaskState | null;
  setTask(noteId: string, task: TaskState | null): void;
  getUnmarkedTask(noteId: string): TaskState | null;
  setUnmarkedTask(noteId: string, task: TaskState | null): void;
  addLogEntry(entry: TaskLogEntry): void;
  removeLogEntry(entry: TaskLogEntry): void;
}

export function cloneTaskState(task: TaskState | null | undefined): TaskState | null {
  return task ? { done: task.done, doneAt: task.doneAt } : null;
}

export function createTaskFlagCommand(
  store: TaskTransitionStore,
  noteId: string,
  target: string,
): HistoryCommand {
  const before = cloneTaskState(store.getTask(noteId));
  const rememberedBefore = cloneTaskState(store.getUnmarkedTask(noteId));
  const after = before ? null : rememberedBefore ?? { done: false, doneAt: null };

  return {
    label: before ? "Unmark as task" : "Mark as task",
    target,
    do: () => {
      if (before) {
        store.setUnmarkedTask(noteId, before);
      } else {
        store.setUnmarkedTask(noteId, null);
      }
      store.setTask(noteId, cloneTaskState(after));
    },
    undo: () => {
      store.setUnmarkedTask(noteId, rememberedBefore);
      store.setTask(noteId, before);
    },
  };
}

export function createTaskCompletionCommand(
  store: TaskTransitionStore,
  noteId: string,
  target: string,
  doneAt: number,
): HistoryCommand | null {
  const before = cloneTaskState(store.getTask(noteId));
  if (!before || before.done) return null;

  const after: TaskState = { done: true, doneAt };
  const entry: TaskLogEntry = { noteId, name: target, doneAt };
  return {
    label: "Complete task",
    target,
    do: () => {
      store.setTask(noteId, after);
      store.addLogEntry(entry);
    },
    undo: () => {
      store.setTask(noteId, before);
      store.removeLogEntry(entry);
    },
  };
}

export function createReopenTaskCommand(
  store: TaskTransitionStore,
  noteId: string,
  target: string,
): HistoryCommand | null {
  const before = cloneTaskState(store.getTask(noteId));
  if (!before?.done) return null;

  return {
    label: "Reopen task",
    target,
    do: () => store.setTask(noteId, { done: false, doneAt: null }),
    undo: () => store.setTask(noteId, before),
  };
}

/** Open tasks are board-wide and ordered oldest creation first. */
export function openTasks(notes: readonly Note[]): Note[] {
  return notes
    .filter((note) => note.task != null && !note.task.done)
    .sort((left, right) =>
      (left.createdAt ?? 0) - (right.createdAt ?? 0)
      || left.name.localeCompare(right.name)
      || left.id.localeCompare(right.id),
    );
}

/** Newest completions appear first, with stable source order for identical timestamps. */
export function taskHistory(entries: readonly TaskLogEntry[]): TaskLogEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => right.entry.doneAt - left.entry.doneAt || right.index - left.index)
    .map(({ entry }) => entry);
}
